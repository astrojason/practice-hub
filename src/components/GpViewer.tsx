import { useCallback, useEffect, useRef, useState } from "react";
import type * as alphaTab from "@coderline/alphatab";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { useAudioEngine } from "./player/useAudioEngine";
import { ErrorModal } from "./ErrorModal";
import { loadScoreFromFile, buildBeatTiming, type BeatTiming } from "../lib/gpScore";
import { buildTrackLayout, defaultLayoutOptions, type TrackLayout } from "../lib/tabLayout";
import { TabCanvas } from "./tab/TabCanvas";
import { TabCursor } from "./tab/TabCursor";
import { computeStaffMetrics } from "./tab/tabGeometry";

interface Props {
  filePath: string;
  onClose: () => void;
  initialAudioPath?: string;
}

interface PitchState {
  audioSemitones: number;
  audioCents: number;
  tabSemitones: number;
  linked: boolean;
  audioFilePath: string | null;
  audioOffsetMs: number; // manual escape hatch for genuine output-device latency
}


function pitchKey(filePath: string) {
  return `gp-viewer-shifts:${filePath}`;
}

interface ViewState {
  selectedTrack: number;
  targetTempo: number | null;
  loopEnabled: boolean;
  loopStart: number | null;
  loopEnd: number | null;
}

function viewKey(filePath: string) {
  return `gp-viewer-view:${filePath}`;
}

const defaultViewState: ViewState = { selectedTrack: 0, targetTempo: null, loopEnabled: false, loopStart: null, loopEnd: null };
const defaultPitchState: PitchState = { audioSemitones: 0, audioCents: 0, tabSemitones: 0, linked: false, audioFilePath: null, audioOffsetMs: 0 };

function loadView(filePath: string): { value: ViewState; error: string | null } {
  try {
    const raw = localStorage.getItem(viewKey(filePath));
    if (raw) return { value: { ...defaultViewState, ...(JSON.parse(raw) as Partial<ViewState>) }, error: null };
    return { value: defaultViewState, error: null };
  } catch (err) {
    return {
      value: defaultViewState,
      error: `Couldn't load your saved view settings (track/tempo/loop) for this file. (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

function saveView(filePath: string, state: ViewState): void {
  localStorage.setItem(viewKey(filePath), JSON.stringify(state));
}

function loadPitch(filePath: string): { value: PitchState; error: string | null } {
  try {
    const raw = localStorage.getItem(pitchKey(filePath));
    if (raw) return { value: JSON.parse(raw) as PitchState, error: null };
    return { value: defaultPitchState, error: null };
  } catch (err) {
    return {
      value: defaultPitchState,
      error: `Couldn't load your saved pitch/audio-offset settings for this file. (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

function savePitch(filePath: string, state: PitchState): void {
  localStorage.setItem(pitchKey(filePath), JSON.stringify(state));
}

// ─── Pitch control spinner ────────────────────────────────────────────────────

function PitchSpinner({
  value,
  unit,
  label,
  step = 1,
  className,
  onChange,
}: {
  value: number;
  unit: string;
  label: string;
  step?: number;
  className: string;
  onChange: (n: number) => void;
}) {
  const display = value === 0 ? `0 ${unit}` : value > 0 ? `+${value} ${unit}` : `${value} ${unit}`;
  return (
    <div className={`gp-pitch-group ${className}`}>
      <span className="gp-pitch-label">{label}</span>
      <button onClick={() => onChange(value - step)} title={`Decrease ${label}`}>−</button>
      <span className="gp-pitch-value">{display}</span>
      <button onClick={() => onChange(value + step)} title={`Increase ${label}`}>+</button>
    </div>
  );
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ─── Main viewer component ────────────────────────────────────────────────────

export function GpViewer({ filePath, onClose, initialAudioPath }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackNames, setTrackNames] = useState<string[]>([]);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const [artist, setArtist] = useState<string | null>(null);
  const [tempo, setTempo] = useState<number | null>(null);
  const initialViewLoadRef = useRef<ReturnType<typeof loadView> | null>(null);
  if (initialViewLoadRef.current === null) initialViewLoadRef.current = loadView(filePath);
  const initialPitchLoadRef = useRef<ReturnType<typeof loadPitch> | null>(null);
  if (initialPitchLoadRef.current === null) initialPitchLoadRef.current = loadPitch(filePath);

  const [targetTempo, setTargetTempo] = useState<number | null>(initialViewLoadRef.current.value.targetTempo);
  const [loopEnabled, setLoopEnabledLocal] = useState<boolean>(initialViewLoadRef.current.value.loopEnabled ?? false);
  const [loopStart, setLoopStart] = useState<number | null>(initialViewLoadRef.current.value.loopStart ?? null);
  const [loopEnd, setLoopEnd] = useState<number | null>(initialViewLoadRef.current.value.loopEnd ?? null);

  const [pitch, setPitch] = useState<PitchState>(initialPitchLoadRef.current.value);
  const [persistError, setPersistError] = useState<string | null>(
    initialViewLoadRef.current.error ?? initialPitchLoadRef.current.error
  );
  const audioOffsetMsRef = useRef(pitch.audioOffsetMs ?? 0);
  const [audioState, audioActions] = useAudioEngine();
  const audioActionsRef = useRef(audioActions);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const scoreRef = useRef<alphaTab.model.Score | null>(null);
  const beatTimingRef = useRef<Map<number, BeatTiming> | null>(null);
  const [layout, setLayout] = useState<TrackLayout | null>(null);

  const addLog = useCallback((level: string, ...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    setDebugLogs((prev) => [...prev.slice(-199), `[${level}] ${msg}`]);
  }, []);

  // Derived from stored path — no separate state needed
  const audioFilename = pitch.audioFilePath ? pitch.audioFilePath.split("/").pop() ?? pitch.audioFilePath : null;

  // Persist pitch state (including audioFilePath) on every change
  useEffect(() => {
    try {
      savePitch(filePath, pitch);
    } catch (err) {
      setPersistError(`Couldn't save your pitch/audio-offset settings for this file. (${err instanceof Error ? err.message : String(err)})`);
    }
  }, [filePath, pitch]);

  // Intercept console.error/warn and unhandled errors so they appear in the debug panel
  useEffect(() => {
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.error = (...args: unknown[]) => { addLog("ERR", ...args); origError(...args); };
    console.warn = (...args: unknown[]) => { addLog("WARN", ...args); origWarn(...args); };
    const onError = (e: ErrorEvent) => addLog("WINDOW_ERR", e.message, e.filename, e.lineno);
    const onUnhandled = (e: PromiseRejectionEvent) => addLog("UNHANDLED", String(e.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, [addLog]);

  // On mount: load audio (prefer initialAudioPath from resources over stored), destroy on unmount
  useEffect(() => {
    const stored = loadPitch(filePath).value;
    const audioPath = initialAudioPath ?? stored.audioFilePath;
    if (audioPath) {
      if (audioPath !== stored.audioFilePath) {
        setPitch((p) => ({ ...p, audioFilePath: audioPath }));
      }
      audioActions.loadFile(audioPath).then(() => { audioActions.pause(); });
    }
    return () => { audioActions.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync pitch controls → audio engine
  useEffect(() => {
    audioActions.setPitch(pitch.audioSemitones, pitch.audioCents);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch.audioSemitones, pitch.audioCents]);

  // Keep refs in sync so handler callbacks always read fresh values without closure capture
  useEffect(() => {
    audioActionsRef.current = audioActions;
    audioOffsetMsRef.current = pitch.audioOffsetMs ?? 0;
  });

  // Parse the file and build the initial layout. alphaTab is used here only
  // as a standalone GP/MusicXML parser (gpScore.ts) — no renderer, player,
  // or worker involved.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTrackNames([]);
    setTitle(null);
    setArtist(null);
    setTempo(null);
    setLayout(null);
    scoreRef.current = null;
    beatTimingRef.current = null;

    const initialTrack = loadView(filePath).value.selectedTrack;
    const initialTabSemitones = loadPitch(filePath).value.tabSemitones ?? 0;
    setSelectedTrack(initialTrack);

    loadScoreFromFile(filePath)
      .then((score) => {
        if (cancelled) return;
        scoreRef.current = score;
        beatTimingRef.current = buildBeatTiming(score);
        setTitle(score.title || null);
        setArtist(score.artist || null);
        const roundedTempo = Math.round(score.tempo);
        setTempo(roundedTempo);
        setTargetTempo((prev) => prev ?? roundedTempo);
        setTrackNames(score.tracks.map((t) => t.name));
        addLog("INFO", `scoreLoaded: ${score.title}`);

        const trackIndex = Math.min(initialTrack, score.tracks.length - 1);
        setLayout(buildTrackLayout(score, trackIndex, beatTimingRef.current, {
          ...defaultLayoutOptions,
          notationTranspositionSemitones: initialTabSemitones,
        }));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        addLog("ERR", msg);
        setError(msg);
        setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, addLog]);

  // Re-run the layout when track selection or tab transposition changes.
  useEffect(() => {
    if (!scoreRef.current || !beatTimingRef.current) return;
    if (selectedTrack >= scoreRef.current.tracks.length) return;
    setLayout(buildTrackLayout(
      scoreRef.current,
      selectedTrack,
      beatTimingRef.current,
      { ...defaultLayoutOptions, notationTranspositionSemitones: pitch.tabSemitones },
    ));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrack, pitch.tabSemitones]);

  // Persist view state (track, tempo, loop) per file
  useEffect(() => {
    try {
      saveView(filePath, { selectedTrack, targetTempo, loopEnabled, loopStart, loopEnd });
    } catch (err) {
      setPersistError(`Couldn't save your view settings (track/tempo/loop) for this file. (${err instanceof Error ? err.message : String(err)})`);
    }
  }, [filePath, selectedTrack, targetTempo, loopEnabled, loopStart, loopEnd]);

  // Sync loop state → audio engine
  useEffect(() => {
    audioActions.setLoopEnabled(loopEnabled);
    audioActions.setLoopStart(loopStart);
    audioActions.setLoopEnd(loopEnd);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopEnabled, loopStart, loopEnd]);

  // Sync tempo changes to audio engine speed
  useEffect(() => {
    if (targetTempo === null || tempo === null || tempo <= 0) return;
    audioActions.setSpeed(targetTempo / tempo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTempo, tempo]);

  // Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  // Read directly from the audio engine's clock every frame — no relay
  // through an intermediary event/cursor system. audioOffsetMs is kept as a
  // manual escape hatch (e.g. genuine output-device latency) but should need
  // little/no adjustment now that layout position and cursor position come
  // from the same timeToX mapping.
  const getCurrentTimeMs = useCallback(() => {
    return audioActionsRef.current.getCurrentTime() * 1000 + audioOffsetMsRef.current;
  }, []);

  function setAudioSemitones(n: number) {
    setPitch((p) => ({ ...p, audioSemitones: n, ...(p.linked ? { tabSemitones: n } : {}) }));
  }

  function setTabSemitones(n: number) {
    setPitch((p) => ({ ...p, tabSemitones: n, ...(p.linked ? { audioSemitones: n } : {}) }));
  }

  async function handleLoadAudio() {
    let selected: string | string[] | null;
    try {
      selected = await openFilePicker({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "ogg", "aac"] }],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!selected) return;
    const path = typeof selected === "string" ? selected : selected[0];
    setPitch((p) => ({ ...p, audioFilePath: path }));
    await audioActions.loadFile(path);
    audioActions.pause();
  }

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const endMs = audioState.duration * 1000;
    if (endMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioActionsRef.current.seek((ratio * endMs) / 1000);
  }

  const filename = filePath.split("/").pop() ?? filePath;
  const audioLoadLabel = audioFilename ?? "Load audio";
  const atCurrentTime = audioState.currentTime * 1000;
  const atEndTime = audioState.duration * 1000;

  return (
    <div className="gp-viewer" ref={backdropRef} onClick={handleBackdropClick}>
      {persistError && <ErrorModal error={persistError} onDismiss={() => setPersistError(null)} />}
      <div className="gp-viewer-card">
        {/* Header */}
        <div className="gp-viewer-header">
          <div className="gp-viewer-meta">
            {loading && !error ? (
              <span className="gp-viewer-loading">Loading…</span>
            ) : (
              <>
                <span className="gp-viewer-title">{title ?? filename}</span>
                {artist && <span className="gp-viewer-artist">{artist}</span>}
                {tempo !== null && (
                  <span className="gp-viewer-tempo">{tempo} BPM</span>
                )}
              </>
            )}
          </div>
          <div className="gp-viewer-controls">
            {trackNames.length > 1 && (
              <select
                className="gp-viewer-track-select"
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(Number(e.target.value))}
              >
                {trackNames.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
            )}
            <button className="gp-viewer-close" onClick={onClose} title="Close viewer">
              ✕
            </button>
          </div>
        </div>

        {/* Pitch controls — always visible */}
        <div className="gp-pitch-controls">
          <div className="gp-pitch-section">
            <span className="gp-pitch-section-label">Audio</span>
            <PitchSpinner
              value={pitch.audioSemitones}
              unit="st"
              label="Semitones"
              className="gp-pitch-audio-semitones"
              onChange={setAudioSemitones}
            />
            <div className="gp-pitch-group gp-pitch-cents">
              <span className="gp-pitch-label">Fine</span>
              <button onClick={() => setPitch((p) => ({ ...p, audioCents: p.audioCents - 10 }))} title="Decrease fine tune">−</button>
              <span className="gp-pitch-value">
                {pitch.audioCents === 0 ? "0 ¢" : pitch.audioCents > 0 ? `+${pitch.audioCents} ¢` : `${pitch.audioCents} ¢`}
              </span>
              <button onClick={() => setPitch((p) => ({ ...p, audioCents: p.audioCents + 10 }))} title="Increase fine tune">+</button>
            </div>
          </div>

          <div className="gp-pitch-divider" />

          <label className="gp-pitch-link-label">
            <input
              type="checkbox"
              className="gp-pitch-link-check"
              checked={pitch.linked}
              onChange={(e) => setPitch((p) => ({ ...p, linked: e.target.checked }))}
            />
            Link
          </label>

          <div className="gp-pitch-divider" />

          <div className="gp-pitch-section">
            <span className="gp-pitch-section-label">Tab</span>
            <PitchSpinner
              value={pitch.tabSemitones}
              unit="st"
              label="Semitones"
              className="gp-pitch-tab-semitones"
              onChange={setTabSemitones}
            />
          </div>

          {(pitch.audioSemitones !== 0 || pitch.audioCents !== 0 || pitch.tabSemitones !== 0) && (
            <button
              className="gp-pitch-reset"
              onClick={() => setPitch((p) => ({ ...p, audioSemitones: 0, audioCents: 0, tabSemitones: 0 }))}
              title="Reset all pitch shifts to zero"
            >
              Reset
            </button>
          )}

          <div className="gp-pitch-divider" />

          <div className="gp-pitch-section">
            <span className="gp-pitch-section-label">Tempo</span>
            {targetTempo !== null ? (
              <div className="gp-pitch-group gp-tempo-controls">
                <button
                  onClick={() => setTargetTempo((t) => t !== null ? Math.max(1, t - 1) : null)}
                  title="Decrease tempo"
                >
                  −
                </button>
                <span className="gp-pitch-value gp-tempo-value">{targetTempo} BPM</span>
                <button
                  onClick={() => setTargetTempo((t) => t !== null ? t + 1 : null)}
                  title="Increase tempo"
                >
                  +
                </button>
              </div>
            ) : (
              <span className="gp-pitch-value">— BPM</span>
            )}
            {tempo !== null && targetTempo !== null && targetTempo !== tempo && (
              <button
                className="gp-pitch-reset gp-tempo-reset"
                onClick={() => setTargetTempo(tempo)}
                title={`Reset to score tempo (${tempo} BPM)`}
              >
                ↩ {tempo}
              </button>
            )}
          </div>
        </div>

        {/* Unified player bar */}
        <div className="gp-at-player">
          <span className="gp-at-label">Play</span>
          {!layout ? (
            <span className="gp-at-loading">Loading tab…</span>
          ) : audioState.status !== "ready" ? (
            <span className="gp-at-loading">Load audio file to enable playback</span>
          ) : (
            <>
              <button
                className="gp-at-play"
                onClick={() => (audioState.isPlaying ? audioActions.pause() : audioActions.play())}
                title={audioState.isPlaying ? "Pause" : "Play"}
              >
                {audioState.isPlaying ? "⏸" : "▶"}
              </button>
              <button
                className="gp-at-stop"
                onClick={() => { audioActions.pause(); audioActionsRef.current.seek(0); }}
                title="Stop"
              >
                ⏹
              </button>
              <div
                className="gp-at-progress"
                onClick={handleProgressClick}
                title="Click to seek"
              >
                <div
                  className="gp-at-progress-fill"
                  style={{ width: `${atEndTime > 0 ? (atCurrentTime / atEndTime) * 100 : 0}%` }}
                />
                {loopStart !== null && loopEnd !== null && atEndTime > 0 && (
                  <div
                    className="gp-at-loop-region"
                    style={{
                      left: `${Math.min(100, (loopStart * 1000 / atEndTime) * 100)}%`,
                      width: `${Math.min(100, ((loopEnd - loopStart) * 1000 / atEndTime) * 100)}%`,
                    }}
                  />
                )}
                {loopStart !== null && atEndTime > 0 && (
                  <div
                    className="gp-at-loop-marker gp-at-loop-marker--in"
                    style={{ left: `${Math.min(100, (loopStart * 1000 / atEndTime) * 100)}%` }}
                  />
                )}
                {loopEnd !== null && atEndTime > 0 && (
                  <div
                    className="gp-at-loop-marker gp-at-loop-marker--out"
                    style={{ left: `${Math.min(100, (loopEnd * 1000 / atEndTime) * 100)}%` }}
                  />
                )}
              </div>
              <span className="gp-at-time">
                {fmtTime(atCurrentTime / 1000)} / {fmtTime(atEndTime / 1000)}
              </span>
            </>
          )}
        </div>

        {/* Loop controls bar */}
        <div className="gp-loop-bar">
          <span className="gp-at-label">Loop</span>
          <label className="gp-loop-toggle-label">
            <input
              type="checkbox"
              className="gp-loop-toggle"
              checked={loopEnabled}
              onChange={(e) => {
                setLoopEnabledLocal(e.target.checked);
                audioActions.setLoopEnabled(e.target.checked);
              }}
            />
            {loopEnabled ? "On" : "Off"}
          </label>
          <span className="gp-loop-bound-label">In</span>
          <span className="gp-loop-in-time gp-loop-time">
            {loopStart !== null ? fmtTime(loopStart) : "—"}
          </span>
          <button
            className="gp-loop-set-btn"
            onClick={() => {
              const t = audioState.currentTime;
              setLoopStart(t);
              audioActions.setLoopStart(t);
            }}
            disabled={audioState.status !== "ready"}
            title="Set loop in from playhead"
          >
            Set
          </button>
          <span className="gp-loop-bound-label">Out</span>
          <span className="gp-loop-out-time gp-loop-time">
            {loopEnd !== null ? fmtTime(loopEnd) : "—"}
          </span>
          <button
            className="gp-loop-set-btn"
            onClick={() => {
              const t = audioState.currentTime;
              setLoopEnd(t);
              audioActions.setLoopEnd(t);
            }}
            disabled={audioState.status !== "ready"}
            title="Set loop out from playhead"
          >
            Set
          </button>
          {(loopStart !== null || loopEnd !== null) && (
            <button
              className="gp-loop-clear-btn"
              onClick={() => {
                setLoopStart(null);
                setLoopEnd(null);
                audioActions.setLoopStart(null);
                audioActions.setLoopEnd(null);
              }}
              title="Clear loop points"
            >
              Clear
            </button>
          )}
        </div>

        {/* Audio file loader bar */}
        <div className="gp-audio-player">
          <button
            className="gp-audio-load"
            onClick={handleLoadAudio}
            title={audioFilename ? `${audioFilename} — click to load different file` : "Load audio file"}
          >
            ♪ {audioLoadLabel}
          </button>
          {audioState.status === "loading" && (
            <span className="gp-audio-status">Loading…</span>
          )}
          {audioState.status === "error" && (
            <span className="gp-audio-error">{audioState.errorMessage}</span>
          )}
          {pitch.audioFilePath && (
            <PitchSpinner
              value={pitch.audioOffsetMs ?? 0}
              unit="ms"
              label="Offset"
              step={50}
              className="gp-audio-offset"
              onChange={(n) => setPitch((p) => ({ ...p, audioOffsetMs: n }))}
            />
          )}
        </div>

        {/* Body */}
        <div className="gp-viewer-body">
          {loading && !error && (
            <div className="gp-viewer-spinner">
              <div className="loading-spinner" />
            </div>
          )}
          {!loading && error && (
            <p className="gp-viewer-error">Failed to load: {error}</p>
          )}
          {!loading && !error && layout && (
            <div ref={scrollContainerRef} className="gp-tab-canvas-scroll">
              <div className="gp-tab-canvas-inner">
                <TabCanvas layout={layout} className="gp-tab-canvas" />
                <TabCursor
                  layout={layout}
                  getCurrentTimeMs={getCurrentTimeMs}
                  scrollContainerRef={scrollContainerRef}
                  height={computeStaffMetrics(layout.stringCount).canvasHeight}
                />
              </div>
            </div>
          )}
        </div>

        {/* Debug console */}
        <div className="gp-debug-bar">
          <button className="gp-debug-toggle" onClick={() => setShowDebug((v) => !v)}>
            {showDebug ? "▲ Debug" : "▼ Debug"} ({debugLogs.length})
          </button>
          <span className="gp-debug-state">
            audio:{audioState.status} | playing:{audioState.isPlaying ? "✓" : "✗"} | tab:{layout ? "✓" : "…"}
          </span>
          {showDebug && (
            <button className="gp-debug-clear" onClick={() => setDebugLogs([])}>Clear</button>
          )}
        </div>
        {showDebug && (
          <div className="gp-debug-console">
            {debugLogs.length === 0 && <span className="gp-debug-empty">No logs yet</span>}
            {[...debugLogs].reverse().map((line, i) => (
              <div key={i} className="gp-debug-line">{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
