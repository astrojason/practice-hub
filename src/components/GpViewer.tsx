import { useEffect, useRef, useState } from "react";
import * as alphaTab from "@coderline/alphatab";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { useAudioEngine } from "./player/useAudioEngine";

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
  const currentTimeRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackNames, setTrackNames] = useState<string[]>([]);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const [artist, setArtist] = useState<string | null>(null);
  const [tempo, setTempo] = useState<number | null>(null);

  const [pitch, setPitch] = useState<PitchState>(() => loadPitch(filePath));
  const [audioState, audioActions] = useAudioEngine();

  // Derived from stored path — no separate state needed
  const audioFilename = pitch.audioFilePath ? pitch.audioFilePath.split("/").pop() ?? pitch.audioFilePath : null;

  // Persist pitch state (including audioFilePath) on every change
  useEffect(() => {
    savePitch(filePath, pitch);
  }, [filePath, pitch]);

  // On mount: disable loop, load audio (prefer initialAudioPath from resources over stored), destroy on unmount
  useEffect(() => {
    audioActions.setLoopEnabled(false);
    const stored = loadPitch(filePath);
    const audioPath = initialAudioPath ?? stored.audioFilePath;
    if (audioPath) {
      if (audioPath !== stored.audioFilePath) {
        setPitch((p) => ({ ...p, audioFilePath: audioPath }));
      }
      audioActions.loadFile(audioPath);
    }
    return () => { audioActions.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync pitch controls → audio engine
  useEffect(() => {
    audioActions.setPitch(pitch.audioSemitones, pitch.audioCents);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch.audioSemitones, pitch.audioCents]);

  // Keep a ref in sync so the rAF loop always reads the latest time without closure capture issues
  useEffect(() => {
    currentTimeRef.current = audioState.currentTime;
  }, [audioState.currentTime]);

  // Drive alphaTab cursor from audio engine position via a dedicated rAF loop
  useEffect(() => {
    if (!audioState.isPlaying) return;
    let rafId: number;
    const tick = () => {
      const api = apiRef.current;
      if (api && api.isReadyForPlayback) {
        api.timePosition = currentTimeRef.current * 1000;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
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
    setSelectedTrack(0);

    const settings = new alphaTab.Settings();
    settings.core.useWorkers = false;
    settings.core.fontDirectory = "/font/";
    settings.player.enablePlayer = true;
    settings.player.enableCursor = true;
    settings.player.soundFont = "/soundfont/sonivox.sf2";
    settings.player.scrollMode = alphaTab.ScrollMode.Continuous;

    const api = new alphaTab.AlphaTabApi(el, settings);
    apiRef.current = api;

    // Mute MIDI audio immediately — cursor/scroll are what we want, not synthesis
    api.masterVolume = 0;
    api.soundFontLoaded.on(() => { api.masterVolume = 0; });

    api.scoreLoaded.on((score: alphaTab.model.Score) => {
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
      setError(err.message);
      setLoading(false);
    });

    const url = `${FILE_SERVER}/asset?path=${encodeURIComponent(filePath)}`;
    api.load(url);

    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, [filePath]);

  // Apply tab transposition when tabSemitones changes (after initial load)
  useEffect(() => {
    const api = apiRef.current;
    if (!api || loading || !api.score) return;
    const count = api.score.tracks.length;
    api.settings.notation.transpositionPitches = Array(count).fill(pitch.tabSemitones);
    api.updateSettings();
  }, [pitch.tabSemitones, loading]);

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
  }

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (audioState.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioActions.seek(ratio * audioState.duration);
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

        {/* Audio player bar */}
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
          {audioState.status === "ready" && (
            <>
              <button
                className="gp-audio-play"
                onClick={audioState.isPlaying ? audioActions.pause : audioActions.play}
                title={audioState.isPlaying ? "Pause" : "Play"}
              >
                {audioState.isPlaying ? "⏸" : "▶"}
              </button>
              <div
                className="gp-audio-progress"
                onClick={handleProgressClick}
                title="Click to seek"
              >
                <div
                  className="gp-audio-progress-fill"
                  style={{
                    width: `${audioState.duration > 0 ? (audioState.currentTime / audioState.duration) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="gp-audio-time">
                {fmtTime(audioState.currentTime)} / {fmtTime(audioState.duration)}
              </span>
            </>
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
          <div ref={containerRef} className="gp-alphatab-container" />
        </div>
      </div>
    </div>
  );
}
