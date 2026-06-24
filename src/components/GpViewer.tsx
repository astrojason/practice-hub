import { useCallback, useEffect, useRef, useState } from "react";
import * as alphaTab from "@coderline/alphatab";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { useAudioEngine } from "./player/useAudioEngine";

// alphaTab's default worker factory uses importScripts() inside a blob worker,
// which silently fails under Tauri's tauri:// custom protocol. Re-initialize
// with direct URL workers so the synthesis worker actually starts.
{
  const workerUrl  = new URL('/alphaTab.min.js', location.href).href;
  const workletUrl = new URL('/alphaTab.worklet.min.mjs', location.href).href;
  alphaTab.Environment.initializeMain(
    (_settings: alphaTab.Settings, _name: string) => new Worker(workerUrl),
    (ctx: AudioContext, _settings: alphaTab.Settings) => ctx.audioWorklet.addModule(workletUrl),
  );
}

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
}


const FILE_SERVER = "http://127.0.0.1:17865";

function pitchKey(filePath: string) {
  return `gp-viewer-shifts:${filePath}`;
}

interface ViewState {
  selectedTrack: number;
}

function viewKey(filePath: string) {
  return `gp-viewer-view:${filePath}`;
}

function loadView(filePath: string): ViewState {
  try {
    const raw = localStorage.getItem(viewKey(filePath));
    if (raw) return { selectedTrack: 0, ...(JSON.parse(raw) as Partial<ViewState>) };
  } catch { /* non-critical */ }
  return { selectedTrack: 0 };
}

function saveView(filePath: string, state: ViewState) {
  try {
    localStorage.setItem(viewKey(filePath), JSON.stringify(state));
  } catch { /* non-critical */ }
}

function loadPitch(filePath: string): PitchState {
  try {
    const raw = localStorage.getItem(pitchKey(filePath));
    if (raw) return JSON.parse(raw) as PitchState;
  } catch { /* non-critical */ }
  return { audioSemitones: 0, audioCents: 0, tabSemitones: 0, linked: false, audioFilePath: null };
}

function savePitch(filePath: string, state: PitchState) {
  try {
    localStorage.setItem(pitchKey(filePath), JSON.stringify(state));
  } catch { /* non-critical */ }
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
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const updateTimerRef = useRef<number>(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackNames, setTrackNames] = useState<string[]>([]);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const [artist, setArtist] = useState<string | null>(null);
  const [tempo, setTempo] = useState<number | null>(null);

  const [pitch, setPitch] = useState<PitchState>(() => loadPitch(filePath));
  const [audioState, audioActions] = useAudioEngine();
  const audioActionsRef = useRef(audioActions);
  const audioStateRef = useRef(audioState);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  // alphaTab MIDI player state
  const [atReady, setAtReady] = useState(false);
  const [atPlaying, setAtPlaying] = useState(false);
  const [atCurrentTime, setAtCurrentTime] = useState(0); // ms
  const [atEndTime, setAtEndTime] = useState(0);         // ms

  const addLog = useCallback((level: string, ...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    setDebugLogs((prev) => [...prev.slice(-199), `[${level}] ${msg}`]);
  }, []);

  // Derived from stored path — no separate state needed
  const audioFilename = pitch.audioFilePath ? pitch.audioFilePath.split("/").pop() ?? pitch.audioFilePath : null;

  // Persist pitch state (including audioFilePath) on every change
  useEffect(() => {
    savePitch(filePath, pitch);
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

  // On mount: disable loop, load audio (prefer initialAudioPath from resources over stored), destroy on unmount
  useEffect(() => {
    audioActions.setLoopEnabled(false);
    const stored = loadPitch(filePath);
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
    audioStateRef.current = audioState;
  });

  // Sync atEndTime from audio duration so the progress bar shows correct length before play
  useEffect(() => {
    if (audioState.duration > 0) setAtEndTime(audioState.duration * 1000);
  }, [audioState.duration]);

  // If the audio engine stops externally, clear the position update interval
  useEffect(() => {
    if (!audioState.isPlaying) window.clearInterval(updateTimerRef.current);
  }, [audioState.isPlaying]);

  // Initialize alphaTab once per filePath
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setLoading(true);
    setError(null);
    setTrackNames([]);
    setTitle(null);
    setArtist(null);
    setTempo(null);
    setSelectedTrack(loadView(filePath).selectedTrack);
    setAtReady(false);
    setAtPlaying(false);
    setAtCurrentTime(0);
    setAtEndTime(0);
    window.clearInterval(updateTimerRef.current);

    const settings = new alphaTab.Settings();
    settings.core.useWorkers = false;
    settings.core.fontDirectory = "/font/";
    settings.core.scriptFile = `${window.location.origin}/alphaTab.min.js`;
    // Use our audio engine as the audio source; alphaTab only drives the cursor
    settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
    if (bodyRef.current) settings.player.scrollElement = bodyRef.current;

    const api = new alphaTab.AlphaTabApi(el, settings);
    apiRef.current = api;

    addLog("INFO", `AT init: playerMode=${api.settings.player.playerMode} scriptFile=${api.settings.core.scriptFile}`);

    // Wire audio engine as the external media source
    const output = api.player?.output as alphaTab.synth.IExternalMediaSynthOutput | undefined;
    if (output) {
      output.handler = {
        get backingTrackDuration() {
          return audioStateRef.current.duration * 1000;
        },
        get playbackRate() {
          return audioStateRef.current.speed;
        },
        set playbackRate(v: number) {
          audioActionsRef.current.setSpeed(v);
        },
        get masterVolume() { return 1; },
        set masterVolume(_v: number) {},
        seekTo(ms: number) {
          audioActionsRef.current.seek(ms / 1000);
        },
        play() {
          audioActionsRef.current.play();
          window.clearInterval(updateTimerRef.current);
          updateTimerRef.current = window.setInterval(() => {
            const ms = audioActionsRef.current.getCurrentTime() * 1000;
            output.updatePosition(ms);
          }, 50);
        },
        pause() {
          audioActionsRef.current.pause();
          window.clearInterval(updateTimerRef.current);
        },
      };
      addLog("INFO", "AT external media handler installed");
    } else {
      addLog("WARN", "AT player output not available — external media handler not installed");
    }

    api.scoreLoaded.on((score: alphaTab.model.Score) => {
      addLog("INFO", `scoreLoaded: ${score.title}`);
      setTitle(score.title || null);
      setArtist(score.artist || null);
      setTempo(score.tempo);
      setTrackNames(score.tracks.map((t: alphaTab.model.Track) => t.name));
      const stored = loadPitch(filePath);
      if (stored.tabSemitones !== 0) {
        api.settings.notation.transpositionPitches = Array(score.tracks.length).fill(stored.tabSemitones);
        api.updateSettings();
      }
      setLoading(false);
    });

    api.error.on((err: Error) => {
      addLog("AT_ERR", err.message);
      setError(err.message);
      setLoading(false);
    });

    api.playerReady.on(() => {
      setAtReady(true);
      addLog("INFO", "AT player ready");
    });

    api.midiLoaded.on(() => {
      // midiLoaded fires even in external media mode — alphaTab still generates MIDI for cursor timing
      setAtReady(true);
      addLog("INFO", "AT MIDI loaded");
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).midiLoadFailed?.on?.((err: Error) => {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("ERR", `AT MIDI load failed: ${msg}`);
      setError(`MIDI load failed: ${msg}`);
    });

    api.playerStateChanged.on((args: alphaTab.synth.PlayerStateChangedEventArgs) => {
      setAtPlaying(args.state === alphaTab.synth.PlayerState.Playing);
      if (args.stopped) setAtCurrentTime(0);
      addLog("INFO", `AT state: ${args.state} stopped:${args.stopped}`);
    });

    api.playerPositionChanged.on((args: alphaTab.synth.PositionChangedEventArgs) => {
      setAtCurrentTime(args.currentTime);
      if (args.endTime > 0) setAtEndTime(args.endTime);
    });

    api.playerFinished.on(() => {
      setAtPlaying(false);
      setAtCurrentTime(0);
      window.clearInterval(updateTimerRef.current);
      addLog("INFO", "AT player finished");
    });

    const url = `${FILE_SERVER}/asset?path=${encodeURIComponent(filePath)}`;
    api.load(url);

    return () => {
      window.clearInterval(updateTimerRef.current);
      api.destroy();
      apiRef.current = null;
    };
  }, [filePath, addLog]);

  // Apply tab transposition when tabSemitones changes (after initial load).
  // updateSettings() alone doesn't re-render; render() is required.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || loading || !api.score) return;
    const count = api.score.tracks.length;
    api.settings.notation.transpositionPitches = Array(count).fill(pitch.tabSemitones);
    api.updateSettings();
    api.render();
  }, [pitch.tabSemitones, loading]);

  // Persist selectedTrack changes per file
  useEffect(() => {
    saveView(filePath, { selectedTrack });
  }, [filePath, selectedTrack]);

  // Switch displayed track
  useEffect(() => {
    const api = apiRef.current;
    if (!api || loading || !api.score) return;
    const track = api.score.tracks[selectedTrack];
    if (track) api.renderTracks([track]);
  }, [selectedTrack, loading]);

  // Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

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

  function handleAtProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (atEndTime <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekMs = ratio * atEndTime;
    audioActionsRef.current.seek(seekMs / 1000);
    // Update alphaTab cursor immediately to the new position
    const o = apiRef.current?.player?.output as alphaTab.synth.IExternalMediaSynthOutput | undefined;
    o?.updatePosition(seekMs);
  }

  const filename = filePath.split("/").pop() ?? filePath;
  const audioLoadLabel = audioFilename ?? "Load audio";

  return (
    <div className="gp-viewer" ref={backdropRef} onClick={handleBackdropClick}>
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
                  <span className="gp-viewer-tempo">{Math.round(tempo)} BPM</span>
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
        </div>

        {/* Unified player bar — audio engine drives playback; alphaTab tracks cursor */}
        <div className="gp-at-player">
          <span className="gp-at-label">Play</span>
          {!atReady ? (
            <span className="gp-at-loading">Initializing…</span>
          ) : audioState.status !== "ready" ? (
            <span className="gp-at-loading">Load audio file to enable playback</span>
          ) : (
            <>
              <button
                className="gp-at-play"
                onClick={() => apiRef.current?.playPause()}
                title={atPlaying ? "Pause" : "Play"}
              >
                {atPlaying ? "⏸" : "▶"}
              </button>
              <button
                className="gp-at-stop"
                onClick={() => { apiRef.current?.stop(); audioActions.pause(); audioActionsRef.current.seek(0); }}
                title="Stop"
              >
                ⏹
              </button>
              <div
                className="gp-at-progress"
                onClick={handleAtProgressClick}
                title="Click to seek"
              >
                <div
                  className="gp-at-progress-fill"
                  style={{ width: `${atEndTime > 0 ? (atCurrentTime / atEndTime) * 100 : 0}%` }}
                />
              </div>
              <span className="gp-at-time">
                {fmtTime(atCurrentTime / 1000)} / {fmtTime(atEndTime / 1000)}
              </span>
            </>
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
        </div>

        {/* Body */}
        <div className="gp-viewer-body" ref={bodyRef}>
          {loading && !error && (
            <div className="gp-viewer-spinner">
              <div className="loading-spinner" />
            </div>
          )}
          {!loading && error && (
            <p className="gp-viewer-error">Failed to load: {error}</p>
          )}
          <div ref={containerRef} className="gp-alphatab-container" />
        </div>

        {/* Debug console */}
        <div className="gp-debug-bar">
          <button className="gp-debug-toggle" onClick={() => setShowDebug((v) => !v)}>
            {showDebug ? "▲ Debug" : "▼ Debug"} ({debugLogs.length})
          </button>
          <span className="gp-debug-state">
            audio:{audioState.status} | playing:{audioState.isPlaying ? "✓" : "✗"} | at:{atReady ? (atPlaying ? "▶" : "⏸") : "…"}
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
