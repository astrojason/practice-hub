import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { XMarkIcon } from "@heroicons/react/16/solid";
import { ErrorModal } from "../ErrorModal";
import { ConfirmModal } from "../ConfirmModal";
import { assetUrl } from "../player/useAudioEngine";
import { useStems, STEM_NAMES, STEM_LABELS } from "../player/useStems";
import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";
import type { Resource } from "../../api/types";
import { barAt, renderTracks, type TabLayout } from "./tabRender";
import { renderChordSheet, type ChordSheetLayout } from "./chordSheet";
import {
  addBar, barStatus, caretFromPoint, clampCaret, clearBeat, deleteBar, deleteBeat, DRUM_FOR_LINE, DURATIONS, insertBeat, isError,
  moveCaret, removeNote, setDuration, setFret, stepDuration, toggleDot, toggleDrum, type Caret, type EditResult,
} from "./tabEditor";
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
const VIEW_KEY = "tabPlayerView";

type DisplayMode = "tab" | "chords";

/** What is remembered per tab: which tracks are shown, the display, and recording-or-synth. */
interface StoredView {
  tracks?: number[];
  mode?: DisplayMode;
  /** The chosen recording's path; "" means the synth was chosen on purpose. */
  audio?: string;
}

function readView(filePath: string): { view: StoredView; error: string | null } {
  const saved = readLocalStorageJSON<Record<string, StoredView>>(VIEW_KEY, {});
  return { view: saved.value[filePath] ?? {}, error: saved.error };
}

/** The separated instrument (stem) a track's sound lives in, if there is one. */
function stemFor(instrument: string): string | null {
  return instrument === "guitar" || instrument === "bass" || instrument === "drums" ? instrument : null;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

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
  /** The song as loaded from the file; the player's synth is built on it. */
  const [loadedSong, setLoadedSong] = useState<TabSong | null>(null);
  const [editing, setEditing] = useState(false);
  const [caret, setCaret] = useState<Caret>({ bar: 0, beat: 0, string: 1 });
  const [dirty, setDirty] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<"done" | "close" | null>(null);
  const [confirmDeleteBar, setConfirmDeleteBar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedLoading, setFailedLoading] = useState(false);

  const [initial] = useState(() => readView(filePath));
  const [shownTracks, setShownTracks] = useState<number[]>([0]);
  const [currentTrack, setCurrentTrack] = useState(0);
  const [mode, setMode] = useState<DisplayMode>(initial.view.mode === "chords" ? "chords" : "tab");
  const [tracksOpen, setTracksOpen] = useState(false);
  const [transpose, setTranspose] = useState(0);
  const [pitchSemis, setPitchSemis] = useState(0);
  const [pitchCents, setPitchCents] = useState(0);
  /** With a recording, pitch shifting waits for (and needs) the pitch shifter to be wired up. */
  const [shifterReady, setShifterReady] = useState(false);
  /** Instruments muted in the recording (needs the recording to have been separated into stems). */
  const [mutedStems, setMutedStems] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [loopFrom, setLoopFrom] = useState("");
  const [loopTo, setLoopTo] = useState("");
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [voice, setVoice] = useState<VoiceKind>("pluck");
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [solo, setSolo] = useState<Set<number>>(new Set());
  const [volumes, setVolumes] = useState<number[]>([]);
  const [currentBar, setCurrentBar] = useState(0);
  const [follow, setFollow] = useState(true);

  const [audioPath, setAudioPath] = useState<string>(() => {
    const candidates = (resources ?? []).filter((r) => r.type === "local_file" && MEDIA_EXTS.includes(extOf(r.url)));
    const stored = initial.view.audio;
    if (stored === "") return "";
    if (stored && candidates.some((r) => r.url === stored)) return stored;
    // A recording on the item is what you practise along with, so it is the default.
    return candidates[0]?.url ?? "";
  });
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
  const chordRef = useRef<ChordSheetLayout | null>(null);
  const modeRef = useRef<DisplayMode>(mode);
  modeRef.current = editing ? "tab" : mode;
  const pitchRef = useRef(0);
  pitchRef.current = pitchSemis + pitchCents / 100;
  const transposeRef = useRef(0);
  transposeRef.current = transpose;
  const dragRef = useRef<{ start: number; end: number; moved: boolean } | null>(null);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  /** Snapshots of the tracks' bars before each edit, for undo. */
  const historyRef = useRef<string[]>([]);
  /** The song as last loaded or saved, which discarding goes back to. */
  const baselineRef = useRef<TabSong | null>(null);
  const lastDigitRef = useRef<{ at: number; value: number | null; bar: number; beat: number; string: number } | null>(null);

  // Keyed on the content so a parent re-render with an equal list doesn't reset the recording.
  const resourcesKey = JSON.stringify(resources);
  const audioCandidates = useMemo(
    () => (JSON.parse(resourcesKey) as Resource[]).filter((r) => r.type === "local_file" && MEDIA_EXTS.includes(extOf(r.url))),
    [resourcesKey]
  );

  const stems = useStems(audioPath, mutedStems, (msg) => setError((prev) => prev ?? msg));

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
    if (!clock || (!layout && modeRef.current !== "chords")) return;
    const timing = clock.timing;
    const bar = barAt(timing, tick);
    setCurrentBar((prev) => (prev === bar ? prev : bar));
    const active = Boolean(synthRef.current?.playing || recordingRef.current?.playing);
    if (modeRef.current === "chords") {
      chordRef.current?.bars.forEach((b, i) => b.el.classList.toggle("playing", i === bar && (active || tick > 0)));
      return;
    }
    const info = layout?.bars[bar];
    if (!info || !layout) return;
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
    if (!layout) return;
    const line = layout.lines[info.line];
    const cur = layout.cursor;
    cur.style.left = `${x - 10}px`;
    cur.style.top = `${line.el.offsetTop + layout.geo.cursorTop - 10}px`;
    cur.style.height = `${layout.geo.cursorBottom - layout.geo.cursorTop + 20}px`;
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
        setLoadedSong(parsed);
        baselineRef.current = parsed;
        setVolumes(parsed.tracks.map(() => 0.8));
        const stored = (initial.view.tracks ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < parsed.tracks.length);
        const tracks = stored.length ? stored : [0];
        setShownTracks(tracks);
        setCurrentTrack(tracks[0]);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errMsg(err));
        setFailedLoading(true);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, initial]);

  // Report a problem reading the remembered view.
  useEffect(() => {
    if (initial.error) setError(initial.error);
  }, [initial]);

  // Remember the view for this tab.
  useEffect(() => {
    if (!song) return;
    const saved = readLocalStorageJSON<Record<string, StoredView>>(VIEW_KEY, {});
    if (saved.error) {
      setError(saved.error);
      return;
    }
    try {
      writeLocalStorageJSON(VIEW_KEY, { ...saved.value, [filePath]: { tracks: shownTracks, mode, audio: audioPath } });
    } catch (err) {
      setError(`Couldn't remember the tab view: ${errMsg(err)}`);
    }
  }, [song, filePath, shownTracks, mode, audioPath]);

  // ── The synth transport for the loaded song ─────────────────────────────────
  useEffect(() => {
    if (!loadedSong) return;
    const synth = new SynthPlayer({
      onTick: (t) => moveCursor(t),
      onState: (p) => setPlaying(p),
      onError: (e) => setError(e.message),
    });
    synth.load(loadedSong);
    synth.setSpeed(speedRef.current);
    synth.setLoop(loopRef.current);
    synthRef.current = synth;
    clockRef.current = songClock(loadedSong);
    return () => {
      synth.dispose();
      if (synthRef.current === synth) synthRef.current = null;
    };
  }, [loadedSong, moveCursor]);

  // An edit changes what the synth plays and how long the bars are.
  useEffect(() => {
    if (!song) return;
    synthRef.current?.reload(song);
    clockRef.current = songClock(song);
  }, [song]);

  // ── Draw the tab ────────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!song || !host) return;
    function draw() {
      if (!host || !song) return;
      if (mode === "chords" && !editing) {
        layoutRef.current = null;
        chordRef.current = renderChordSheet(host, song, currentTrack, transpose);
        chordRef.current.bars.forEach((b, i) => b.el.classList.toggle("in-loop", Boolean(loop && i >= loop[0] && i <= loop[1])));
      } else {
        chordRef.current = null;
        layoutRef.current = renderTracks(host, song, editing ? [currentTrack] : shownTracks, {
          width: host.clientWidth,
          loop,
          transpose,
          currentTrack,
          caret: editing ? clampCaret(song, currentTrack, caret) : null,
        });
      }
      moveCursor(tickRef.current);
    }
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(host);
    return () => ro.disconnect();
  }, [song, shownTracks, loop, moveCursor, mode, currentTrack, transpose, editing, caret]);

  // ── Which transport is active ───────────────────────────────────────────────
  const transport = (): Transport | null => recordingRef.current ?? synthRef.current;

  // ── Attach / detach a recording ─────────────────────────────────────────────
  const effectiveAudio = editing ? "" : audioPath;
  useEffect(() => {
    if (!song) return;
    if (!effectiveAudio) {
      setAudioStatus("");
      // Back to the synth: pick up where the recording left off.
      synthRef.current?.seekTick(tickRef.current);
      return;
    }
    const name = audioCandidates.find((r) => r.url === effectiveAudio)?.name ?? effectiveAudio;
    const wasTick = tickRef.current;
    synthRef.current?.pause();
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    setAudioStatus(`Loading ${name}…`);
    const saved = readLocalStorageJSON<Record<string, StoredSync | number>>(SYNC_KEY, {});
    if (saved.error) setError(saved.error);
    const stored = saved.value[`${filePath}|${effectiveAudio}`];
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
      setError(`Couldn't load the recording "${name}" (${effectiveAudio}): ${code}`);
      setAudioPath("");
    });
    audio.src = assetUrl(effectiveAudio);
    rec.srcUrl = audio.src;
    recordingRef.current = rec;
    setShifterReady(false);
    rec
      .enablePitchShift()
      .then(() => {
        if (disposed) return;
        rec.setPitchShift(pitchRef.current);
        setShifterReady(true);
      })
      .catch((err) => {
        if (!disposed) setError(errMsg(err));
      });
    return () => {
      disposed = true;
      rec.dispose();
      if (recordingRef.current === rec) recordingRef.current = null;
    };
  }, [effectiveAudio, song, filePath, audioCandidates, moveCursor]);

  // Play the mix of the unmuted instruments, or the original again when nothing is muted.
  useEffect(() => {
    const rec = recordingRef.current;
    if (!rec || !audioPath || editing) return;
    const url = new URL(assetUrl(stems.mixPath ?? audioPath)).href;
    if (new URL(rec.srcUrl, window.location.href).href === url) return;
    rec.swapSource(url).catch((err) => setError(errMsg(err)));
  }, [stems.mixPath, audioPath, editing]);

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
    synthRef.current?.setPitch(transpose, pitchSemis + pitchCents / 100);
    recordingRef.current?.setPitchShift(pitchSemis + pitchCents / 100);
  }, [transpose, pitchSemis, pitchCents, song, audioPath]);
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

  const setLoopRange = useCallback((a: number, b: number) => {
    setLoopFrom(String(Math.min(a, b) + 1));
    setLoopTo(String(Math.max(a, b) + 1));
  }, []);
  const clearLoop = useCallback(() => {
    setLoopFrom("");
    setLoopTo("");
  }, []);

  function chooseAudio(path: string) {
    setMutedStems([]);
    setAudioPath(path);
  }

  function toggleSource() {
    if (audioPath) chooseAudio("");
    else if (audioCandidates.length) chooseAudio(audioCandidates[0].url);
  }

  function currentBarNow(): number {
    const clock = clockRef.current;
    return clock ? barAt(clock.timing, tickRef.current) : 0;
  }

  // ── Editing ─────────────────────────────────────────────────────────────────
  function snapshot() {
    if (!song) return;
    historyRef.current.push(JSON.stringify(song.tracks.map((t) => t.measures)));
    if (historyRef.current.length > 200) historyRef.current.shift();
    setDirty(true);
  }

  /** Applies an edit that succeeded, or shows why it couldn't be made. */
  function applyEdit(r: EditResult): boolean {
    if (isError(r)) {
      setError(r.error);
      return false;
    }
    setSong(r.song);
    setCaret(r.caret);
    return true;
  }

  /** Runs an edit on the caret's beat, remembering the song first so it can be undone. */
  function edit(fn: (song: TabSong, track: number, caret: Caret) => EditResult) {
    if (!song) return;
    lastDigitRef.current = null;
    const r = fn(song, currentTrack, caret);
    if (isError(r)) {
      setError(r.error);
      return;
    }
    snapshot();
    setSong(r.song);
    setCaret(r.caret);
  }

  function moveEditCaret(dBeat: number, dString: number) {
    if (!song) return;
    lastDigitRef.current = null;
    setCaret(moveCaret(song, currentTrack, caret, dBeat, dString));
  }

  function typeDigit(d: number) {
    if (!song) return;
    const track = song.tracks[currentTrack];
    if (track.instrument === "drums") {
      edit((sg, t, c) => toggleDrum(sg, t, c, DRUM_FOR_LINE[c.string] ?? 38));
      return;
    }
    const now = performance.now();
    const last = lastDigitRef.current;
    let fret = d;
    // A second digit soon after the first, on the same note, makes a two-digit fret (one undo step).
    const joins = last && last.value != null && now - last.at < 900 && last.bar === caret.bar && last.beat === caret.beat && last.string === caret.string && last.value * 10 + d <= 30;
    if (joins) fret = (last.value as number) * 10 + d;
    else snapshot();
    lastDigitRef.current = { at: now, value: fret < 10 ? fret : null, bar: caret.bar, beat: caret.beat, string: caret.string };
    applyEdit(setFret(song, currentTrack, caret, fret));
  }

  function undo() {
    const prev = historyRef.current.pop();
    if (!prev || !song) return;
    lastDigitRef.current = null;
    const measures = JSON.parse(prev) as TabSong["tracks"][number]["measures"][];
    const next = structuredClone(song);
    next.tracks.forEach((t, i) => {
      t.measures = measures[i];
    });
    setSong(next);
    setCaret((c) => clampCaret(next, currentTrack, c));
    setDirty(true);
  }

  function startEditing() {
    if (!song) return;
    historyRef.current = [];
    lastDigitRef.current = null;
    setCaret({ bar: 0, beat: 0, string: 1 });
    setEditing(true);
  }

  function leaveEditing() {
    setConfirmDiscard(null);
    if (baselineRef.current) setSong(baselineRef.current);
    historyRef.current = [];
    setDirty(false);
    setEditing(false);
  }

  function requestDone() {
    if (dirty) setConfirmDiscard("done");
    else {
      historyRef.current = [];
      setEditing(false);
    }
  }

  function requestClose() {
    if (editing && dirty) setConfirmDiscard("close");
    else onClose();
  }

  async function saveCopy() {
    if (!song || saving) return;
    setSaving(true);
    try {
      const path = await invoke<string>("save_tab_copy", { filePath, songJson: JSON.stringify(song) });
      baselineRef.current = song;
      setSavedPath(path);
      setDirty(false);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  function openSaved() {
    if (savedPath) invoke("open_with_default", { path: savedPath }).catch((err) => setError(errMsg(err)));
  }

  useEffect(() => {
    if (editing && song) setCaret((c) => clampCaret(song, currentTrack, c));
  }, [editing, song, currentTrack]);

  keyRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return;
    if (error || confirmClear || confirmDiscard || confirmDeleteBar) return;
    if (editing && song) {
      const k = e.key;
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "s") {
        e.preventDefault();
        void saveCopy();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (!(e.metaKey || e.ctrlKey || e.altKey)) {
        const drums = song.tracks[currentTrack].instrument === "drums";
        const used = (() => {
          if (/^[0-9]$/.test(k)) { typeDigit(Number(k)); return true; }
          switch (k) {
            case "ArrowRight": moveEditCaret(1, 0); return true;
            case "ArrowLeft": moveEditCaret(-1, 0); return true;
            case "ArrowUp": moveEditCaret(0, -1); return true;
            case "ArrowDown": moveEditCaret(0, 1); return true;
            case "Backspace":
            case "Delete": {
              const beat = song.tracks[currentTrack].measures[caret.bar]?.beats[caret.beat];
              if (beat?.notes.some((n) => n.string === caret.string)) edit(removeNote);
              return true;
            }
            case "Enter": edit(insertBeat); return true;
            case "+":
            case "=": edit((sg, t, c) => stepDuration(sg, t, c, -1)); return true;
            case "-":
            case "_": edit((sg, t, c) => stepDuration(sg, t, c, 1)); return true;
            case ".": edit(toggleDot); return true;
            case "r":
            case "R": edit(clearBeat); return true;
            case "x":
            case "X": if (drums) { edit((sg, t, c) => toggleDrum(sg, t, c, DRUM_FOR_LINE[c.string] ?? 38)); return true; } return false;
            case "o":
            case "O": if (drums && caret.string === 2) { edit((sg, t, c) => toggleDrum(sg, t, c, 46)); return true; } return false;
            case "Escape": requestDone(); return true;
            default: return false;
          }
        })();
        if (used) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const clock = clockRef.current;
    const bars = clock ? clock.timing.starts.length : 0;
    switch (e.key) {
      case " ":
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
        break;
      case "ArrowRight":
        e.preventDefault();
        if (clock) transport()?.seekTick(clock.timing.starts[Math.min(bars - 1, currentBarNow() + 1)]);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (clock) transport()?.seekTick(clock.timing.starts[Math.max(0, currentBarNow() - 1)]);
        break;
      case "Home":
        e.preventDefault();
        restart();
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "s":
      case "S":
        document.querySelector<HTMLInputElement>(".tab-player input[aria-label='Speed']")?.focus();
        break;
      case "l":
      case "L":
        if (loopRef.current) clearLoop();
        else setLoopRange(currentBarNow(), currentBarNow());
        break;
      case "t":
      case "T":
        setTracksOpen((v) => !v);
        break;
      case "b":
      case "B":
        if (recordingRef.current) syncTapRef.current();
        break;
      case "v":
      case "V":
        toggleSource();
        break;
      case "Escape":
        requestClose();
        break;
      default:
        break;
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  /** Mouse down on a bar: a click moves the cursor there, a drag across bars selects a loop. */
  function onSheetMouseDown(ev: React.MouseEvent) {
    if (ev.button !== 0) return;
    const hit = (ev.target as Element).closest("[data-bar]") as HTMLElement | null;
    const clock = clockRef.current;
    if (!hit || !clock) return;
    const bar = Number(hit.dataset.bar);
    if (editing && song) {
      const layout = layoutRef.current;
      const svg = (hit as unknown as SVGElement).ownerSVGElement;
      if (!layout || !svg || !layout.bars[bar]) return;
      const rect = svg.getBoundingClientRect();
      lastDigitRef.current = null;
      setCaret(caretFromPoint(bar, layout.bars[bar].beats, ev.clientX - rect.left, ev.clientY - rect.top, layout.geo, song.tracks[currentTrack].strings.length));
      return;
    }
    if (hit.dataset.track != null) {
      const t = Number(hit.dataset.track);
      setCurrentTrack((prev) => (prev === t ? prev : t));
    }
    if (ev.shiftKey) {
      setLoopRange(currentBarNow(), bar);
      return;
    }
    const drag = { start: bar, end: bar, moved: false };
    dragRef.current = drag;
    const move = (e: MouseEvent) => {
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-bar]") as HTMLElement | null;
      if (!under) return;
      const b = Number(under.dataset.bar);
      if (b === drag.end) return;
      drag.end = b;
      drag.moved = true;
      setLoopRange(drag.start, b);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      dragRef.current = null;
      if (drag.moved) setLoopRange(drag.start, drag.end);
      else transport()?.seekTick(clock.timing.starts[drag.start]);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
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

  const trackStem = stemFor(song?.tracks[currentTrack]?.instrument ?? "");
  const stemNames = STEM_NAMES.filter((n) => stems.stems?.some((st) => st.name === n));
  const stemSoloed = Boolean(trackStem) && stemNames.length > 1 && stemNames.filter((n) => n !== trackStem).every((n) => mutedStems.includes(n)) && !mutedStems.includes(trackStem as string);
  const stemMuted = Boolean(trackStem) && !stemSoloed && mutedStems.includes(trackStem as string);

  function toggleFlag(kind: "mute" | "solo") {
    if (usingRecording) {
      if (!trackStem || stems.status !== "ready") return;
      if (kind === "mute") {
        setMutedStems(mutedStems.includes(trackStem) ? mutedStems.filter((n) => n !== trackStem) : [...mutedStems, trackStem]);
      } else {
        setMutedStems(stemSoloed ? [] : stemNames.filter((n) => n !== trackStem));
      }
      return;
    }
    if (kind === "mute") {
      const n = toggleSet(muted, setMuted, currentTrack);
      synthRef.current?.setMuted(currentTrack, n.has(currentTrack));
    } else {
      const n = toggleSet(solo, setSolo, currentTrack);
      synthRef.current?.setSolo(currentTrack, n.has(currentTrack));
    }
  }

  function setTrackShown(i: number, on: boolean) {
    const next = on ? [...shownTracks, i].sort((a, b) => a - b) : shownTracks.filter((t) => t !== i);
    if (!next.length) return;
    setShownTracks(next);
    if (!next.includes(currentTrack)) setCurrentTrack(next[0]);
  }

  const usingRecording = Boolean(audioPath) && !editing;
  const pitchDisabled = usingRecording && !shifterReady;
  const totalBars = song?.tracks[0].measures.length ?? 0;

  return (
    <div className="tab-player" role="dialog" aria-label="Tab player">
      <div className="tab-player-header">
        <div className="tab-player-title-group">
          <span className="tab-player-title">{song ? song.title : "Loading tab…"}</span>
          {song?.artist && <span className="tab-player-artist">{song.artist}</span>}
          {song && (
            <span className="tab-player-info">
              {totalBars} bars · {song.tracks.length} tracks · {song.tempo} bpm · {song.time[0]}/{song.time[1]}
              {song.author ? ` · written by ${song.author}` : ""}
              {song.revised ? ` · revised ${song.revised}` : ""}
            </span>
          )}
        </div>
        <div className="tab-player-header-actions">
          {song && (
            <button
              className={`btn-secondary${editing ? " tab-player-on" : ""}`}
              aria-label="Edit tab"
              aria-pressed={editing}
              title="Edit the tab; changes are saved as a new .gp file next to this one"
              onClick={editing ? requestDone : startEditing}
            >
              Edit
            </button>
          )}
          <button className="btn-secondary" onClick={openExternally}>Open in Guitar Pro</button>
          <button className="tab-player-close" onClick={requestClose} aria-label="Close" title="Close">
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
            <button className="btn-secondary" title="Back to the start (Home)" aria-label="Restart" onClick={restart}>⏮</button>
            <span className="tab-player-bar">Bar {currentBar + 1} / {totalBars}</span>

            <label className="tab-player-field">
              Display
              <select value={mode} onChange={(e) => setMode(e.target.value as DisplayMode)}>
                <option value="tab">Tab</option>
                <option value="chords">Chords</option>
              </select>
            </label>

            <button
              className={`btn-secondary${tracksOpen ? " tab-player-on" : ""}`}
              title="Choose which tracks are shown (T)"
              aria-expanded={tracksOpen}
              onClick={() => setTracksOpen((v) => !v)}
            >
              Tracks
            </button>

            <label className="tab-player-field">
              Speed
              <input
                type="range"
                min={15}
                max={175}
                step={1}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Speed"
              />
              <span className="tab-player-speed">{speed}%</span>
            </label>
            {[50, 75, 100, 125].map((p) => (
              <button key={p} className="btn-secondary tab-player-chip" title={`${p}% of the written tempo`} onClick={() => setSpeed(p)}>{p}%</button>
            ))}

            <label className="tab-player-field">
              Loop bars
              <input className="tab-player-num" type="number" min={1} max={totalBars} value={loopFrom} placeholder="from" onChange={(e) => setLoopFrom(e.target.value)} aria-label="Loop from bar" />
              –
              <input className="tab-player-num" type="number" min={1} max={totalBars} value={loopTo} placeholder="to" onChange={(e) => setLoopTo(e.target.value)} aria-label="Loop to bar" />
              {(loopFrom || loopTo) && (
                <button className="btn-secondary" onClick={clearLoop}>Clear</button>
              )}
            </label>
            <span className="tab-player-hint">Drag across bars to loop them (L: loop this bar)</span>
          </div>

          <div className="tab-player-controls tab-player-controls--secondary">
            {audioCandidates.length > 0 && (
              <label className="tab-player-field">
                Audio
                <select className="tab-audio-select" value={audioPath} onChange={(e) => chooseAudio(e.target.value)} disabled={editing} title="Play along with a recording, or the synth (V)">
                  <option value="">Synth (no recording)</option>
                  {audioCandidates.map((r) => (
                    <option key={r.url} value={r.url}>{r.name}</option>
                  ))}
                </select>
              </label>
            )}

            <span className="tab-player-field">
              Pitch
              <input className="tab-player-num" type="number" min={-12} max={12} step={1} value={pitchSemis} aria-label="Pitch semitones" disabled={pitchDisabled}
                onChange={(e) => setPitchSemis(Math.max(-12, Math.min(12, Math.round(Number(e.target.value)) || 0)))} />
              <input className="tab-player-num" type="number" min={-99} max={99} step={1} value={pitchCents} aria-label="Pitch cents" disabled={pitchDisabled}
                onChange={(e) => setPitchCents(Math.max(-99, Math.min(99, Math.round(Number(e.target.value)) || 0)))} />
              <span className="tab-pitch-value">{signed(pitchSemis)} st {signed(pitchCents)} ¢</span>
              {(pitchSemis !== 0 || pitchCents !== 0) && (
                <button className="btn-secondary" onClick={() => { setPitchSemis(0); setPitchCents(0); }}>Reset pitch</button>
              )}
            </span>
            <label className="tab-player-field" title="Moves every note up or down: the tab and the sound both change">
              Transpose
              <input className="tab-player-num" type="number" min={-12} max={12} step={1} value={transpose}
                onChange={(e) => setTranspose(Math.max(-12, Math.min(12, Math.round(Number(e.target.value)) || 0)))} />
            </label>

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
            <button
              className={`btn-secondary${(usingRecording ? stemMuted : muted.has(currentTrack)) ? " tab-player-on" : ""}`}
              aria-label="Mute track"
              aria-pressed={usingRecording ? stemMuted : muted.has(currentTrack)}
              disabled={usingRecording && (!trackStem || stems.status !== "ready")}
              title={usingRecording ? (trackStem ? (stems.status === "ready" ? `Mute the ${trackStem} in the recording` : "Separate the instruments first") : "This track has no matching instrument in the recording") : `Mute ${song.tracks[currentTrack]?.name ?? "this track"}`}
              onClick={() => toggleFlag("mute")}
            >Mute</button>
            <button
              className={`btn-secondary${(usingRecording ? stemSoloed : solo.has(currentTrack)) ? " tab-player-on" : ""}`}
              aria-label="Solo track"
              aria-pressed={usingRecording ? stemSoloed : solo.has(currentTrack)}
              disabled={usingRecording && (!trackStem || stems.status !== "ready")}
              title={usingRecording ? (trackStem ? (stems.status === "ready" ? `Hear only the ${trackStem} in the recording` : "Separate the instruments first") : "This track has no matching instrument in the recording") : `Play ${song.tracks[currentTrack]?.name ?? "this track"} solo`}
              onClick={() => toggleFlag("solo")}
            >Solo</button>
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
              </>
            )}
            <label className="tab-player-check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow cursor</label>
          </div>

          {editing && (() => {
            const c = clampCaret(song, currentTrack, caret);
            const durOn = song.tracks[currentTrack].measures[c.bar].beats[c.beat];
            return (
              <div className="tab-player-controls tab-edit-bar">
                {DURATIONS.map((d) => (
                  <button key={d.dur} className={`btn-secondary tab-edit-btn${durOn.dur === d.dur ? " tab-player-on" : ""}`} aria-label={d.title} title={d.title} onClick={() => edit((sg, t, cr) => setDuration(sg, t, cr, d.dur))}>{d.label}</button>
                ))}
                <button className={`btn-secondary tab-edit-btn${durOn.dotted ? " tab-player-on" : ""}`} aria-label="Dotted" title="Dotted (.)" onClick={() => edit(toggleDot)}>•</button>
                <button className="btn-secondary tab-edit-btn" title="Make this beat a rest (R)" onClick={() => edit(clearBeat)}>Rest</button>
                <span className="tab-edit-sep" />
                <button className="btn-secondary tab-edit-btn" title="Add a beat after this one (Enter)" onClick={() => edit(insertBeat)}>+ Beat</button>
                <button className="btn-secondary tab-edit-btn" title="Remove this beat" onClick={() => edit(deleteBeat)}>− Beat</button>
                <button className="btn-secondary tab-edit-btn" title="Add a bar after this one, in every track" onClick={() => edit(addBar)}>+ Bar</button>
                <button className="btn-secondary tab-edit-btn" title="Delete this bar from every track" onClick={() => setConfirmDeleteBar(true)}>− Bar</button>
                <span className="tab-edit-sep" />
                <button className="btn-secondary tab-edit-btn" title="Undo (Cmd/Ctrl+Z)" onClick={undo}>Undo</button>
                <button className="btn-primary tab-edit-btn" title="Save as a new .gp file next to the original (Cmd/Ctrl+S)" disabled={saving} onClick={() => void saveCopy()}>Save as new .gp</button>
                <button className="btn-secondary tab-edit-btn" onClick={requestDone}>Done</button>
                <span className="tab-edit-status" aria-live="polite">
                  {barStatus(song, currentTrack, c.bar)}
                  {dirty ? " · unsaved changes" : savedPath ? ` · Saved as ${savedPath}` : ""}
                </span>
                {savedPath && (
                  <button className="btn-secondary tab-edit-btn" onClick={openSaved}>Open the saved copy</button>
                )}
                <span className="tab-player-hint">Type frets, arrows move, Backspace removes, Enter adds a beat, +/− change the note value, . dots it. Only the current track is shown while editing.</span>
              </div>
            );
          })()}

          {usingRecording && stems.status !== "unavailable" && (
            <div className="tab-player-controls tab-stems">
              <span className="tab-player-field">Instruments in the recording</span>
              {stems.status === "checking" && <span className="tab-player-hint">Checking…</span>}
              {stems.status === "none" && (
                <>
                  <button className="btn-secondary" onClick={stems.separate}>Separate instruments</button>
                  <span className="tab-player-hint">Splits the recording so you can mute or solo the track you are learning (takes a few minutes the first time).</span>
                </>
              )}
              {stems.status === "separating" && <span className="tab-player-hint">Separating instruments… this takes a few minutes.</span>}
              {stems.status === "ready" && (
                <>
                  {stemNames.map((n) => (
                    <label key={n} className="tab-player-check">
                      <input
                        type="checkbox"
                        checked={!mutedStems.includes(n)}
                        onChange={() => setMutedStems(mutedStems.includes(n) ? mutedStems.filter((m) => m !== n) : [...mutedStems, n])}
                      />
                      {STEM_LABELS[n]}
                    </label>
                  ))}
                  {stems.mixing && <span className="tab-player-hint">Mixing…</span>}
                  {mutedStems.length > 0 && <button className="btn-secondary" onClick={() => setMutedStems([])}>Unmute all</button>}
                </>
              )}
            </div>
          )}

          {tracksOpen && (
            <div className="tab-player-mixer tab-tracks-panel">
              {song.tracks.map((t, i) => {
                const shown = shownTracks.includes(i);
                return (
                  <div className={`tab-player-mixer-row${i === currentTrack ? " current" : ""}`} key={i}>
                    <input
                      type="checkbox"
                      aria-label={`Show ${t.name}`}
                      checked={shown}
                      disabled={shown && shownTracks.length === 1}
                      onChange={(e) => setTrackShown(i, e.target.checked)}
                    />
                    <button className="tab-player-mixer-name" title="Make this the current track" onClick={() => { setTrackShown(i, true); setCurrentTrack(i); }}>
                      {t.name}{i === currentTrack ? " (current)" : ""}
                    </button>
                    {!usingRecording && (
                      <>
                        <button
                          className={`btn-secondary${muted.has(i) ? " tab-player-on" : ""}`}
                          aria-label={`Mute ${t.name}`}
                          onClick={() => { const n = toggleSet(muted, setMuted, i); synthRef.current?.setMuted(i, n.has(i)); }}
                        >Mute</button>
                        <button
                          className={`btn-secondary${solo.has(i) ? " tab-player-on" : ""}`}
                          aria-label={`Solo ${t.name}`}
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
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="tab-player-scroll" ref={scrollRef}>
        <div className="tab-player-sheet" ref={hostRef} onMouseDown={onSheetMouseDown} />
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

      {confirmDiscard && (
        <ConfirmModal
          title="Discard your changes?"
          message="The tab has edits that haven't been saved as a new .gp file. They will be lost."
          confirmLabel="Discard changes"
          onConfirm={() => {
            if (confirmDiscard === "close") onClose();
            else leaveEditing();
          }}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}

      {confirmDeleteBar && (
        <ConfirmModal
          title={`Delete bar ${caret.bar + 1}?`}
          message={`Bar ${caret.bar + 1} will be removed from every track. You can undo this until you leave the editor.`}
          confirmLabel={`Delete bar ${caret.bar + 1}`}
          onConfirm={() => {
            setConfirmDeleteBar(false);
            edit(deleteBar);
          }}
          onCancel={() => setConfirmDeleteBar(false)}
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
