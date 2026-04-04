import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import { XMarkIcon, BackwardIcon, ForwardIcon } from "@heroicons/react/16/solid";
import { useAudioEngine, assetUrl } from "./useAudioEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlayerMediaType = "audio" | "video";

interface Props {
  filePath: string;
  mediaType: PlayerMediaType;
  itemName: string;
  onClose: () => void;
  /** Session practice timer for the item associated with this file */
  timerElapsed?: number;
  isTimerActive?: boolean;
}

interface WaveMarker {
  time: number;
  name: string;
}

interface Region {
  id: string;
  name: string;
  start: number;
  end: number;
  playbackSpeed: number;
  speedIncreasePercent: number;
  speedIncreaseInterval: number;
  increaseEnabled: boolean;
  createdAt: number;
}

interface Preset {
  filePath: string;
  mediaType: string;
  playbackSpeed: number;
  loopStart: string;
  loopEnd: string;
  loopIncreaseBy: string;
  loopIncreaseAt: string;
  loopIncreaseEnabled: boolean;
  loopPlaybackEnabled: boolean;
  metronomeBpm: number;
  pitchSemitones: number;
  pitchCents: number;
  regions: Region[];
  markers: WaveMarker[];
  updatedAt: number;
}

interface Toast {
  id: number;
  message: string;
  icon: string;
  tone: "success" | "warning" | "info";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_KEY = "practicePlayerPresets";
const SHORTCUT_KEY = "practicePlayerShortcuts";
const LOOP_NUDGE = 0.5;
const MARKER_NUDGE = 0.5;

const defaultShortcuts: Record<string, string> = {
  increaseSpeed: "=",
  decreaseSpeed: "-",
  togglePlayPause: "Space",
  jumpForward: ".",
  jumpBackward: ",",
  setLoopStart: "a",
  setLoopEnd: "b",
  toggleLoop: "l",
  nudgeLoopStartBack: "[",
  nudgeLoopStartForward: "]",
  nudgeLoopEndBack: ";",
  nudgeLoopEndForward: "'",
  nudgeMarkerBack: "Shift+ArrowLeft",
  nudgeMarkerForward: "Shift+ArrowRight",
  nudgeLoopStartBackSmall: "ArrowLeft",
  nudgeLoopStartForwardSmall: "ArrowRight",
  nudgeLoopEndBackSmall: "ArrowUp",
  nudgeLoopEndForwardSmall: "ArrowDown",
  addMarker: "m",
};

const shortcutMeta: Record<string, { label: string; description: string }> = {
  increaseSpeed: { label: "Increase speed", description: "Raise playback speed by one step" },
  decreaseSpeed: { label: "Decrease speed", description: "Lower playback speed by one step" },
  togglePlayPause: { label: "Play / pause", description: "Toggle playback" },
  jumpForward: { label: "Skip forward", description: "Jump ahead by 5%" },
  jumpBackward: { label: "Skip backward", description: "Jump back by 5%" },
  setLoopStart: { label: "Set loop start", description: "Drop loop start at playhead" },
  setLoopEnd: { label: "Set loop end", description: "Drop loop end at playhead" },
  toggleLoop: { label: "Toggle loop", description: "Enable or disable loop playback" },
  nudgeLoopStartBack: { label: "Loop start −5%", description: "Move loop start backward by 5%" },
  nudgeLoopStartForward: { label: "Loop start +5%", description: "Move loop start forward by 5%" },
  nudgeLoopEndBack: { label: "Loop end −5%", description: "Move loop end backward by 5%" },
  nudgeLoopEndForward: { label: "Loop end +5%", description: "Move loop end forward by 5%" },
  nudgeMarkerBack: { label: "Marker −0.5s", description: "Nudge selected marker back 0.5s" },
  nudgeMarkerForward: { label: "Marker +0.5s", description: "Nudge selected marker forward 0.5s" },
  nudgeLoopStartBackSmall: { label: "Loop start −0.5s", description: "Nudge loop start back 0.5s" },
  nudgeLoopStartForwardSmall: { label: "Loop start +0.5s", description: "Nudge loop start forward 0.5s" },
  nudgeLoopEndBackSmall: { label: "Loop end −0.5s", description: "Nudge loop end back 0.5s" },
  nudgeLoopEndForwardSmall: { label: "Loop end +0.5s", description: "Nudge loop end forward 0.5s" },
  addMarker: { label: "Add marker", description: "Drop a marker at current playhead" },
};

const shortcutOrder = Object.keys(defaultShortcuts);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const frac = Math.round((s % 1) * 100);
  const base = `${m}:${String(sec).padStart(2, "0")}`;
  return frac > 0 ? `${base}.${String(frac).padStart(2, "0")}` : base;
}

function parseTimeInput(value: string, duration: number): number | null {
  const text = value.trim();
  if (!text) return null;
  const clock = text.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  const plain = text.match(/^\d+(\.\d+)?$/);
  let seconds: number | null = null;
  if (clock) seconds = Number(clock[1]) * 60 + Number(clock[2]);
  else if (plain) seconds = Number(text);
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, duration);
}

function getMediaTypeFromPath(path: string): PlayerMediaType {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["mp4", "mov", "webm", "m4v", "ogv"].includes(ext) ? "video" : "audio";
}

function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  return key.length === 1 ? key.toLowerCase() : key;
}

function formatShortcutKey(key: string): string {
  if (!key) return "Unassigned";
  return key.split("+").map(p => p.length === 1 ? p.toUpperCase() : p).join("+");
}

function loadPresets(): Record<string, Preset> {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

function savePresets(p: Record<string, Preset>): void {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch {}
}

function loadShortcuts(): Record<string, string> {
  try {
    return { ...defaultShortcuts, ...(JSON.parse(localStorage.getItem(SHORTCUT_KEY) ?? "{}") ?? {}) };
  } catch { return { ...defaultShortcuts }; }
}

function createRegionId(): string {
  return `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let toastCounter = 0;

// ─── Metronome click helper ───────────────────────────────────────────────────

function scheduleClick(ctx: AudioContext, time: number, accent: boolean) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = accent ? 1400 : 900;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.4 : 0.25, time + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.1);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MediaPlayer({ filePath, itemName, onClose, timerElapsed, isTimerActive }: Props) {
  const detectedType = getMediaTypeFromPath(filePath);
  const isVideo = detectedType === "video";

  const [audioState, audioActions] = useAudioEngine();

  // ── Video state ─────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);

  // Derived
  const dur = isVideo ? videoDuration : audioState.duration;
  const currentTime = isVideo ? videoCurrentTime : audioState.currentTime;
  const playing = isVideo ? videoPlaying : audioState.isPlaying;

  // ── Canvas ──────────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopHandleContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingCanvasRef = useRef(false);
  const loopDragRef = useRef<"start" | "end" | null>(null);

  // ── Loop controls ────────────────────────────────────────────────────────────
  const [loopStartInput, setLoopStartInput] = useState("");
  const [loopEndInput, setLoopEndInput] = useState("");
  const [loopEnabled, setLoopEnabledLocal] = useState(true);
  const [loopIncreaseEnabled, setLoopIncreaseEnabledLocal] = useState(false);
  const [loopIncreaseBy, setLoopIncreaseByLocal] = useState(5);
  const [loopIncreaseAt, setLoopIncreaseAtLocal] = useState(3);

  // ── Speed ───────────────────────────────────────────────────────────────────
  const [speedInput, setSpeedInput] = useState("1.00");
  const speedRef = useRef(1.0);

  // ── Pitch ───────────────────────────────────────────────────────────────────
  const [pitchSemitones, setPitchSemitonesLocal] = useState(0);
  const [pitchCents, setPitchCentsLocal] = useState(0);

  // ── Markers ─────────────────────────────────────────────────────────────────
  const [waveMarkers, setWaveMarkers] = useState<WaveMarker[]>([]);
  const [selectedMarkerIdx, setSelectedMarkerIdx] = useState(-1);
  const [markerNameInput, setMarkerNameInput] = useState("");
  const waveMarkersRef = useRef<WaveMarker[]>([]);
  const selectedMarkerIdxRef = useRef(-1);

  // ── Regions ──────────────────────────────────────────────────────────────────
  const [regions, setRegions] = useState<Region[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [regionNameInput, setRegionNameInput] = useState("");
  const regionsRef = useRef<Region[]>([]);
  const activeRegionIdRef = useRef<string | null>(null);

  // ── Toasts ──────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);

  // ── Preset ──────────────────────────────────────────────────────────────────
  const [presetStatus, setPresetStatusText] = useState("Not saved");
  const presetSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presetStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presetsRef = useRef<Record<string, Preset>>(loadPresets());

  // ── Shortcuts ────────────────────────────────────────────────────────────────
  const [shortcutBindings, setShortcutBindings] = useState<Record<string, string>>(loadShortcuts);
  const shortcutBindingsRef = useRef(shortcutBindings);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingRebind, setPendingRebind] = useState<string | null>(null);

  // ── Metronome ────────────────────────────────────────────────────────────────
  const [metronomeBpm, setMetronomeBpm] = useState(120);
  const [metronomeBeats, setMetronomeBeats] = useState(4);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [metronomeFollowSpeed, setMetronomeFollowSpeed] = useState(true);
  const [metronomeCountIn, setMetronomeCountIn] = useState(true);
  const [metronomeBeatFlash, setMetronomeBeatFlash] = useState(false);
  const metronomeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metronomeNextTimeRef = useRef(0);
  const metronomeBeatIndexRef = useRef(0);
  const metronomeBpmRef = useRef(120);
  const metronomeBeatsRef = useRef(4);
  const metronomeFollowSpeedRef = useRef(true);
  const metronomeCountInRef = useRef(true);
  const metronomeEnabledRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Ref sync ────────────────────────────────────────────────────────────────
  useEffect(() => { metronomeBpmRef.current = metronomeBpm; }, [metronomeBpm]);
  useEffect(() => { metronomeBeatsRef.current = metronomeBeats; }, [metronomeBeats]);
  useEffect(() => { metronomeFollowSpeedRef.current = metronomeFollowSpeed; }, [metronomeFollowSpeed]);
  useEffect(() => { metronomeCountInRef.current = metronomeCountIn; }, [metronomeCountIn]);
  useEffect(() => { speedRef.current = parseFloat(speedInput) || 1.0; }, [speedInput]);
  useEffect(() => { shortcutBindingsRef.current = shortcutBindings; }, [shortcutBindings]);
  useEffect(() => { waveMarkersRef.current = waveMarkers; }, [waveMarkers]);
  useEffect(() => { selectedMarkerIdxRef.current = selectedMarkerIdx; }, [selectedMarkerIdx]);
  useEffect(() => { regionsRef.current = regions; }, [regions]);
  useEffect(() => { activeRegionIdRef.current = activeRegionId; }, [activeRegionId]);

  // ── Toast ────────────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, { icon = "⚡", tone = "success" as Toast["tone"] } = {}) => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, icon, tone }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }, []);

  // ── Preset helpers ───────────────────────────────────────────────────────────

  const setPresetStatus = useCallback((text: string) => {
    setPresetStatusText(text);
    if (presetStatusTimerRef.current) clearTimeout(presetStatusTimerRef.current);
    presetStatusTimerRef.current = setTimeout(() => {
      setPresetStatusText("All changes saved");
    }, 2000);
  }, []);

  const savePreset = useCallback((opts: { silent?: boolean } = {}) => {
    const presets = presetsRef.current;
    presets[filePath] = {
      filePath,
      mediaType: isVideo ? "video" : "audio",
      playbackSpeed: speedRef.current,
      loopStart: loopStartInput,
      loopEnd: loopEndInput,
      loopIncreaseBy: String(loopIncreaseBy),
      loopIncreaseAt: String(loopIncreaseAt),
      loopIncreaseEnabled,
      loopPlaybackEnabled: loopEnabled,
      metronomeBpm: metronomeBpmRef.current,
      pitchSemitones,
      pitchCents,
      regions: regionsRef.current,
      markers: waveMarkersRef.current,
      updatedAt: Date.now(),
    };
    savePresets(presets);
    if (!opts.silent) setPresetStatus("Preset saved");
    else setPresetStatusText("All changes saved");
  }, [filePath, isVideo, loopStartInput, loopEndInput, loopIncreaseBy, loopIncreaseAt,
      loopIncreaseEnabled, loopEnabled, pitchSemitones, pitchCents, setPresetStatus]);

  const schedulePresetSave = useCallback(() => {
    if (presetSaveTimerRef.current) clearTimeout(presetSaveTimerRef.current);
    presetSaveTimerRef.current = setTimeout(savePreset, 400);
  }, [savePreset]);

  // ── Apply preset on load ──────────────────────────────────────────────────

  const applyPreset = useCallback((preset: Preset | undefined) => {
    if (!preset) {
      setLoopStartInput("");
      setLoopEndInput("");
      audioActions.setLoopStart(null);
      audioActions.setLoopEnd(null);
      audioActions.setLoopEnabled(true);
      setLoopEnabledLocal(true);
      setLoopIncreaseEnabledLocal(false);
      audioActions.setLoopIncreaseEnabled(false);
      setLoopIncreaseByLocal(5);
      setLoopIncreaseAtLocal(3);
      const spd = "1.00";
      setSpeedInput(spd);
      speedRef.current = 1.0;
      if (!isVideo) audioActions.setSpeed(1.0);
      setPitchSemitonesLocal(0);
      setPitchCentsLocal(0);
      audioActions.setPitch(0, 0);
      setWaveMarkers([]);
      setSelectedMarkerIdx(-1);
      setMarkerNameInput("");
      setRegions([]);
      setActiveRegionId(null);
      setRegionNameInput("");
      setPresetStatusText("Not saved");
      return;
    }
    const loopSt = preset.loopStart ?? "";
    const loopEn = preset.loopEnd ?? "";
    setLoopStartInput(loopSt);
    setLoopEndInput(loopEn);
    const ls = parseTimeInput(loopSt, preset.playbackSpeed > 0 ? 9999 : 0);
    const le = parseTimeInput(loopEn, 9999);
    audioActions.setLoopStart(ls);
    audioActions.setLoopEnd(le);
    const loopOn = typeof preset.loopPlaybackEnabled === "boolean" ? preset.loopPlaybackEnabled : true;
    setLoopEnabledLocal(loopOn);
    audioActions.setLoopEnabled(loopOn);
    const incEn = typeof preset.loopIncreaseEnabled === "boolean" ? preset.loopIncreaseEnabled : false;
    setLoopIncreaseEnabledLocal(incEn);
    audioActions.setLoopIncreaseEnabled(incEn);
    const incBy = parseFloat(preset.loopIncreaseBy) || 5;
    setLoopIncreaseByLocal(incBy);
    audioActions.setLoopIncreaseBy(incBy);
    const incAt = parseFloat(preset.loopIncreaseAt) || 3;
    setLoopIncreaseAtLocal(incAt);
    audioActions.setLoopIncreaseAt(incAt);
    const spd = (preset.playbackSpeed ?? 1).toFixed(2);
    setSpeedInput(spd);
    speedRef.current = preset.playbackSpeed ?? 1;
    if (!isVideo) audioActions.setSpeed(preset.playbackSpeed ?? 1);
    const sem = Number(preset.pitchSemitones ?? 0);
    const ct = Number(preset.pitchCents ?? 0);
    setPitchSemitonesLocal(sem);
    setPitchCentsLocal(ct);
    audioActions.setPitch(sem, ct);
    if (preset.metronomeBpm) {
      setMetronomeBpm(preset.metronomeBpm);
      metronomeBpmRef.current = preset.metronomeBpm;
    }
    const markers = Array.isArray(preset.markers) ? [...preset.markers] : [];
    setWaveMarkers(markers);
    waveMarkersRef.current = markers;
    setSelectedMarkerIdx(markers.length ? 0 : -1);
    setMarkerNameInput(markers.length ? (markers[0].name ?? "") : "");
    const regs = Array.isArray(preset.regions) ? [...preset.regions] : [];
    setRegions(regs);
    regionsRef.current = regs;
    setActiveRegionId(null);
    setRegionNameInput("");
    setPresetStatusText("All changes saved");
  }, [audioActions, isVideo]);

  // ── Metronome ────────────────────────────────────────────────────────────────

  const stopMetronome = useCallback(() => {
    if (metronomeTimerRef.current !== null) {
      clearInterval(metronomeTimerRef.current);
      metronomeTimerRef.current = null;
    }
    metronomeEnabledRef.current = false;
    setMetronomeEnabled(false);
  }, []);

  const performCountIn = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      let ctx = audioActions.getContext();
      if (!ctx || ctx.state === "closed") {
        ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const audioCtx = ctx;
      audioCtx.resume();
      const beats = metronomeBeatsRef.current || 4;
      const speed = metronomeFollowSpeedRef.current ? speedRef.current : 1.0;
      const effectiveBpm = metronomeBpmRef.current * speed;
      const interval = 60 / effectiveBpm;
      const startTime = audioCtx.currentTime + 0.05;
      for (let i = 0; i < beats; i++) {
        scheduleClick(audioCtx, startTime + i * interval, i === 0);
      }
      const waitMs = (beats * interval * 1000) | 0;
      setTimeout(resolve, waitMs);
    });
  }, [audioActions]);

  const startMetronome = useCallback(() => {
    let ctx = audioActions.getContext();
    if (!ctx || ctx.state === "closed") {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    const audioCtx = ctx;
    audioCtx.resume();
    if (metronomeTimerRef.current !== null) clearInterval(metronomeTimerRef.current);
    metronomeNextTimeRef.current = audioCtx.currentTime + 0.05;
    metronomeBeatIndexRef.current = 0;
    metronomeEnabledRef.current = true;
    setMetronomeEnabled(true);
    metronomeTimerRef.current = setInterval(() => {
      if (!metronomeEnabledRef.current) return;
      const speed = metronomeFollowSpeedRef.current ? speedRef.current : 1.0;
      const effectiveBpm = metronomeBpmRef.current * speed;
      const interval = 60 / effectiveBpm;
      const ahead = audioCtx.currentTime + 0.5;
      while (metronomeNextTimeRef.current < ahead) {
        const beats = metronomeBeatsRef.current;
        const accent = beats > 0 ? metronomeBeatIndexRef.current % beats === 0 : false;
        scheduleClick(audioCtx, metronomeNextTimeRef.current, accent);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        const delay = Math.max(0, (metronomeNextTimeRef.current - audioCtx.currentTime) * 1000);
        flashTimerRef.current = setTimeout(() => {
          setMetronomeBeatFlash(true);
          setTimeout(() => setMetronomeBeatFlash(false), 80);
        }, delay);
        metronomeNextTimeRef.current += interval;
        metronomeBeatIndexRef.current++;
      }
    }, 100);
  }, [audioActions]);

  const toggleMetronome = () => {
    if (metronomeEnabled) stopMetronome();
    else startMetronome();
  };

  // Keep count-in callback in engine
  useEffect(() => {
    if (!isVideo && metronomeEnabled && metronomeCountIn) {
      audioActions.setCountIn(performCountIn);
    } else {
      audioActions.setCountIn(null);
    }
  }, [isVideo, metronomeEnabled, metronomeCountIn, performCountIn, audioActions]);

  // Tap tempo
  const tapTimestampsRef = useRef<number[]>([]);
  const handleTapTempo = () => {
    const now = Date.now();
    const taps = tapTimestampsRef.current;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avg);
      setMetronomeBpm(Math.max(40, Math.min(260, bpm)));
    }
  };

  // Auto-set BPM from detected value
  useEffect(() => {
    if (audioState.detectedBpm) {
      setMetronomeBpm(audioState.detectedBpm);
      metronomeBpmRef.current = audioState.detectedBpm;
    }
  }, [audioState.detectedBpm]);

  // ── Load file ────────────────────────────────────────────────────────────────

  useEffect(() => {
    stopMetronome();
    const preset = presetsRef.current[filePath];
    applyPreset(preset);

    if (isVideo) {
      const vid = videoRef.current;
      if (!vid) return;
      vid.src = assetUrl(filePath);
      vid.load();
      if (preset?.loopStart) {
        const ls = parseTimeInput(preset.loopStart, 9999);
        if (ls !== null) vid.currentTime = ls;
      }
      vid.play().catch(() => {});
      setVideoCurrentTime(0);
      setVideoDuration(0);
      setVideoPlaying(false);
    } else {
      audioActions.loadFile(filePath);
    }

    return () => {
      if (!isVideo) audioActions.destroy();
      stopMetronome();
      if (presetSaveTimerRef.current) clearTimeout(presetSaveTimerRef.current);
      if (presetStatusTimerRef.current) clearTimeout(presetStatusTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // ── Video event handlers ─────────────────────────────────────────────────────

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !isVideo) return;
    const onTime = () => {
      setVideoCurrentTime(vid.currentTime);
      const le = parseTimeInput(loopEndInput, vid.duration);
      const ls = parseTimeInput(loopStartInput, vid.duration) ?? 0;
      if (loopEnabled && le !== null && vid.currentTime >= le) {
        vid.currentTime = ls;
        if (vid.paused) vid.play().catch(() => {});
      }
    };
    const onMeta = () => setVideoDuration(vid.duration);
    const onPlay = () => setVideoPlaying(true);
    const onPause = () => setVideoPlaying(false);
    const onEnded = () => {
      if (loopEnabled) {
        const ls = parseTimeInput(loopStartInput, vid.duration) ?? 0;
        vid.currentTime = ls;
        vid.play().catch(() => {});
      }
    };
    vid.addEventListener("timeupdate", onTime);
    vid.addEventListener("loadedmetadata", onMeta);
    vid.addEventListener("play", onPlay);
    vid.addEventListener("pause", onPause);
    vid.addEventListener("ended", onEnded);
    return () => {
      vid.removeEventListener("timeupdate", onTime);
      vid.removeEventListener("loadedmetadata", onMeta);
      vid.removeEventListener("play", onPlay);
      vid.removeEventListener("pause", onPause);
      vid.removeEventListener("ended", onEnded);
    };
  }, [isVideo, loopEnabled, loopStartInput, loopEndInput]);

  // ── Canvas rendering ─────────────────────────────────────────────────────────

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 160;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0, 0, width, height);

    const waveData = audioState.waveData;
    if (!isVideo && waveData.length > 0) {
      ctx.strokeStyle = "rgba(124, 93, 255, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const mid = height / 2;
      const scale = width / waveData.length;
      for (let i = 0; i < waveData.length; i++) {
        const x = i * scale;
        const y = waveData[i] * mid;
        ctx.moveTo(x, mid - y);
        ctx.lineTo(x, mid + y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const tempo = parseFloat(speedInput) || 1;
    const effectiveDur = dur > 0 ? dur / tempo : 0;

    if (dur > 0) {
      const tickCount = 10;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px system-ui, sans-serif";
      for (let i = 0; i <= tickCount; i++) {
        const ratio = i / tickCount;
        const x = ratio * width;
        ctx.beginPath();
        ctx.moveTo(x, height - 14);
        ctx.lineTo(x, height - 7);
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.stroke();
        ctx.fillText(formatTime(effectiveDur * ratio), Math.max(0, x - 10), height - 1);
      }
    }

    // Draw saved regions
    if (dur > 0) {
      regionsRef.current.forEach((region, idx) => {
        const x1 = Math.min(1, region.start / dur) * width;
        const x2 = Math.min(1, region.end / dur) * width;
        const isActive = region.id === activeRegionIdRef.current;
        const baseColor = idx === 0 ? "124, 93, 255" : "109, 255, 203";
        ctx.fillStyle = `rgba(${baseColor}, ${isActive ? 0.32 : 0.18})`;
        ctx.strokeStyle = `rgba(${baseColor}, ${isActive ? 1 : 0.8})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(x1, height * 0.15, Math.max(1, x2 - x1), height * 0.7);
        ctx.fill();
        ctx.stroke();
        if (region.name) {
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.font = "11px system-ui, sans-serif";
          ctx.fillText(region.name, x1 + 4, height * 0.15 + 12);
        }
      });
    }

    // Current loop region overlay
    if (dur > 0) {
      const ls = parseTimeInput(loopStartInput, dur);
      const le = parseTimeInput(loopEndInput, dur);
      if (ls !== null && le !== null && le > ls) {
        const x1 = (ls / dur) * width;
        const x2 = (le / dur) * width;
        ctx.fillStyle = "rgba(124, 93, 255, 0.12)";
        ctx.fillRect(x1, height * 0.1, x2 - x1, height * 0.8);
        ctx.strokeStyle = "rgba(124, 93, 255, 0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, height * 0.1, x2 - x1, height * 0.8);
      }
    }

    // Markers
    if (dur > 0) {
      waveMarkersRef.current.forEach((marker, idx) => {
        const x = Math.min(1, marker.time / dur) * width;
        ctx.strokeStyle = idx === selectedMarkerIdxRef.current ? "#6dffcb" : "rgba(255,255,255,0.45)";
        ctx.lineWidth = idx === selectedMarkerIdxRef.current ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        if (marker.name) {
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          ctx.font = "11px system-ui, sans-serif";
          ctx.fillText(marker.name, x + 4, 13);
        }
      });
    }

    // Playhead
    if (dur > 0) {
      const ratio = Math.min(1, Math.max(0, currentTime / dur));
      const px = ratio * width;
      ctx.strokeStyle = "#f472b6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
  }, [isVideo, audioState.waveData, dur, currentTime, loopStartInput, loopEndInput, speedInput]);

  useEffect(() => { renderCanvas(); }, [renderCanvas]);

  // ── Loop handle positions ────────────────────────────────────────────────────

  const loopHandleStartPct = (() => {
    const v = parseTimeInput(loopStartInput, dur);
    return dur > 0 && v !== null ? (v / dur) * 100 : null;
  })();
  const loopHandleEndPct = (() => {
    const v = parseTimeInput(loopEndInput, dur);
    return dur > 0 && v !== null ? (v / dur) * 100 : null;
  })();

  // ── Canvas interactions ───────────────────────────────────────────────────────

  const seekFromCanvasX = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || dur <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = ratio * dur;
    if (isVideo && videoRef.current) videoRef.current.currentTime = t;
    else audioActions.seek(t);
  }, [isVideo, dur, audioActions]);

  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent) => {
      if (isDraggingCanvasRef.current) seekFromCanvasX(e.clientX);
      if (loopDragRef.current) {
        const container = loopHandleContainerRef.current;
        if (!container || dur <= 0) return;
        const rect = container.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const t = ratio * dur;
        if (loopDragRef.current === "start") {
          const le = parseTimeInput(loopEndInput, dur);
          if (le !== null && t >= le) return;
          const formatted = formatTime(t);
          setLoopStartInput(formatted);
          audioActions.setLoopStart(t);
        } else {
          const ls = parseTimeInput(loopStartInput, dur);
          if (ls !== null && t <= ls) return;
          const formatted = formatTime(t);
          setLoopEndInput(formatted);
          audioActions.setLoopEnd(t);
        }
      }
    };
    const onUp = () => {
      if (isDraggingCanvasRef.current) {
        isDraggingCanvasRef.current = false;
        schedulePresetSave();
      }
      if (loopDragRef.current) {
        loopDragRef.current = null;
        schedulePresetSave();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("pointermove", onMove as unknown as EventListener);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("pointermove", onMove as unknown as EventListener);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dur, loopStartInput, loopEndInput, audioActions, seekFromCanvasX, schedulePresetSave]);

  const handleCanvasMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    isDraggingCanvasRef.current = true;
    seekFromCanvasX(e.clientX);
  };

  const handleCanvasDblClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (dur <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    addMarkerAt(ratio * dur);
  };

  // ── Loop handle drag ─────────────────────────────────────────────────────────

  const handleHandleMouseDown = (which: "start" | "end") => () => {
    loopDragRef.current = which;
  };

  // ── Transport ─────────────────────────────────────────────────────────────────

  const handlePlayPause = () => {
    if (isVideo) {
      const vid = videoRef.current;
      if (!vid) return;
      if (vid.paused) vid.play().catch(() => {});
      else vid.pause();
    } else {
      if (audioState.isPlaying) audioActions.pause();
      else audioActions.play();
    }
  };

  const jumpByPercent = (pct: number) => {
    if (dur <= 0) return;
    const delta = dur * pct;
    const t = Math.max(0, Math.min(dur, currentTime + delta));
    if (isVideo && videoRef.current) videoRef.current.currentTime = t;
    else audioActions.seek(t);
  };

  // ── Speed ─────────────────────────────────────────────────────────────────────

  const applySpeed = (raw: string) => {
    const v = Math.max(0.25, Math.min(2.0, parseFloat(raw) || 1.0));
    const s = v.toFixed(2);
    setSpeedInput(s);
    speedRef.current = v;
    if (isVideo) {
      if (videoRef.current) videoRef.current.playbackRate = v;
    } else {
      audioActions.setSpeed(v);
    }
    schedulePresetSave();
  };

  // ── Pitch ─────────────────────────────────────────────────────────────────────

  const applyPitch = (sem: number, ct: number) => {
    setPitchSemitonesLocal(sem);
    setPitchCentsLocal(ct);
    audioActions.setPitch(sem, ct);
    schedulePresetSave();
  };

  // ── Loop inputs ───────────────────────────────────────────────────────────────

  const commitLoopStart = (val: string) => {
    const t = parseTimeInput(val, dur);
    if (t === null) {
      setLoopStartInput("");
      audioActions.setLoopStart(null);
      schedulePresetSave();
      return;
    }
    const le = parseTimeInput(loopEndInput, dur);
    if (le !== null && t >= le) {
      showToast("Loop end must be after loop start.", { icon: "⚠️", tone: "warning" });
      return;
    }
    setLoopStartInput(formatTime(t));
    audioActions.setLoopStart(t);
    schedulePresetSave();
  };

  const commitLoopEnd = (val: string) => {
    const t = parseTimeInput(val, dur);
    if (t === null) {
      setLoopEndInput("");
      audioActions.setLoopEnd(null);
      schedulePresetSave();
      return;
    }
    const ls = parseTimeInput(loopStartInput, dur);
    if (ls !== null && t <= ls) {
      showToast("Loop end must be after loop start.", { icon: "⚠️", tone: "warning" });
      return;
    }
    setLoopEndInput(formatTime(t));
    audioActions.setLoopEnd(t);
    schedulePresetSave();
  };

  const setLoopPointFromPlayhead = (which: "start" | "end") => {
    if (dur <= 0) return;
    if (which === "start") {
      commitLoopStart(String(currentTime));
      addMarkerAt(currentTime);
    } else {
      commitLoopEnd(String(currentTime));
      addMarkerAt(currentTime);
    }
  };

  const clearLoop = () => {
    setLoopStartInput("");
    setLoopEndInput("");
    audioActions.setLoopStart(null);
    audioActions.setLoopEnd(null);
    setActiveRegionId(null);
    setPresetStatus("Loop cleared");
    schedulePresetSave();
  };

  const nudgeLoopBound = (which: "start" | "end", delta: number) => {
    if (dur <= 0) return;
    if (which === "start") {
      const cur = parseTimeInput(loopStartInput, dur) ?? 0;
      const le = parseTimeInput(loopEndInput, dur) ?? dur;
      const next = Math.max(0, Math.min(cur + delta, le - 0.01));
      setLoopStartInput(formatTime(next));
      audioActions.setLoopStart(next);
    } else {
      const cur = parseTimeInput(loopEndInput, dur) ?? dur;
      const ls = parseTimeInput(loopStartInput, dur) ?? 0;
      const next = Math.min(dur, Math.max(cur + delta, ls + 0.01));
      setLoopEndInput(formatTime(next));
      audioActions.setLoopEnd(next);
    }
    schedulePresetSave();
  };

  // ── Markers ───────────────────────────────────────────────────────────────────

  const addMarkerAt = useCallback((time: number) => {
    if (!Number.isFinite(time) || dur <= 0) return;
    const clamped = Math.max(0, Math.min(dur, time));
    setWaveMarkers(prev => {
      const existing = prev.findIndex(m => Math.abs(m.time - clamped) < 0.05);
      let next: WaveMarker[];
      let idx: number;
      if (existing === -1) {
        next = [...prev, { time: clamped, name: "" }];
      } else {
        next = prev.map((m, i) => i === existing ? { ...m, time: clamped } : m);
      }
      next = [...next].sort((a, b) => a.time - b.time);
      idx = next.findIndex(m => m.time === clamped);
      waveMarkersRef.current = next;
      setSelectedMarkerIdx(idx);
      selectedMarkerIdxRef.current = idx;
      setMarkerNameInput(next[idx]?.name ?? "");
      return next;
    });
    schedulePresetSave();
  }, [dur, schedulePresetSave]);

  const addMarkerFromCurrentTime = () => addMarkerAt(currentTime);

  const jumpToMarker = (dir: "prev" | "next") => {
    const markers = waveMarkersRef.current;
    if (!markers.length) return;
    let idx = selectedMarkerIdxRef.current;
    if (idx === -1) idx = 0;
    else {
      if (dir === "next") idx = (idx + 1) % markers.length;
      else idx = (idx - 1 + markers.length) % markers.length;
    }
    const marker = markers[idx];
    setSelectedMarkerIdx(idx);
    selectedMarkerIdxRef.current = idx;
    setMarkerNameInput(marker.name ?? "");
    if (isVideo && videoRef.current) videoRef.current.currentTime = marker.time;
    else audioActions.seek(marker.time);
  };

  const deleteSelectedMarker = () => {
    const idx = selectedMarkerIdxRef.current;
    if (idx < 0) return;
    setWaveMarkers(prev => {
      const next = prev.filter((_, i) => i !== idx);
      waveMarkersRef.current = next;
      const newIdx = next.length ? Math.min(idx, next.length - 1) : -1;
      setSelectedMarkerIdx(newIdx);
      selectedMarkerIdxRef.current = newIdx;
      setMarkerNameInput(newIdx >= 0 ? (next[newIdx]?.name ?? "") : "");
      return next;
    });
    schedulePresetSave();
  };

  const clearAllMarkers = () => {
    setWaveMarkers([]);
    waveMarkersRef.current = [];
    setSelectedMarkerIdx(-1);
    selectedMarkerIdxRef.current = -1;
    setMarkerNameInput("");
    schedulePresetSave();
  };

  const nudgeSelectedMarker = (delta: number) => {
    const idx = selectedMarkerIdxRef.current;
    if (idx < 0 || dur <= 0) return;
    setWaveMarkers(prev => {
      const marker = prev[idx];
      if (!marker) return prev;
      const next = Math.max(0, Math.min(dur, marker.time + delta));
      const updated = prev.map((m, i) => i === idx ? { ...m, time: next } : m);
      const sorted = [...updated].sort((a, b) => a.time - b.time);
      const newIdx = sorted.findIndex(m => m.time === next);
      waveMarkersRef.current = sorted;
      setSelectedMarkerIdx(newIdx);
      selectedMarkerIdxRef.current = newIdx;
      return sorted;
    });
    schedulePresetSave();
  };

  // ── Regions ───────────────────────────────────────────────────────────────────

  const saveRegion = () => {
    const ls = parseTimeInput(loopStartInput, dur);
    const le = parseTimeInput(loopEndInput, dur);
    if (ls === null || le === null) {
      showToast("Set loop start and end before saving a region.", { icon: "⚠️", tone: "warning" });
      return;
    }
    if (le <= ls) {
      showToast("Loop end must be after loop start.", { icon: "⚠️", tone: "warning" });
      return;
    }
    const newRegion: Region = {
      id: createRegionId(),
      name: regionNameInput.trim() || `Region ${regionsRef.current.length + 1}`,
      start: ls,
      end: le,
      playbackSpeed: speedRef.current,
      speedIncreasePercent: loopIncreaseBy,
      speedIncreaseInterval: loopIncreaseAt,
      increaseEnabled: loopIncreaseEnabled,
      createdAt: Date.now(),
    };
    const next = [...regionsRef.current, newRegion];
    setRegions(next);
    regionsRef.current = next;
    setActiveRegionId(newRegion.id);
    activeRegionIdRef.current = newRegion.id;
    setRegionNameInput("");
    setPresetStatus("Region saved");
    showToast(`Region "${newRegion.name}" saved.`, { icon: "📍" });
    savePreset({ silent: true });
  };

  const applyRegion = (id: string) => {
    const region = regionsRef.current.find(r => r.id === id);
    if (!region) return;
    setLoopStartInput(formatTime(region.start));
    setLoopEndInput(formatTime(region.end));
    audioActions.setLoopStart(region.start);
    audioActions.setLoopEnd(region.end);
    applySpeed(region.playbackSpeed.toFixed(2));
    if (region.speedIncreasePercent !== undefined) {
      setLoopIncreaseByLocal(region.speedIncreasePercent);
      audioActions.setLoopIncreaseBy(region.speedIncreasePercent);
    }
    if (region.speedIncreaseInterval !== undefined) {
      setLoopIncreaseAtLocal(region.speedIncreaseInterval);
      audioActions.setLoopIncreaseAt(region.speedIncreaseInterval);
    }
    const incEnabled = region.increaseEnabled !== undefined
      ? Boolean(region.increaseEnabled)
      : region.speedIncreasePercent > 0;
    setLoopIncreaseEnabledLocal(incEnabled);
    audioActions.setLoopIncreaseEnabled(incEnabled);
    setActiveRegionId(id);
    activeRegionIdRef.current = id;
    setRegionNameInput(region.name ?? "");
    showToast(`Region "${region.name}" applied (${formatTime(region.start)} → ${formatTime(region.end)})`, { icon: "🎯" });
    if (isVideo && videoRef.current) videoRef.current.currentTime = region.start;
    else audioActions.seek(region.start);
    schedulePresetSave();
  };

  const deleteRegion = (id: string) => {
    const next = regionsRef.current.filter(r => r.id !== id);
    setRegions(next);
    regionsRef.current = next;
    if (activeRegionIdRef.current === id) {
      setActiveRegionId(null);
      activeRegionIdRef.current = null;
      setRegionNameInput("");
    }
    setPresetStatus("Region removed");
    showToast("Region removed.", { icon: "🗑", tone: "warning" });
    savePreset({ silent: true });
  };

  const renameRegion = (id: string, name: string) => {
    const next = regionsRef.current.map(r => r.id === id ? { ...r, name } : r);
    setRegions(next);
    regionsRef.current = next;
    savePreset({ silent: true });
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Shortcut rebind mode
      if (pendingRebind !== null) {
        e.preventDefault();
        if (e.key === "Escape") {
          setPendingRebind(null);
          return;
        }
        const base = normalizeKey(e.key);
        const mods: string[] = [];
        if (e.ctrlKey) mods.push("Ctrl");
        if (e.metaKey) mods.push("Meta");
        if (e.altKey) mods.push("Alt");
        if (e.shiftKey) mods.push("Shift");
        const key = mods.length ? `${mods.join("+")}+${base}` : base;
        const next = { ...shortcutBindingsRef.current, [pendingRebind]: key };
        setShortcutBindings(next);
        shortcutBindingsRef.current = next;
        try { localStorage.setItem(SHORTCUT_KEY, JSON.stringify(next)); } catch {}
        setPendingRebind(null);
        return;
      }

      if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
        return;
      }

      const target = e.target as HTMLElement;
      const isTyping =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && !["range", "checkbox"].includes(target.type)) ||
        target.isContentEditable;
      if (isTyping) return;
      if (paletteOpen) return;

      const base = normalizeKey(e.key);
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.metaKey) mods.push("Meta");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      const pressedKey = mods.length ? `${mods.join("+")}+${base}` : base;

      const bindings = shortcutBindingsRef.current;
      let actionId = Object.keys(bindings).find(id => bindings[id] === pressedKey);
      if (!actionId && e.key === "+" && bindings.increaseSpeed === "=") actionId = "increaseSpeed";
      if (!actionId) return;
      e.preventDefault();

      const step = 0.05;
      const curSpd = parseFloat(speedInput) || 1;

      switch (actionId) {
        case "togglePlayPause": handlePlayPause(); break;
        case "increaseSpeed": applySpeed(Math.min(2.0, curSpd + step).toFixed(2)); break;
        case "decreaseSpeed": applySpeed(Math.max(0.25, curSpd - step).toFixed(2)); break;
        case "jumpForward": jumpByPercent(0.05); break;
        case "jumpBackward": jumpByPercent(-0.05); break;
        case "setLoopStart": setLoopPointFromPlayhead("start"); break;
        case "setLoopEnd": setLoopPointFromPlayhead("end"); break;
        case "toggleLoop": {
          const next = !loopEnabled;
          setLoopEnabledLocal(next);
          audioActions.setLoopEnabled(next);
          schedulePresetSave();
          break;
        }
        case "nudgeLoopStartBack": nudgeLoopBound("start", -(dur * 0.05)); break;
        case "nudgeLoopStartForward": nudgeLoopBound("start", dur * 0.05); break;
        case "nudgeLoopEndBack": nudgeLoopBound("end", -(dur * 0.05)); break;
        case "nudgeLoopEndForward": nudgeLoopBound("end", dur * 0.05); break;
        case "nudgeLoopStartBackSmall": nudgeLoopBound("start", -LOOP_NUDGE); break;
        case "nudgeLoopStartForwardSmall": nudgeLoopBound("start", LOOP_NUDGE); break;
        case "nudgeLoopEndBackSmall": nudgeLoopBound("end", -LOOP_NUDGE); break;
        case "nudgeLoopEndForwardSmall": nudgeLoopBound("end", LOOP_NUDGE); break;
        case "nudgeMarkerBack": nudgeSelectedMarker(-MARKER_NUDGE); break;
        case "nudgeMarkerForward": nudgeSelectedMarker(MARKER_NUDGE); break;
        case "addMarker": addMarkerFromCurrentTime(); break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRebind, paletteOpen, loopEnabled, dur, speedInput, currentTime]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMetronome();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [stopMetronome]);

  // ── Render ───────────────────────────────────────────────────────────────────

  const atNormalSpeed = Math.abs((parseFloat(speedInput) || 1) - 1) < 0.001;

  return (
    <div className="media-player" data-testid="media-player">
      {/* Toasts */}
      <div className="mp-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`mp-toast mp-toast--${t.tone}`}>
            <span>{t.icon}</span> {t.message}
          </div>
        ))}
      </div>

      {/* Shortcut palette */}
      {paletteOpen && (
        <div className="mp-palette-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="mp-palette" onClick={e => e.stopPropagation()}>
            <div className="mp-palette-header">
              <span>Keyboard Shortcuts</span>
              <button className="btn-ghost btn-xs" onClick={() => {
                setShortcutBindings({ ...defaultShortcuts });
                shortcutBindingsRef.current = { ...defaultShortcuts };
                try { localStorage.setItem(SHORTCUT_KEY, JSON.stringify(defaultShortcuts)); } catch {}
              }}>Reset defaults</button>
              <button className="btn-ghost btn-xs" onClick={() => setPaletteOpen(false)}>✕</button>
            </div>
            <ul className="mp-palette-list">
              {shortcutOrder.map(id => {
                const meta = shortcutMeta[id];
                if (!meta) return null;
                return (
                  <li key={id} className="mp-palette-item">
                    <div>
                      <div className="mp-palette-label">{meta.label}</div>
                      <div className="mp-palette-desc">{meta.description}</div>
                    </div>
                    <button
                      className={`mp-shortcut-key ${pendingRebind === id ? "is-recording" : ""}`}
                      onClick={() => setPendingRebind(id)}
                    >
                      {pendingRebind === id ? "Press a key…" : formatShortcutKey(shortcutBindings[id] ?? "")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="media-player__header">
        <div className="media-player__title-group">
          <span className="media-player__item-name">{itemName}</span>
          <span className="media-player__type-badge">{isVideo ? "Video" : "Audio"}</span>
          {!isVideo && audioState.detectedBpm && (
            <span className="media-player__bpm-badge">~{audioState.detectedBpm} BPM</span>
          )}
          {timerElapsed !== undefined && (
            <span className={`media-player__session-timer${isTimerActive ? " media-player__session-timer--active" : ""}`}>
              {formatTime(timerElapsed)}
            </span>
          )}
        </div>
        <div className="media-player__header-actions">
          <span className="media-player__preset-status">{presetStatus}</span>
          <button className="btn-ghost btn-xs" onClick={() => setPaletteOpen(true)} title="Keyboard shortcuts">
            ⌨ Shortcuts
          </button>
          <button className="btn-ghost media-player__close" onClick={onClose} title="Close player">
            <XMarkIcon style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>

      {/* Video element */}
      {isVideo && (
        <div className="media-player__video-area">
          <video
            ref={videoRef}
            className="media-player__video"
            controls={false}
            playsInline
          />
        </div>
      )}

      {/* Transport */}
      <div className="media-player__transport">
        <span className="media-player__time">{formatTime(currentTime)} / {formatTime(dur)}</span>
        <div className="media-player__transport-btns">
          <button className="btn-ghost btn-xs" onClick={() => jumpByPercent(-0.05)} title="Skip back 5%">
            <BackwardIcon />
          </button>
          <button className="btn-ghost btn-xs" onClick={() => {
            const ls = parseTimeInput(loopStartInput, dur);
            const t = ls ?? 0;
            if (isVideo && videoRef.current) videoRef.current.currentTime = t;
            else audioActions.seek(t);
          }} title="Go to loop start">⏮</button>
          <button
            className="btn-primary media-player__play-btn"
            onClick={handlePlayPause}
            disabled={!isVideo && audioState.status === "loading"}
            title={playing ? "Pause" : "Play"}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button className="btn-ghost btn-xs" onClick={() => {
            const le = parseTimeInput(loopEndInput, dur);
            const t = le ?? dur;
            if (isVideo && videoRef.current) videoRef.current.currentTime = t;
            else audioActions.seek(t);
          }} title="Go to loop end">⏭</button>
          <button className="btn-ghost btn-xs" onClick={() => jumpByPercent(0.05)} title="Skip forward 5%">
            <ForwardIcon />
          </button>
        </div>

        <div className="media-player__speed-group">
          <label className="media-player__speed-label">Speed</label>
          <input
            type="range"
            id="playbackSpeed"
            className="media-player__speed-slider"
            min="0.25" max="2.0" step="0.05"
            value={speedInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => applySpeed(e.target.value)}
          />
          <input
            type="number"
            className="media-player__speed-input"
            min="0.25" max="2.0" step="0.05"
            value={speedInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSpeedInput(e.target.value)}
            onBlur={(e) => applySpeed(e.target.value)}
          />
          <span
            className={`media-player__speed-pct ${atNormalSpeed ? "normal-speed" : ""}`}
            id="speedIndicator"
          >
            {Math.round((parseFloat(speedInput) || 1) * 100)}%
          </span>
        </div>
      </div>

      {/* Waveform / timeline canvas */}
      <div className="media-player__canvas-wrap" data-video={isVideo ? "true" : "false"}>
        <canvas
          ref={canvasRef}
          id="waveCanvas"
          className="media-player__canvas"
          onMouseDown={handleCanvasMouseDown}
          onDoubleClick={handleCanvasDblClick}
          title="Click to seek · Double-click to add marker"
        />
        {/* Loop handles */}
        <div
          ref={loopHandleContainerRef}
          id="loopHandleContainer"
          className="media-player__loop-handles"
        >
          {loopHandleStartPct !== null && (
            <div
              id="loopHandleStart"
              className="media-player__loop-handle media-player__loop-handle--start"
              style={{ left: `${loopHandleStartPct}%` }}
              onMouseDown={handleHandleMouseDown("start")}
              onPointerDown={handleHandleMouseDown("start")}
              title="Loop start"
            >
              <div className="media-player__loop-handle-thumb" />
            </div>
          )}
          {loopHandleEndPct !== null && (
            <div
              id="loopHandleEnd"
              className="media-player__loop-handle media-player__loop-handle--end"
              style={{ left: `${loopHandleEndPct}%` }}
              onMouseDown={handleHandleMouseDown("end")}
              onPointerDown={handleHandleMouseDown("end")}
              title="Loop end"
            >
              <div className="media-player__loop-handle-thumb" />
            </div>
          )}
        </div>
        {!isVideo && audioState.status === "loading" && (
          <div className="media-player__canvas-status">Loading…</div>
        )}
        {!isVideo && audioState.status === "error" && (
          <div className="media-player__canvas-status">Failed to load file</div>
        )}
      </div>

      {/* Markers — sits directly under the timeline */}
      <section className="mp-section mp-markers-bar">
        <div className="mp-section-header">
          <span className="mp-section-label">Markers</span>
          <span id="waveMarkerLabel" className="mp-marker-count">
            {waveMarkers.length} marker{waveMarkers.length !== 1 ? "s" : ""}
            {selectedMarkerIdx >= 0 ? ` · ${selectedMarkerIdx + 1}/${waveMarkers.length} selected` : ""}
          </span>
        </div>
        <div className="mp-row mp-row--wrap">
          <button className="btn-ghost btn-xs" id="waveAddMarkerBtn" onClick={addMarkerFromCurrentTime} title="Add marker at playhead">Add</button>
          <button className="btn-ghost btn-xs" id="wavePrevMarkerBtn" onClick={() => jumpToMarker("prev")} disabled={!waveMarkers.length} title="Previous marker">◀ Prev</button>
          <button className="btn-ghost btn-xs" id="waveNextMarkerBtn" onClick={() => jumpToMarker("next")} disabled={!waveMarkers.length} title="Next marker">Next ▶</button>
          <button className="btn-ghost btn-xs" id="waveDeleteMarkerBtn" onClick={deleteSelectedMarker} disabled={selectedMarkerIdx < 0} title="Delete selected marker">Delete</button>
          <button className="btn-ghost btn-xs" id="waveClearMarkersBtn" onClick={clearAllMarkers} disabled={!waveMarkers.length} title="Clear all markers">Clear all</button>
          {selectedMarkerIdx >= 0 && (
            <>
              <span className="mp-marker-sep">·</span>
              <label className="mp-pitch-label">Name</label>
              <input
                type="text"
                id="waveMarkerName"
                className="mp-marker-name-input"
                value={markerNameInput}
                placeholder="Marker name…"
                onChange={e => {
                  setMarkerNameInput(e.target.value);
                  const idx = selectedMarkerIdxRef.current;
                  if (idx < 0) return;
                  setWaveMarkers(prev => {
                    const next = prev.map((m, i) => i === idx ? { ...m, name: e.target.value } : m);
                    waveMarkersRef.current = next;
                    return next;
                  });
                  schedulePresetSave();
                }}
              />
            </>
          )}
        </div>
      </section>

      {/* Controls panel */}
      <div className="media-player__controls">

        {/* Two-column controls area */}
        <div className="media-player__cols">

          {/* Left column */}
          <div className="media-player__col">

            {/* Loop */}
            <section className="mp-section">
              <div className="mp-section-header">
                <span className="mp-section-label">Loop</span>
                <button className="btn-ghost btn-xs" onClick={clearLoop} title="Clear loop">Clear</button>
              </div>
              <div className="media-player__loop-inputs">
                <div className="media-player__loop-field">
                  <label>In</label>
                  <input
                    type="text"
                    id="loopStart"
                    className="media-player__loop-time-input"
                    placeholder="0:00"
                    value={loopStartInput}
                    onChange={e => setLoopStartInput(e.target.value)}
                    onBlur={e => commitLoopStart(e.target.value)}
                  />
                  <button className="btn-ghost btn-xs" onClick={() => setLoopPointFromPlayhead("start")} title="Set from playhead">◁</button>
                </div>
                <div className="media-player__loop-field">
                  <label>Out</label>
                  <input
                    type="text"
                    id="loopEnd"
                    className="media-player__loop-time-input"
                    placeholder="end"
                    value={loopEndInput}
                    onChange={e => setLoopEndInput(e.target.value)}
                    onBlur={e => commitLoopEnd(e.target.value)}
                  />
                  <button className="btn-ghost btn-xs" onClick={() => setLoopPointFromPlayhead("end")} title="Set from playhead">▷</button>
                </div>
              </div>
              <div className="mp-row">
                <label className="media-player__checkbox-label">
                  <input
                    type="checkbox"
                    id="loopPlayback"
                    checked={loopEnabled}
                    onChange={e => {
                      setLoopEnabledLocal(e.target.checked);
                      audioActions.setLoopEnabled(e.target.checked);
                      schedulePresetSave();
                    }}
                  />
                  Loop
                </label>
              </div>
              <div className="media-player__loop-increase">
                <label className="media-player__checkbox-label">
                  <input
                    type="checkbox"
                    id="loopIncrease"
                    checked={loopIncreaseEnabled}
                    onChange={e => {
                      setLoopIncreaseEnabledLocal(e.target.checked);
                      audioActions.setLoopIncreaseEnabled(e.target.checked);
                      schedulePresetSave();
                    }}
                  />
                  Auto-increase
                </label>
                <input
                  type="number"
                  id="loopIncreaseBy"
                  className="media-player__loop-num-input"
                  min="1" max="50"
                  value={loopIncreaseBy}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 5;
                    setLoopIncreaseByLocal(v);
                    audioActions.setLoopIncreaseBy(v);
                    schedulePresetSave();
                  }}
                  title="Percent increase"
                />
                <span>% every</span>
                <input
                  type="number"
                  id="loopIncreaseAt"
                  className="media-player__loop-num-input"
                  min="1" max="20"
                  value={loopIncreaseAt}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 3;
                    setLoopIncreaseAtLocal(v);
                    audioActions.setLoopIncreaseAt(v);
                    schedulePresetSave();
                  }}
                  title="Loop count before bump"
                />
                <span>loops</span>
              </div>
            </section>

            {/* Pitch (audio only) */}
            {!isVideo && (
              <section className="mp-section">
                <div className="mp-section-header">
                  <span className="mp-section-label">Pitch</span>
                  <span id="pitchSummary" className="mp-pitch-summary">{pitchSemitones} st / {pitchCents} ct</span>
                  <button className="btn-ghost btn-xs" onClick={() => applyPitch(0, 0)} id="resetPitchBtn">Reset</button>
                </div>
                <div className="mp-pitch-row">
                  <label className="mp-pitch-label">Semitones</label>
                  <input
                    type="range"
                    id="semitoneShift"
                    className="mp-pitch-slider"
                    min="-12" max="12" step="1"
                    value={pitchSemitones}
                    onChange={e => applyPitch(Number(e.target.value), pitchCents)}
                  />
                  <span id="semitoneValue" className="mp-pitch-value">{pitchSemitones}</span>
                </div>
                <div className="mp-pitch-row">
                  <label className="mp-pitch-label">Cents</label>
                  <input
                    type="range"
                    id="centShift"
                    className="mp-pitch-slider"
                    min="-100" max="100" step="1"
                    value={pitchCents}
                    onChange={e => applyPitch(pitchSemitones, Number(e.target.value))}
                  />
                  <span id="centValue" className="mp-pitch-value">{pitchCents}</span>
                </div>
              </section>
            )}


          </div>

          {/* Right column */}
          <div className="media-player__col">

            {/* Regions */}
            <section className="mp-section">
              <div className="mp-section-header">
                <span className="mp-section-label">Regions</span>
              </div>
              <div className="mp-row">
                <input
                  type="text"
                  id="regionNameInput"
                  className="mp-region-name-input"
                  placeholder="Region name…"
                  value={regionNameInput}
                  onChange={e => {
                    setRegionNameInput(e.target.value);
                    if (activeRegionId) renameRegion(activeRegionId, e.target.value);
                  }}
                />
                <button className="btn-ghost btn-xs" id="addRegionBtn" onClick={saveRegion} title="Save current loop as region">Save Region</button>
              </div>
              {regions.length > 0 && (
                <ul id="regionList" className="mp-region-list">
                  {regions.map((region, idx) => {
                    const speedLabel = `${Math.round((region.playbackSpeed ?? 1) * 100)}%`;
                    const incStr = region.increaseEnabled && region.speedIncreasePercent > 0
                      ? ` · +${region.speedIncreasePercent}% every ${region.speedIncreaseInterval} loops`
                      : "";
                    return (
                      <li
                        key={region.id}
                        data-region-id={region.id}
                        className={`mp-region-item ${region.id === activeRegionId ? "is-active" : ""}`}
                      >
                        <div className="mp-region-title">
                          {region.name || `Region ${idx + 1}`}
                        </div>
                        <div className="mp-region-meta">
                          {formatTime(region.start)} → {formatTime(region.end)} · {speedLabel}{incStr}
                        </div>
                        <div className="mp-region-actions">
                          <button className="btn-ghost btn-xs" data-region-action="apply" onClick={() => applyRegion(region.id)}>Apply</button>
                          <button className="btn-ghost btn-xs" data-region-action="rename" onClick={() => {
                            setActiveRegionId(region.id);
                            setRegionNameInput(region.name ?? "");
                          }}>Rename</button>
                          <button className="btn-ghost btn-xs" data-region-action="delete" onClick={() => deleteRegion(region.id)}>Remove</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {regions.length === 0 && (
                <p id="regionEmptyState" className="mp-empty-state">
                  Save loop settings to start a region list.
                </p>
              )}
            </section>

            {/* Metronome */}
            {!isVideo && (
              <section className="mp-section">
                <div className="mp-section-header">
                  <span className="mp-section-label">Metronome</span>
                  <span id="metronomeStatus" className="mp-metronome-status">
                    {metronomeEnabled
                      ? `On · ${Math.round(metronomeBpm * (metronomeFollowSpeed ? (parseFloat(speedInput) || 1) : 1))} BPM`
                      : "Off"}
                  </span>
                </div>
                <div className="media-player__metronome-controls">
                  <input
                    type="number"
                    id="metronomeBpm"
                    className="media-player__bpm-input"
                    min="40" max="260"
                    value={metronomeBpm}
                    onChange={e => setMetronomeBpm(Math.max(40, Math.min(260, parseInt(e.target.value) || 120)))}
                    title="BPM"
                  />
                  <span className="media-player__bpm-label">BPM</span>
                  <select
                    id="metronomeAccent"
                    className="media-player__timesig"
                    value={metronomeBeats}
                    onChange={e => setMetronomeBeats(parseInt(e.target.value))}
                    title="Accent beats"
                  >
                    <option value={2}>2/4</option>
                    <option value={3}>3/4</option>
                    <option value={4}>4/4</option>
                    <option value={6}>6/8</option>
                    <option value={0}>No accent</option>
                  </select>
                  <div
                    className={`media-player__beat-indicator ${metronomeBeatFlash ? "is-flashing" : ""}`}
                    title="Beat"
                  />
                  <button className="btn-ghost btn-xs" onClick={handleTapTempo} title="Tap tempo">Tap</button>
                  <button
                    className={`btn-ghost ${metronomeEnabled ? "is-active" : ""}`}
                    id="metronomeToggle"
                    onClick={toggleMetronome}
                  >
                    {metronomeEnabled ? "Stop" : "Start"}
                  </button>
                </div>
                <div className="mp-row mp-row--wrap">
                  <label className="media-player__checkbox-label">
                    <input
                      type="checkbox"
                      id="metronomeFollowSpeed"
                      checked={metronomeFollowSpeed}
                      onChange={e => setMetronomeFollowSpeed(e.target.checked)}
                    />
                    Follow speed
                  </label>
                  <label className="media-player__checkbox-label">
                    <input
                      type="checkbox"
                      id="metronomeCountIn"
                      checked={metronomeCountIn}
                      onChange={e => setMetronomeCountIn(e.target.checked)}
                    />
                    Count-in on loop
                  </label>
                </div>
              </section>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
