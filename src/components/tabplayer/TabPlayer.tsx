import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { XMarkIcon } from "@heroicons/react/16/solid";
import { ErrorModal } from "../ErrorModal";
import { ConfirmModal } from "../ConfirmModal";
import { assetUrl } from "../player/useAudioEngine";
import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";
import type { Resource } from "../../api/types";
import { barAt, renderTracks, type TabLayout } from "./tabRender";
import { songClock, type SongClock } from "./clock";
import { SynthPlayer, type VoiceKind } from "./synth";
import { RecordingTransport, type SyncPoint } from "./recordingTransport";
import type { Transport } from "./transport";
import type { TabSong } from "./types";

const SYNC_KEY = "tabPlayerRecordingSync";

/** What is remembered per tab + recording: where bar 1 starts and the pinned bars. */
interface StoredSync {
  offset: number;
  sync: SyncPoint[];
}
const MEDIA_EXTS = ["mp3", "wav", "flac", "m4a", "aac", "ogg", "mp4", "mov", "webm", "m4v"];
const ALL_TRACKS = "all";

interface Props {
  /** Path to the Guitar Pro (.gp) file. */
  filePath: string;
  /** The item's resources — local audio/video ones can back the tab as a recording. */
  resources?: Resource[];
  onClose: () => void;
}

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function fmt(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Adds a sync point, dropping any that would make the recording run backwards. */
function addSyncPoint(sync: SyncPoint[], bar: number, time: number): SyncPoint[] {
  const kept = sync.filter((p) => p.bar !== bar && ((p.bar < bar && p.time < time) || (p.bar > bar && p.time > time)));
  kept.push({ bar, time });
  return kept.sort((a, b) => a.bar - b.bar);
}

function syncLabel(sync: SyncPoint[]): string {
  const n = sync.length;
  return n ? `${n} sync point${n === 1 ? "" : "s"}: the tab follows the recording between them.` : "No sync points yet.";
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function TabPlayer({ filePath, resources = [], onClose }: Props) {
  const [song, setSong] = useState<TabSong | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedLoading, setFailedLoading] = useState(false);

  const [trackSel, setTrackSel] = useState<string>("0");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [loopFrom, setLoopFrom] = useState("");
  const [loopTo, setLoopTo] = useState("");
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [voice, setVoice] = useState<VoiceKind>("pluck");
  const [mixerOpen, setMixerOpen] = useState(false);
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [solo, setSolo] = useState<Set<number>>(new Set());
  const [volumes, setVolumes] = useState<number[]>([]);
  const [currentBar, setCurrentBar] = useState(0);
  const [follow, setFollow] = useState(true);

  const [audioPath, setAudioPath] = useState<string>("");
  const [audioStatus, setAudioStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [sync, setSync] = useState<SyncPoint[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<TabLayout | null>(null);
  const clockRef = useRef<SongClock | null>(null);
  const synthRef = useRef<SynthPlayer | null>(null);
  const recordingRef = useRef<RecordingTransport | null>(null);
  const tickRef = useRef(0);
  const speedRef = useRef(100);
  const loopRef = useRef<[number, number] | null>(null);
  const followRef = useRef(true);
  followRef.current = follow;

  // Keyed on the content so a parent re-render with an equal list doesn't reset the recording.
  const resourcesKey = JSON.stringify(resources);
  const audioCandidates = useMemo(
    () => (JSON.parse(resourcesKey) as Resource[]).filter((r) => r.type === "local_file" && MEDIA_EXTS.includes(extOf(r.url))),
    [resourcesKey]
  );

  const shownTracks = useMemo(() => {
    if (!song) return [];
    return trackSel === ALL_TRACKS ? song.tracks.map((_, i) => i) : [Number(trackSel)];
  }, [song, trackSel]);

  const loop = useMemo<[number, number] | null>(() => {
    if (!song) return null;
    const bars = song.tracks[0].measures.length;
    const a = parseInt(loopFrom, 10);
    const b = parseInt(loopTo, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const lo = Math.max(1, Math.min(a, b, bars));
    const hi = Math.min(bars, Math.max(a, b));
    return [lo - 1, hi - 1];
  }, [song, loopFrom, loopTo]);
  loopRef.current = loop;

  // ── Position the cursor over the tab ────────────────────────────────────────
  const moveCursor = useCallback((tick: number) => {
    tickRef.current = tick;
    const layout = layoutRef.current;
    const clock = clockRef.current;
    if (!layout || !clock) return;
    const timing = clock.timing;
    const bar = barAt(timing, tick);
    setCurrentBar((prev) => (prev === bar ? prev : bar));
    const info = layout.bars[bar];
    if (!info) return;
    const inBar = tick - timing.starts[bar];
    const barTicks = timing.lengths[bar];
    let x = info.x0 + 10;
    for (let i = 0; i < info.beats.length; i++) {
      const b = info.beats[i];
      const next = info.beats[i + 1];
      if (inBar >= b.tick) {
        const endTick = next ? next.tick : barTicks;
        const endX = next ? next.x : info.x1 - 4;
        const f = Math.min(1, (inBar - b.tick) / Math.max(1, endTick - b.tick));
        x = b.x + (endX - b.x) * f;
      }
    }
    const line = layout.lines[info.line];
    const cur = layout.cursor;
    cur.style.left = `${x - 10}px`;
    cur.style.top = `${line.el.offsetTop + layout.geo.cursorTop - 10}px`;
    cur.style.height = `${layout.geo.cursorBottom - layout.geo.cursorTop + 20}px`;
    const active = Boolean(synthRef.current?.playing || recordingRef.current?.playing);
    cur.classList.toggle("shown", active || tick > 0);
    const scroller = scrollRef.current;
    if (active && followRef.current && scroller) {
      const sr = scroller.getBoundingClientRect();
      const lr = line.el.getBoundingClientRect();
      if (lr.top < sr.top || lr.bottom > sr.bottom - 40) {
        scroller.scrollTo({ top: scroller.scrollTop + (lr.top - sr.top) - 20, behavior: "smooth" });
      }
    }
  }, []);

  // ── Load the song ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    invoke<string>("read_tab_file", { filePath })
      .then((json) => {
        if (cancelled) return;
        const parsed = JSON.parse(json) as TabSong;
        if (!parsed.tracks?.length) throw new Error("This file has no tracks the tab player can show.");
        setSong(parsed);
        setVolumes(parsed.tracks.map(() => 0.8));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errMsg(err));
        setFailedLoading(true);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // ── The synth transport for the loaded song ─────────────────────────────────
  useEffect(() => {
    if (!song) return;
    const synth = new SynthPlayer({
      onTick: (t) => moveCursor(t),
      onState: (p) => setPlaying(p),
      onError: (e) => setError(e.message),
    });
    synth.load(song);
    synth.setSpeed(speedRef.current);
    synth.setLoop(loopRef.current);
    synthRef.current = synth;
    clockRef.current = songClock(song);
    return () => {
      synth.dispose();
      if (synthRef.current === synth) synthRef.current = null;
    };
  }, [song, moveCursor]);

  // ── Draw the tab ────────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!song || !host) return;
    function draw() {
      if (!host || !song) return;
      layoutRef.current = renderTracks(host, song, shownTracks, {
        width: host.clientWidth,
        loop,
        currentTrack: shownTracks[0],
      });
      moveCursor(tickRef.current);
    }
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(host);
    return () => ro.disconnect();
  }, [song, shownTracks, loop, moveCursor]);

  // ── Which transport is active ───────────────────────────────────────────────
  const transport = (): Transport | null => recordingRef.current ?? synthRef.current;

  // ── Attach / detach a recording ─────────────────────────────────────────────
  useEffect(() => {
    if (!song) return;
    if (!audioPath) {
      setAudioStatus("");
      // Back to the synth: pick up where the recording left off.
      synthRef.current?.seekTick(tickRef.current);
      return;
    }
    const name = audioCandidates.find((r) => r.url === audioPath)?.name ?? audioPath;
    const wasTick = tickRef.current;
    synthRef.current?.pause();
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    setAudioStatus(`Loading ${name}…`);
    const saved = readLocalStorageJSON<Record<string, StoredSync | number>>(SYNC_KEY, {});
    if (saved.error) setError(saved.error);
    const stored = saved.value[`${filePath}|${audioPath}`];
    const loaded: StoredSync = typeof stored === "number" ? { offset: stored, sync: [] } : stored ?? { offset: 0, sync: [] };
    const off = loaded.offset;
    setOffset(off);
    setSync(loaded.sync);
    const rec = new RecordingTransport(audio, song, {
      onTick: (t) => moveCursor(t),
      onState: (p) => setPlaying(p),
      onError: (e) => setError(e.message),
    });
    rec.offset = off;
    rec.sync = loaded.sync;
    let disposed = false;
    audio.addEventListener("loadedmetadata", () => {
      if (disposed) return;
      setAudioStatus(`${name} — ${fmt(audio.duration)} long, bar 1 starts at ${fmt(rec.offset)}`);
      rec.setSpeed(speedRef.current);
      rec.setLoop(loopRef.current);
      rec.seekTick(wasTick);
    });
    audio.addEventListener("error", () => {
      if (disposed) return;
      const code = audio.error?.message || `media error ${audio.error?.code ?? "?"}`;
      setAudioStatus("");
      setError(`Couldn't load the recording "${name}" (${audioPath}): ${code}`);
      setAudioPath("");
    });
    audio.src = assetUrl(audioPath);
    recordingRef.current = rec;
    return () => {
      disposed = true;
      rec.dispose();
      if (recordingRef.current === rec) recordingRef.current = null;
    };
  }, [audioPath, song, filePath, audioCandidates, moveCursor]);

  // Keep the active transport's speed and loop in step with the controls.
  useEffect(() => {
    speedRef.current = speed;
    synthRef.current?.setSpeed(speed);
    recordingRef.current?.setSpeed(speed);
  }, [speed, song, audioPath]);
  useEffect(() => {
    synthRef.current?.setLoop(loop);
    recordingRef.current?.setLoop(loop);
  }, [loop, song, audioPath]);
  useEffect(() => {
    if (synthRef.current) synthRef.current.metronome = metronome;
  }, [metronome, song]);
  useEffect(() => {
    if (synthRef.current) synthRef.current.countIn = countIn;
  }, [countIn, song]);
  useEffect(() => {
    if (synthRef.current) synthRef.current.voice = voice;
  }, [voice, song]);

  // ── Transport actions ───────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const t = transport();
    if (!t) return;
    const p = t.playing ? Promise.resolve(t.pause()) : t.play();
    p.catch((err) => setError(errMsg(err)));
  }, []);

  const restart = useCallback(() => {
    const t = transport();
    if (!t) return;
    const start = loopRef.current && clockRef.current ? clockRef.current.timing.starts[loopRef.current[0]] : 0;
    t.seekTick(start);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return;
      if (e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
      } else if ((e.key === "b" || e.key === "B") && recordingRef.current) {
        syncTapRef.current();
      } else if (e.key === "Escape" && !error) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [togglePlay, onClose, error]);

  function onSheetClick(ev: React.MouseEvent) {
    const hit = (ev.target as Element).closest("[data-bar]") as SVGElement | null;
    const clock = clockRef.current;
    if (!hit || !clock) return;
    const bar = Number(hit.dataset.bar);
    transport()?.seekTick(clock.timing.starts[bar]);
  }

  /** Applies and remembers where bar 1 starts and which bars are pinned. */
  function commitSync(rec: RecordingTransport, nextOffset: number, nextSync: SyncPoint[]) {
    rec.offset = nextOffset;
    rec.sync = nextSync;
    setOffset(nextOffset);
    setSync(nextSync);
    const saved = readLocalStorageJSON<Record<string, StoredSync | number>>(SYNC_KEY, {});
    if (saved.error) {
      setError(saved.error);
      return;
    }
    try {
      writeLocalStorageJSON(SYNC_KEY, { ...saved.value, [`${filePath}|${audioPath}`]: { offset: nextOffset, sync: nextSync } });
    } catch (err) {
      setError(`Couldn't save the sync points: ${errMsg(err)}`);
    }
  }

  function setBarOneHere() {
    const rec = recordingRef.current;
    if (!rec) return;
    // The recording's playhead becomes the start of bar 1 (and moves any bar-1 sync point).
    const t = Math.round(rec.mediaTime() * 1000) / 1000;
    commitSync(rec, t, rec.sync.length ? addSyncPoint(rec.sync, 0, t) : []);
    const name = audioCandidates.find((r) => r.url === audioPath)?.name ?? audioPath;
    setAudioStatus(`${name} — bar 1 starts at ${fmt(t)}`);
    rec.seekTick(0);
  }

  /** Lines up the bar that is starting now (the nearest bar line) with the recording's playhead. */
  function syncTap() {
    const rec = recordingRef.current;
    const clock = clockRef.current;
    if (!rec || !clock) return;
    const timing = clock.timing;
    const tick = rec.currentTick();
    let bar = barAt(timing, tick);
    if (tick - timing.starts[bar] > timing.lengths[bar] / 2 && bar < timing.starts.length - 1) bar++;
    const t = Math.round(rec.mediaTime() * 1000) / 1000;
    commitSync(rec, bar === 0 ? t : rec.offset, addSyncPoint(rec.sync, bar, t));
    moveCursor(rec.currentTick());
  }
  const syncTapRef = useRef(syncTap);
  syncTapRef.current = syncTap;

  function clearSync() {
    const rec = recordingRef.current;
    setConfirmClear(false);
    if (!rec) return;
    const tick = rec.currentTick();
    commitSync(rec, rec.offset, []);
    rec.seekTick(tick);
  }

  function openExternally() {
    invoke("open_with_default", { path: filePath }).catch((err) => setError(errMsg(err)));
  }

  function toggleSet(set: Set<number>, setter: (s: Set<number>) => void, i: number): Set<number> {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setter(next);
    return next;
  }

  const usingRecording = Boolean(audioPath);
  const totalBars = song?.tracks[0].measures.length ?? 0;

  return (
    <div className="tab-player" role="dialog" aria-label="Tab player">
      <div className="tab-player-header">
        <div className="tab-player-title-group">
          <span className="tab-player-title">{song ? song.title : "Loading tab…"}</span>
          {song?.artist && <span className="tab-player-artist">{song.artist}</span>}
        </div>
        <div className="tab-player-header-actions">
          <button className="btn-secondary" onClick={openExternally}>Open in Guitar Pro</button>
          <button className="tab-player-close" onClick={onClose} aria-label="Close" title="Close">
            <XMarkIcon style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>

      {song && (
        <>
          <div className="tab-player-controls">
            <button
              className="tab-player-play"
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause" : "Play"}
              onClick={togglePlay}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <button className="btn-secondary" title="Back to the start" aria-label="Restart" onClick={restart}>⏮</button>
            <span className="tab-player-bar">Bar {currentBar + 1} / {totalBars}</span>

            <label className="tab-player-field">
              Track
              <select className="tab-track-select" value={trackSel} onChange={(e) => setTrackSel(e.target.value)}>
                {song.tracks.map((t, i) => (
                  <option key={i} value={String(i)}>{t.name}</option>
                ))}
                {song.tracks.length > 1 && <option value={ALL_TRACKS}>All tracks</option>}
              </select>
            </label>

            <label className="tab-player-field">
              Speed
              <input
                type="range"
                min={25}
                max={150}
                step={5}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Speed"
              />
              <span className="tab-player-speed">{speed}%</span>
            </label>

            <label className="tab-player-field">
              Loop bars
              <input className="tab-player-num" type="number" min={1} max={totalBars} value={loopFrom} placeholder="from" onChange={(e) => setLoopFrom(e.target.value)} aria-label="Loop from bar" />
              –
              <input className="tab-player-num" type="number" min={1} max={totalBars} value={loopTo} placeholder="to" onChange={(e) => setLoopTo(e.target.value)} aria-label="Loop to bar" />
              {(loopFrom || loopTo) && (
                <button className="btn-secondary" onClick={() => { setLoopFrom(""); setLoopTo(""); }}>Clear</button>
              )}
            </label>
          </div>

          <div className="tab-player-controls tab-player-controls--secondary">
            {audioCandidates.length > 0 && (
              <label className="tab-player-field">
                Audio
                <select className="tab-audio-select" value={audioPath} onChange={(e) => setAudioPath(e.target.value)}>
                  <option value="">Synth (no recording)</option>
                  {audioCandidates.map((r) => (
                    <option key={r.url} value={r.url}>{r.name}</option>
                  ))}
                </select>
              </label>
            )}
            {usingRecording && (
              <>
                <span className="tab-audio-status">{audioStatus}</span>
                <button
                  className="btn-secondary"
                  title="Play the recording to where bar 1 starts, pause, then press this"
                  onClick={setBarOneHere}
                >
                  Bar 1 starts here
                </button>
                <button
                  className="btn-secondary"
                  title="While the recording plays, press at the start of a bar (or press B) so the tab follows the recording from there"
                  onClick={syncTap}
                >
                  Sync this bar
                </button>
                {sync.length > 0 && (
                  <button className="btn-secondary" onClick={() => setConfirmClear(true)}>Clear sync points</button>
                )}
                <span className="tab-sync-count tab-player-hint">{syncLabel(sync)}</span>
                {offset > 0 && <span className="tab-player-hint">bar 1 at {fmt(offset)}</span>}
              </>
            )}
            {!usingRecording && (
              <>
                <label className="tab-player-check"><input type="checkbox" checked={metronome} onChange={(e) => setMetronome(e.target.checked)} /> Metronome</label>
                <label className="tab-player-check"><input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} /> Count-in</label>
                <label className="tab-player-field">
                  Sound
                  <select value={voice} onChange={(e) => setVoice(e.target.value as VoiceKind)}>
                    <option value="pluck">Plucked string</option>
                    <option value="synth">Synth</option>
                  </select>
                </label>
                <button className="btn-secondary" onClick={() => setMixerOpen((v) => !v)}>{mixerOpen ? "Hide mixer" : "Mixer"}</button>
              </>
            )}
            <label className="tab-player-check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow cursor</label>
          </div>

          {mixerOpen && !usingRecording && (
            <div className="tab-player-mixer">
              {song.tracks.map((t, i) => (
                <div className="tab-player-mixer-row" key={i}>
                  <span className="tab-player-mixer-name">{t.name}</span>
                  <button
                    className={`btn-secondary${muted.has(i) ? " tab-player-on" : ""}`}
                    onClick={() => { const n = toggleSet(muted, setMuted, i); synthRef.current?.setMuted(i, n.has(i)); }}
                  >Mute</button>
                  <button
                    className={`btn-secondary${solo.has(i) ? " tab-player-on" : ""}`}
                    onClick={() => { const n = toggleSet(solo, setSolo, i); synthRef.current?.setSolo(i, n.has(i)); }}
                  >Solo</button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volumes[i] ?? 0.8}
                    aria-label={`${t.name} volume`}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolumes((prev) => prev.map((p, k) => (k === i ? v : p)));
                      synthRef.current?.setVolume(i, v);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="tab-player-scroll" ref={scrollRef}>
        <div className="tab-player-sheet" ref={hostRef} onClick={onSheetClick} />
      </div>

      {confirmClear && (
        <ConfirmModal
          title={`Clear ${sync.length} sync point${sync.length === 1 ? "" : "s"}?`}
          message="The tab will follow the recording from where bar 1 starts at its written tempo only."
          confirmLabel="Clear sync points"
          onConfirm={clearSync}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {error && (
        <ErrorModal
          error={error}
          onDismiss={() => {
            setError(null);
            if (failedLoading) onClose();
          }}
        />
      )}
    </div>
  );
}
