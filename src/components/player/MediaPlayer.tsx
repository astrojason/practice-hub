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
import { useMetronomeEngine } from "./useMetronomeEngine";
import { useMarkers, type WaveMarker } from "./useMarkers";
import { useRegions, type Region } from "./useRegions";
import { useShortcuts, shortcutMeta, shortcutOrder } from "./useShortcuts";
import { seekVideo } from "./videoSeek";
import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";
import { ErrorModal } from "../ErrorModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type PlayerMediaType = "audio" | "video";

interface Props {
  filePath: string;
  mediaType: PlayerMediaType;
  itemName: string;
  onClose: () => void;
  /** Session practice timer for the item associated with this file */
  timerElapsed?: number;
  isTimerActive?: boolean;
  /** When set, automatically seeks to and activates the region matching this section id */
  activeSectionId?: number | null;
  /** Auth token — required for DB region save/delete */
  token?: string;
  /** Song ID — when provided, regions are synced to the DB as song sections */
  songId?: number;
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
  loopBreakEnabled?: boolean;
  loopBreakAfter?: string;
  loopBreakDuration?: string;
  metronomeBpm: number;
  pitchSemitones: number;
  pitchCents: number;
  regions: Region[];
  markers: WaveMarker[];
  sequenceRegionIds?: string[];
  sequenceLoop?: boolean;
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
const LOOP_NUDGE = 0.5;
const MARKER_NUDGE = 0.5;
const SEEK_STEP = 5;

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
  return ["mp4", "mov", "webm", "m4v"].includes(ext) ? "video" : "audio";
}

function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  return key.length === 1 ? key.toLowerCase() : key;
}

function formatShortcutKey(key: string): string {
  if (!key) return "Unassigned";
  return key.split("+").map(p => p.length === 1 ? p.toUpperCase() : p).join("+");
}

function loadPresets(): { value: Record<string, Preset>; error: string | null } {
  const { value, error } = readLocalStorageJSON<Record<string, Preset>>(PRESET_KEY, {});
  return {
    value,
    error: error && `Couldn't load your saved player presets — loop/speed/marker settings won't be pre-filled. (${error})`,
  };
}

function savePresets(p: Record<string, Preset>): void {
  writeLocalStorageJSON(PRESET_KEY, p);
}

let toastCounter = 0;

// ─── Component ────────────────────────────────────────────────────────────────

export function MediaPlayer({ filePath, itemName, onClose, timerElapsed, isTimerActive, activeSectionId, token, songId }: Props) {
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

  // ── Loop increase refs (for use inside event handlers without stale closures) ─
  const videoLoopCountRef = useRef(0);
  const loopIncreaseEnabledRef = useRef(false);
  const loopIncreaseByRef = useRef(5);
  const loopIncreaseAtRef = useRef(3);
  const schedulePresetSaveRef = useRef<() => void>(() => {});

  // ── Loop break ───────────────────────────────────────────────────────────────
  const [loopBreakEnabled, setLoopBreakEnabledLocal] = useState(false);
  const [loopBreakAfter, setLoopBreakAfterLocal] = useState(8);
  const [loopBreakDuration, setLoopBreakDurationLocal] = useState(3);
  const loopBreakEnabledRef = useRef(false);
  const loopBreakAfterRef = useRef(8);
  const loopBreakDurationRef = useRef(3);
  const videoBreakCountRef = useRef(0);
  const videoBreakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Pitch ───────────────────────────────────────────────────────────────────
  const [pitchSemitones, setPitchSemitonesLocal] = useState(0);
  const [pitchCents, setPitchCentsLocal] = useState(0);

  // ── Markers ─────────────────────────────────────────────────────────────────
  const markerState = useMarkers({
    dur,
    getCurrentTime: () => isVideo ? (videoRef.current?.currentTime ?? currentTime) : audioActions.getCurrentTime(),
    isVideo,
    videoRef,
    seekAudio: (t) => audioActions.seek(t),
    onChange: () => schedulePresetSaveRef.current(),
  });

  // ── Regions ──────────────────────────────────────────────────────────────────
  const [regionNameInput, setRegionNameInput] = useState("");
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [editingRegionName, setEditingRegionName] = useState("");
  const regionState = useRegions({
    token,
    songId,
    onServerError: (msg) => showToast(msg, { icon: "⚠️", tone: "warning" }),
  });

  // ── Region sequence playback ─────────────────────────────────────────────────
  // Plays a chronologically-ordered walk through the checked regions, applying
  // each region's own playbackSpeed as the playhead crosses into it.
  const [sequenceLoop, setSequenceLoopLocal] = useState(false);
  const sequenceLoopRef = useRef(false);
  const [sequenceActive, setSequenceActiveState] = useState(false);
  const sequenceActiveRef = useRef(false);
  const [sequenceIndex, setSequenceIndexState] = useState(0);
  const sequenceIndexRef = useRef(0);
  const sequenceOrderRef = useRef<Region[]>([]);

  const setSequenceActive = useCallback((v: boolean) => {
    setSequenceActiveState(v);
    sequenceActiveRef.current = v;
  }, []);
  const setSequenceIndex = useCallback((i: number) => {
    setSequenceIndexState(i);
    sequenceIndexRef.current = i;
  }, []);

  // ── Toasts ──────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);

  // ── Preset ──────────────────────────────────────────────────────────────────
  const [presetStatus, setPresetStatusText] = useState("Not saved");
  const presetSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presetStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPresetLoadRef = useRef<ReturnType<typeof loadPresets> | null>(null);
  if (initialPresetLoadRef.current === null) initialPresetLoadRef.current = loadPresets();
  const presetsRef = useRef<Record<string, Preset>>(initialPresetLoadRef.current.value);
  // Always points to the latest savePreset, used to flush on unmount
  const savePresetRef = useRef<(opts?: { silent?: boolean }) => void>(() => {});

  // ── Shortcuts ────────────────────────────────────────────────────────────────
  const shortcuts = useShortcuts({
    onPersistError: (msg) => setPersistError((prev) => prev ?? msg),
  });
  const [persistError, setPersistError] = useState<string | null>(
    initialPresetLoadRef.current.error ?? shortcuts.initialLoadError
  );

  // ── Metronome ────────────────────────────────────────────────────────────────
  const [metronomeFollowSpeed, setMetronomeFollowSpeed] = useState(true);
  const [metronomeCountIn, setMetronomeCountIn] = useState(true);
  const metronomeFollowSpeedRef = useRef(true);
  const metronomeCountInRef = useRef(true);
  const metronome = useMetronomeEngine({
    getAudioContext: () => audioActions.getContext(),
    speedMultiplier: () => (metronomeFollowSpeedRef.current ? speedRef.current : 1.0),
  });

  // ── Ref sync ────────────────────────────────────────────────────────────────
  useEffect(() => { metronomeFollowSpeedRef.current = metronomeFollowSpeed; }, [metronomeFollowSpeed]);
  useEffect(() => { metronomeCountInRef.current = metronomeCountIn; }, [metronomeCountIn]);
  useEffect(() => { speedRef.current = parseFloat(speedInput) || 1.0; }, [speedInput]);
  useEffect(() => { loopIncreaseEnabledRef.current = loopIncreaseEnabled; }, [loopIncreaseEnabled]);
  useEffect(() => { loopIncreaseByRef.current = loopIncreaseBy; }, [loopIncreaseBy]);
  useEffect(() => { loopIncreaseAtRef.current = loopIncreaseAt; }, [loopIncreaseAt]);
  // Sync speedInput when the audio engine auto-increments speed
  useEffect(() => {
    if (isVideo) return;
    const s = audioState.speed.toFixed(2);
    setSpeedInput(s);
    speedRef.current = audioState.speed;
  }, [audioState.speed, isVideo]);
  useEffect(() => { loopBreakEnabledRef.current = loopBreakEnabled; }, [loopBreakEnabled]);
  useEffect(() => { loopBreakAfterRef.current = loopBreakAfter; }, [loopBreakAfter]);
  useEffect(() => { loopBreakDurationRef.current = loopBreakDuration; }, [loopBreakDuration]);
  useEffect(() => { sequenceLoopRef.current = sequenceLoop; }, [sequenceLoop]);

  // ── Active section linkage ────────────────────────────────────────────────────
  useEffect(() => {
    if (activeSectionId == null) return;
    const region = regionState.regionsRef.current.find(r => r.section_id === activeSectionId);
    if (!region) return;
    regionState.setActiveRegionId(region.id);
    if (isVideo && videoRef.current) {
      seekVideo(videoRef.current, region.start);
    } else {
      audioActions.seek(region.start);
      audioActions.setLoopStart(region.start);
      audioActions.setLoopEnd(region.end);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionId]);

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
      loopBreakEnabled,
      loopBreakAfter: String(loopBreakAfter),
      loopBreakDuration: String(loopBreakDuration),
      metronomeBpm: metronome.bpm,
      pitchSemitones,
      pitchCents,
      regions: regionState.regionsRef.current,
      markers: markerState.markersRef.current,
      sequenceRegionIds: regionState.selectedIdsRef.current,
      sequenceLoop: sequenceLoopRef.current,
      updatedAt: Date.now(),
    };
    try {
      savePresets(presets);
      if (!opts.silent) setPresetStatus("Preset saved");
      else setPresetStatusText("All changes saved");
    } catch (err) {
      setPresetStatusText("Not saved");
      setPersistError(`Couldn't save your player preset — loop/speed/marker settings won't persist. (${err instanceof Error ? err.message : String(err)})`);
    }
  }, [filePath, isVideo, loopStartInput, loopEndInput, loopIncreaseBy, loopIncreaseAt,
      loopIncreaseEnabled, loopEnabled, loopBreakEnabled, loopBreakAfter, loopBreakDuration,
      metronome.bpm, pitchSemitones, pitchCents, setPresetStatus]);

  const schedulePresetSave = useCallback(() => {
    if (presetSaveTimerRef.current) clearTimeout(presetSaveTimerRef.current);
    presetSaveTimerRef.current = setTimeout(savePreset, 400);
  }, [savePreset]);

  useEffect(() => { schedulePresetSaveRef.current = schedulePresetSave; }, [schedulePresetSave]);
  useEffect(() => { savePresetRef.current = savePreset; }, [savePreset]);

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
      setLoopBreakEnabledLocal(false);
      audioActions.setLoopBreakEnabled(false);
      setLoopBreakAfterLocal(8);
      audioActions.setLoopBreakAfter(8);
      setLoopBreakDurationLocal(3);
      audioActions.setLoopBreakDuration(3);
      const spd = "1.00";
      setSpeedInput(spd);
      speedRef.current = 1.0;
      if (!isVideo) audioActions.setSpeed(1.0);
      setPitchSemitonesLocal(0);
      setPitchCentsLocal(0);
      audioActions.setPitch(0, 0);
      markerState.loadMarkers([]);
      regionState.loadRegions([]);
      setRegionNameInput("");
      setSequenceLoopLocal(false);
      sequenceLoopRef.current = false;
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
    const breakEn = typeof preset.loopBreakEnabled === "boolean" ? preset.loopBreakEnabled : false;
    setLoopBreakEnabledLocal(breakEn);
    audioActions.setLoopBreakEnabled(breakEn);
    const breakAfter = parseInt(preset.loopBreakAfter ?? "8") || 8;
    setLoopBreakAfterLocal(breakAfter);
    audioActions.setLoopBreakAfter(breakAfter);
    const breakDur = parseInt(preset.loopBreakDuration ?? "3") || 3;
    setLoopBreakDurationLocal(breakDur);
    audioActions.setLoopBreakDuration(breakDur);
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
      metronome.setBpmImmediate(preset.metronomeBpm);
    }
    markerState.loadMarkers(preset.markers);
    regionState.loadRegions(preset.regions);
    regionState.setSelectedIds(preset.sequenceRegionIds ?? []);
    setRegionNameInput("");
    const seqLoop = Boolean(preset.sequenceLoop);
    setSequenceLoopLocal(seqLoop);
    sequenceLoopRef.current = seqLoop;
    setPresetStatusText("All changes saved");
  }, [audioActions, isVideo, metronome.setBpmImmediate, markerState.loadMarkers, regionState.loadRegions, regionState.setSelectedIds]);

  // ── Metronome ────────────────────────────────────────────────────────────────

  // Keep count-in callback wired into the audio engine
  useEffect(() => {
    if (!isVideo && metronome.enabled && metronomeCountIn) {
      audioActions.setCountIn(metronome.performCountIn);
    } else {
      audioActions.setCountIn(null);
    }
  }, [isVideo, metronome.enabled, metronomeCountIn, metronome.performCountIn, audioActions]);

  useEffect(() => {
    if (!isVideo) {
      audioActions.setBreakCountIn(loopBreakEnabled ? metronome.performCountIn : null);
    }
  }, [isVideo, loopBreakEnabled, metronome.performCountIn, audioActions]);

  // Auto-set BPM from detected value
  useEffect(() => {
    if (audioState.detectedBpm) metronome.setBpmImmediate(audioState.detectedBpm);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioState.detectedBpm]);

  // ── Load file ────────────────────────────────────────────────────────────────

  useEffect(() => {
    metronome.stop();
    sequenceOrderRef.current = [];
    setSequenceActive(false);
    setSequenceIndex(0);
    const preset = presetsRef.current[filePath];
    applyPreset(preset);

    if (isVideo) {
      const vid = videoRef.current;
      if (!vid) return;
      videoLoopCountRef.current = 0;
      videoBreakCountRef.current = 0;
      vid.src = assetUrl(filePath);
      vid.load();
      // Restore playback speed from preset
      vid.preservesPitch = true;
      vid.playbackRate = speedRef.current;
      if (preset?.loopStart) {
        const ls = parseTimeInput(preset.loopStart, 9999);
        if (ls !== null) vid.currentTime = ls;
      }
      vid.play().catch(() => {}); /* non-critical: autoplay policy rejection, no data loss */
      setVideoCurrentTime(0);
      setVideoDuration(0);
      setVideoPlaying(false);
    } else {
      audioActions.loadFile(filePath);
    }

    return () => {
      if (!isVideo) audioActions.destroy();
      metronome.stop();
      // Flush any pending debounced save before unmounting so settings aren't lost
      if (presetSaveTimerRef.current) {
        clearTimeout(presetSaveTimerRef.current);
        presetSaveTimerRef.current = null;
        savePresetRef.current({ silent: true });
      }
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
        videoLoopCountRef.current++;
        if (loopIncreaseEnabledRef.current && loopIncreaseAtRef.current > 0 && videoLoopCountRef.current >= loopIncreaseAtRef.current) {
          videoLoopCountRef.current = 0;
          const next = Math.min(3.0, speedRef.current * (1 + loopIncreaseByRef.current / 100));
          const s = next.toFixed(2);
          setSpeedInput(s);
          speedRef.current = next;
          vid.preservesPitch = true;
          vid.playbackRate = next;
          schedulePresetSaveRef.current();
        }
        if (loopBreakEnabledRef.current && loopBreakAfterRef.current > 0) {
          videoBreakCountRef.current++;
          if (videoBreakCountRef.current >= loopBreakAfterRef.current) {
            videoBreakCountRef.current = 0;
            vid.pause();
            if (videoBreakTimerRef.current) clearTimeout(videoBreakTimerRef.current);
            videoBreakTimerRef.current = setTimeout(() => {
              metronome.performCountIn().then(() => {
                videoBreakTimerRef.current = null;
                vid.play().catch(() => {}); /* non-critical: autoplay policy rejection, no data loss */
              });
            }, loopBreakDurationRef.current * 1000);
            return;
          }
        }
        if (vid.paused) vid.play().catch(() => {}); /* non-critical: autoplay policy rejection, no data loss */
      }
    };
    const onMeta = () => setVideoDuration(vid.duration);
    const onPlay = () => setVideoPlaying(true);
    const onPause = () => setVideoPlaying(false);
    const onEnded = () => {
      if (loopEnabled) {
        const ls = parseTimeInput(loopStartInput, vid.duration) ?? 0;
        vid.currentTime = ls;
        vid.play().catch(() => {}); /* non-critical: autoplay policy rejection, no data loss */
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
      if (videoBreakTimerRef.current) { clearTimeout(videoBreakTimerRef.current); videoBreakTimerRef.current = null; }
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
      regionState.regionsRef.current.forEach((region, idx) => {
        const x1 = Math.min(1, region.start / dur) * width;
        const x2 = Math.min(1, region.end / dur) * width;
        const isActive = region.id === regionState.activeRegionIdRef.current;
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
      markerState.markersRef.current.forEach((marker, idx) => {
        const x = Math.min(1, marker.time / dur) * width;
        ctx.strokeStyle = idx === markerState.selectedIdx ? "#6dffcb" : "rgba(255,255,255,0.45)";
        ctx.lineWidth = idx === markerState.selectedIdx ? 2 : 1;
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
    if (isVideo && videoRef.current) seekVideo(videoRef.current, t);
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
    markerState.addMarkerAt(ratio * dur);
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
      if (vid.paused) vid.play().catch(() => {}); /* non-critical: autoplay policy rejection, no data loss */
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
    if (isVideo && videoRef.current) seekVideo(videoRef.current, t);
    else audioActions.seek(t);
  };

  // ── Speed ─────────────────────────────────────────────────────────────────────

  const applySpeed = (raw: string) => {
    const v = Math.max(0.25, Math.min(2.0, parseFloat(raw) || 1.0));
    const s = v.toFixed(2);
    setSpeedInput(s);
    speedRef.current = v;
    if (isVideo) {
      if (videoRef.current) {
        videoRef.current.preservesPitch = true;
        videoRef.current.playbackRate = v;
      }
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
      markerState.addMarkerAt(currentTime);
    } else {
      commitLoopEnd(String(currentTime));
      markerState.addMarkerAt(currentTime);
    }
  };

  const clearLoop = () => {
    setLoopStartInput("");
    setLoopEndInput("");
    audioActions.setLoopStart(null);
    audioActions.setLoopEnd(null);
    regionState.setActiveRegionId(null);
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

  // ── Regions ───────────────────────────────────────────────────────────────────

  const saveRegion = async () => {
    if (dur <= 0) {
      showToast("Media not loaded.", { icon: "⚠️", tone: "warning" });
      return;
    }
    const ls = parseTimeInput(loopStartInput, dur) ?? 0;
    const le = parseTimeInput(loopEndInput, dur) ?? dur;
    if (le <= ls) {
      showToast("Loop end must be after loop start.", { icon: "⚠️", tone: "warning" });
      return;
    }
    const name = regionNameInput.trim() || `Region ${regionState.regionsRef.current.length + 1}`;
    const newRegion = await regionState.createRegion({
      name,
      start: ls,
      end: le,
      playbackSpeed: speedRef.current,
      speedIncreasePercent: loopIncreaseBy,
      speedIncreaseInterval: loopIncreaseAt,
      increaseEnabled: loopIncreaseEnabled,
    });
    setRegionNameInput("");
    setLoopStartInput("");
    setLoopEndInput("");
    audioActions.setLoopStart(null);
    audioActions.setLoopEnd(null);
    setPresetStatus("Region saved");
    showToast(`Region "${newRegion.name}" saved.`, { icon: "📍" });
    savePreset({ silent: true });
  };

  const applyRegion = (id: string) => {
    if (sequenceActiveRef.current) stopSequence();
    if (regionState.activeRegionIdRef.current === id) {
      regionState.setActiveRegionId(null);
      setRegionNameInput("");
      setLoopStartInput("");
      setLoopEndInput("");
      audioActions.setLoopStart(null);
      audioActions.setLoopEnd(null);
      return;
    }
    const region = regionState.regionsRef.current.find(r => r.id === id);
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
    regionState.setActiveRegionId(id);
    setRegionNameInput(region.name ?? "");
    showToast(`Region "${region.name}" applied (${formatTime(region.start)} → ${formatTime(region.end)})`, { icon: "🎯" });
    if (isVideo && videoRef.current) seekVideo(videoRef.current, region.start);
    else audioActions.seek(region.start);
    schedulePresetSave();
  };

  const deleteRegion = (id: string) => {
    const wasActive = regionState.activeRegionIdRef.current === id;
    regionState.removeRegion(id);
    if (wasActive) setRegionNameInput("");
    setPresetStatus("Region removed");
    showToast("Region removed.", { icon: "🗑", tone: "warning" });
    savePreset({ silent: true });
  };

  const renameRegion = (id: string, name: string) => {
    regionState.renameRegionAt(id, name);
    savePreset({ silent: true });
  };

  const updateActiveRegion = () => {
    const id = regionState.activeRegionIdRef.current;
    if (!id || dur <= 0) return;
    const ls = parseTimeInput(loopStartInput, dur) ?? 0;
    const le = parseTimeInput(loopEndInput, dur) ?? dur;
    if (le <= ls) {
      showToast("Loop end must be after loop start.", { icon: "⚠️", tone: "warning" });
      return;
    }
    const existing = regionState.regionsRef.current.find(r => r.id === id);
    const name = regionNameInput.trim() || existing?.name || "";
    regionState.updateRegionAt(id, {
      name,
      start: ls,
      end: le,
      playbackSpeed: speedRef.current,
      speedIncreasePercent: loopIncreaseBy,
      speedIncreaseInterval: loopIncreaseAt,
      increaseEnabled: loopIncreaseEnabled,
    });
    setPresetStatus("Region updated");
    showToast(`Region "${name}" updated.`, { icon: "✏️" });
    savePreset({ silent: true });
  };

  // ── Region sequence playback ─────────────────────────────────────────────────

  const seekTo = useCallback((t: number) => {
    if (isVideo && videoRef.current) seekVideo(videoRef.current, t);
    else audioActions.seek(t);
  }, [isVideo, audioActions]);

  const applySequenceStep = useCallback((region: Region) => {
    seekTo(region.start);
    applySpeed(region.playbackSpeed.toFixed(2));
    setLoopIncreaseByLocal(region.speedIncreasePercent);
    audioActions.setLoopIncreaseBy(region.speedIncreasePercent);
    setLoopIncreaseAtLocal(region.speedIncreaseInterval);
    audioActions.setLoopIncreaseAt(region.speedIncreaseInterval);
    regionState.setActiveRegionId(region.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTo, audioActions, regionState.setActiveRegionId]);

  const stopSequence = useCallback(() => {
    sequenceOrderRef.current = [];
    setSequenceActive(false);
    regionState.setActiveRegionId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSequenceActive, regionState.setActiveRegionId]);

  const startSequence = () => {
    const selected = regionState.regionsRef.current.filter(r => regionState.selectedIdsRef.current.includes(r.id));
    if (selected.length === 0) {
      showToast("Select at least one region to build a sequence.", { icon: "⚠️", tone: "warning" });
      return;
    }
    const order = [...selected].sort((a, b) => a.start - b.start);
    sequenceOrderRef.current = order;
    setSequenceIndex(0);
    setSequenceActive(true);
    setLoopEnabledLocal(false);
    audioActions.setLoopEnabled(false);
    applySequenceStep(order[0]);
    if (isVideo) videoRef.current?.play().catch(() => {}); /* non-critical: autoplay policy rejection, no data loss */
    else audioActions.play();
    showToast(`Sequence started · ${order.length} region${order.length !== 1 ? "s" : ""}.`, { icon: "▶" });
    schedulePresetSave();
  };

  // Drives sequence advancement — fires on every currentTime update (seek or
  // playback), same pattern as the canvas render effect below.
  useEffect(() => {
    if (!sequenceActiveRef.current || dur <= 0) return;
    const order = sequenceOrderRef.current;
    const current = order[sequenceIndexRef.current];
    if (!current) return;
    const EPS = 0.05;
    if (currentTime < current.end - EPS) return;
    const nextIndex = sequenceIndexRef.current + 1;
    if (nextIndex < order.length) {
      setSequenceIndex(nextIndex);
      applySequenceStep(order[nextIndex]);
    } else if (sequenceLoopRef.current) {
      setSequenceIndex(0);
      applySequenceStep(order[0]);
    } else {
      stopSequence();
      if (isVideo) videoRef.current?.pause();
      else audioActions.pause();
      showToast("Sequence finished.", { icon: "🏁" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, dur]);

  // ── Auto tempo for checkbox-selected regions during normal playback ─────────
  // Distinct from sequence playback: this runs during ordinary playback/scrubbing
  // and doesn't jump the playhead — it just matches tempo to whichever selected
  // region (if any) currently contains the playhead, reverting to normal outside one.
  const autoTempoRegionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (sequenceActiveRef.current || dur <= 0) return;
    const t = currentTime;
    const match = regionState.regionsRef.current.find(r =>
      regionState.selectedIdsRef.current.includes(r.id) && t >= r.start && t < r.end
    );
    if (match) {
      if (autoTempoRegionIdRef.current !== match.id) {
        autoTempoRegionIdRef.current = match.id;
        applySpeed(match.playbackSpeed.toFixed(2));
        setLoopIncreaseByLocal(match.speedIncreasePercent);
        audioActions.setLoopIncreaseBy(match.speedIncreasePercent);
        setLoopIncreaseAtLocal(match.speedIncreaseInterval);
        audioActions.setLoopIncreaseAt(match.speedIncreaseInterval);
        regionState.setActiveRegionId(match.id);
      }
    } else if (autoTempoRegionIdRef.current !== null) {
      autoTempoRegionIdRef.current = null;
      applySpeed("1.00");
      regionState.setActiveRegionId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, dur]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Shortcut rebind mode
      if (shortcuts.pendingRebind !== null) {
        e.preventDefault();
        if (e.key === "Escape") {
          shortcuts.setPendingRebind(null);
          return;
        }
        const base = normalizeKey(e.key);
        const mods: string[] = [];
        if (e.ctrlKey) mods.push("Ctrl");
        if (e.metaKey) mods.push("Meta");
        if (e.altKey) mods.push("Alt");
        if (e.shiftKey) mods.push("Shift");
        const key = mods.length ? `${mods.join("+")}+${base}` : base;
        shortcuts.commitRebind(shortcuts.pendingRebind, key);
        shortcuts.setPendingRebind(null);
        return;
      }

      if (e.key === "Escape" && shortcuts.paletteOpen) {
        shortcuts.setPaletteOpen(false);
        return;
      }

      const target = e.target as HTMLElement;
      const isTyping =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && !["range", "checkbox"].includes(target.type)) ||
        target.isContentEditable;
      if (isTyping) return;
      if (shortcuts.paletteOpen) return;

      const base = normalizeKey(e.key);
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.metaKey) mods.push("Meta");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      const pressedKey = mods.length ? `${mods.join("+")}+${base}` : base;

      const bindings = shortcuts.bindingsRef.current;
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
        case "seekBackward": {
          if (dur <= 0) break;
          const t = Math.max(0, currentTime - SEEK_STEP);
          if (isVideo && videoRef.current) seekVideo(videoRef.current, t);
          else audioActions.seek(t);
          break;
        }
        case "seekForward": {
          if (dur <= 0) break;
          const t = Math.min(dur, currentTime + SEEK_STEP);
          if (isVideo && videoRef.current) seekVideo(videoRef.current, t);
          else audioActions.seek(t);
          break;
        }
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
        case "nudgeMarkerBack": markerState.nudgeSelected(-MARKER_NUDGE); break;
        case "nudgeMarkerForward": markerState.nudgeSelected(MARKER_NUDGE); break;
        case "addMarker": markerState.addMarkerFromCurrentTime(); break;
        case "prevMarker": markerState.jumpToMarker("prev"); break;
        case "nextMarker": markerState.jumpToMarker("next"); break;
        case "closePlayer": onClose(); break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts.pendingRebind, shortcuts.paletteOpen, shortcuts.bindingsRef, shortcuts.commitRebind, shortcuts.setPendingRebind, shortcuts.setPaletteOpen, loopEnabled, dur, speedInput, currentTime]);

  // ── Render ───────────────────────────────────────────────────────────────────

  const atNormalSpeed = Math.abs((parseFloat(speedInput) || 1) - 1) < 0.001;

  return (
    <div className="media-player" data-testid="media-player">
      {persistError && <ErrorModal error={persistError} onDismiss={() => setPersistError(null)} />}

      {/* Toasts */}
      <div className="mp-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`mp-toast mp-toast--${t.tone}`}>
            <span>{t.icon}</span> {t.message}
          </div>
        ))}
      </div>

      {/* Shortcut palette */}
      {shortcuts.paletteOpen && (
        <div className="mp-palette-backdrop" onClick={() => shortcuts.setPaletteOpen(false)}>
          <div className="mp-palette" onClick={e => e.stopPropagation()}>
            <div className="mp-palette-header">
              <span>Keyboard Shortcuts</span>
              <button className="btn-ghost btn-xs" onClick={shortcuts.resetToDefaults}>Reset defaults</button>
              <button className="btn-ghost btn-xs" onClick={() => shortcuts.setPaletteOpen(false)}>✕</button>
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
                      className={`mp-shortcut-key ${shortcuts.pendingRebind === id ? "is-recording" : ""}`}
                      onClick={() => shortcuts.setPendingRebind(id)}
                    >
                      {shortcuts.pendingRebind === id ? "Press a key…" : formatShortcutKey(shortcuts.bindings[id] ?? "")}
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
          <button className="btn-ghost btn-xs" onClick={() => shortcuts.setPaletteOpen(true)} title="Keyboard shortcuts">
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
            if (isVideo && videoRef.current) seekVideo(videoRef.current, t);
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
            if (isVideo && videoRef.current) seekVideo(videoRef.current, t);
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
          <div className="media-player__canvas-status">
            Failed to load file{audioState.errorMessage ? `: ${audioState.errorMessage}` : ""}
          </div>
        )}
      </div>

      {/* Markers — sits directly under the timeline */}
      <section className="mp-section mp-markers-bar">
        <div className="mp-section-header">
          <span className="mp-section-label">Markers</span>
          <span id="waveMarkerLabel" className="mp-marker-count">
            {markerState.markers.length} marker{markerState.markers.length !== 1 ? "s" : ""}
            {markerState.selectedIdx >= 0 ? ` · ${markerState.selectedIdx + 1}/${markerState.markers.length} selected` : ""}
          </span>
        </div>
        <div className="mp-row mp-row--wrap">
          <button className="btn-ghost btn-xs" id="waveAddMarkerBtn" onClick={markerState.addMarkerFromCurrentTime} title="Add marker at playhead">Add</button>
          <button className="btn-ghost btn-xs" id="wavePrevMarkerBtn" onClick={() => markerState.jumpToMarker("prev")} disabled={!markerState.markers.length} title="Previous marker">◀ Prev</button>
          <button className="btn-ghost btn-xs" id="waveNextMarkerBtn" onClick={() => markerState.jumpToMarker("next")} disabled={!markerState.markers.length} title="Next marker">Next ▶</button>
          <button className="btn-ghost btn-xs" id="waveDeleteMarkerBtn" onClick={markerState.deleteSelected} disabled={markerState.selectedIdx < 0} title="Delete selected marker">Delete</button>
          <button className="btn-ghost btn-xs" id="waveClearMarkersBtn" onClick={markerState.clearAll} disabled={!markerState.markers.length} title="Clear all markers">Clear all</button>
          {markerState.selectedIdx >= 0 && (
            <>
              <span className="mp-marker-sep">·</span>
              <label className="mp-pitch-label">Name</label>
              <input
                type="text"
                id="waveMarkerName"
                className="mp-marker-name-input"
                value={markerState.nameInput}
                placeholder="Marker name…"
                onChange={e => markerState.renameSelected(e.target.value)}
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
                    disabled={sequenceActive}
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
              <div className="media-player__loop-increase">
                <label className="media-player__checkbox-label">
                  <input
                    type="checkbox"
                    id="loopBreak"
                    checked={loopBreakEnabled}
                    onChange={e => {
                      setLoopBreakEnabledLocal(e.target.checked);
                      audioActions.setLoopBreakEnabled(e.target.checked);
                      schedulePresetSave();
                    }}
                  />
                  Break
                </label>
                <span>Pause</span>
                <input
                  type="number"
                  id="loopBreakDuration"
                  className="media-player__loop-num-input"
                  min="1" max="60"
                  value={loopBreakDuration}
                  disabled={!loopBreakEnabled}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 3;
                    setLoopBreakDurationLocal(v);
                    audioActions.setLoopBreakDuration(v);
                    schedulePresetSave();
                  }}
                  title="Seconds to pause"
                />
                <span>sec every</span>
                <input
                  type="number"
                  id="loopBreakAfter"
                  className="media-player__loop-num-input"
                  min="1" max="50"
                  value={loopBreakAfter}
                  disabled={!loopBreakEnabled}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 8;
                    setLoopBreakAfterLocal(v);
                    audioActions.setLoopBreakAfter(v);
                    schedulePresetSave();
                  }}
                  title="Loops between breaks"
                />
                <span>loops + count-in</span>
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
                {regionState.activeRegionId && (
                  <button
                    className="btn-ghost btn-xs"
                    onClick={() => regionState.setActiveRegionId(null)}
                    title="Deselect region"
                  >
                    Deselect
                  </button>
                )}
              </div>
              <div className="mp-row">
                <input
                  type="text"
                  id="regionNameInput"
                  className="mp-region-name-input"
                  placeholder="New region name…"
                  value={regionNameInput}
                  onChange={e => setRegionNameInput(e.target.value)}
                />
                <button className="btn-ghost btn-xs" id="addRegionBtn" onClick={saveRegion} title="Save current loop as a new region">Save Region</button>
                {regionState.activeRegionId && (
                  <button className="btn-ghost btn-xs" id="updateRegionBtn" onClick={updateActiveRegion} title="Update the applied region with the current loop bounds, name, and speed">Update Region</button>
                )}
              </div>
              {regionState.regions.length > 0 && (
                <ul id="regionList" className="mp-region-list">
                  {regionState.regions.map((region, idx) => {
                    const speedLabel = `${Math.round((region.playbackSpeed ?? 1) * 100)}%`;
                    const incStr = region.increaseEnabled && region.speedIncreasePercent > 0
                      ? ` · +${region.speedIncreasePercent}% every ${region.speedIncreaseInterval} loops`
                      : "";
                    const isEditing = editingRegionId === region.id;
                    return (
                      <li
                        key={region.id}
                        data-region-id={region.id}
                        className={`mp-region-item ${region.id === regionState.activeRegionId ? "is-active" : ""}`}
                        onClick={() => { if (!isEditing) applyRegion(region.id); }}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="mp-region-row">
                          <input
                            type="checkbox"
                            className="mp-region-select-checkbox"
                            checked={regionState.selectedIds.includes(region.id)}
                            onClick={e => e.stopPropagation()}
                            onChange={() => regionState.toggleSelected(region.id)}
                            title="Include in sequence"
                          />
                          {isEditing ? (
                            <input
                              className="mp-region-name-input"
                              value={editingRegionName}
                              autoFocus
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditingRegionName(e.target.value)}
                              onBlur={() => {
                                renameRegion(region.id, editingRegionName.trim() || region.name);
                                setEditingRegionId(null);
                              }}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  renameRegion(region.id, editingRegionName.trim() || region.name);
                                  setEditingRegionId(null);
                                } else if (e.key === "Escape") {
                                  setEditingRegionId(null);
                                }
                              }}
                            />
                          ) : (
                            <div className="mp-region-title">
                              {region.name || `Region ${idx + 1}`}
                            </div>
                          )}
                        </div>
                        <div className="mp-region-meta">
                          {formatTime(region.start)} → {formatTime(region.end)} · {speedLabel}{incStr}
                        </div>
                        <div className="mp-region-actions">
                          <button className="btn-ghost btn-xs" data-region-action="rename" onClick={(e) => {
                            e.stopPropagation();
                            setEditingRegionId(region.id);
                            setEditingRegionName(region.name ?? "");
                          }}>Rename</button>
                          <button className="btn-ghost btn-xs" data-region-action="delete" onClick={(e) => {
                            e.stopPropagation();
                            deleteRegion(region.id);
                          }}>Remove</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {regionState.regions.length === 0 && (
                <p id="regionEmptyState" className="mp-empty-state">
                  Save loop settings to start a region list.
                </p>
              )}
              {regionState.regions.length > 0 && (
                <div className="mp-row mp-row--wrap">
                  <button
                    className="btn-ghost btn-xs"
                    id="playSequenceBtn"
                    onClick={sequenceActive ? stopSequence : startSequence}
                    disabled={!sequenceActive && regionState.selectedIds.length === 0}
                    title="Play checked regions in order, applying each region's speed"
                  >
                    {sequenceActive ? "⏹ Stop Sequence" : "▶ Play Sequence"}
                  </button>
                  <label className="media-player__checkbox-label">
                    <input
                      type="checkbox"
                      id="sequenceLoopToggle"
                      checked={sequenceLoop}
                      disabled={sequenceActive}
                      onChange={e => {
                        setSequenceLoopLocal(e.target.checked);
                        schedulePresetSave();
                      }}
                    />
                    Loop sequence
                  </label>
                  {sequenceActive && (
                    <span id="sequenceStatus" className="mp-marker-count">
                      Playing {sequenceIndex + 1}/{sequenceOrderRef.current.length}
                      {sequenceOrderRef.current[sequenceIndex]?.name ? ` · ${sequenceOrderRef.current[sequenceIndex].name}` : ""}
                    </span>
                  )}
                </div>
              )}
            </section>

            {/* Metronome */}
            {!isVideo && (
              <section className="mp-section">
                <div className="mp-section-header">
                  <span className="mp-section-label">Metronome</span>
                  <span id="metronomeStatus" className="mp-metronome-status">
                    {metronome.enabled
                      ? `On · ${Math.round(metronome.bpm * (metronomeFollowSpeed ? (parseFloat(speedInput) || 1) : 1))} BPM`
                      : "Off"}
                  </span>
                </div>
                <div className="media-player__metronome-controls">
                  <input
                    type="number"
                    id="metronomeBpm"
                    className="media-player__bpm-input"
                    min="40" max="260"
                    value={metronome.bpm}
                    onChange={e => metronome.setBpm(Math.max(40, Math.min(260, parseInt(e.target.value) || 120)))}
                    title="BPM"
                  />
                  <span className="media-player__bpm-label">BPM</span>
                  <select
                    id="metronomeAccent"
                    className="media-player__timesig"
                    value={metronome.beats}
                    onChange={e => metronome.setBeats(parseInt(e.target.value))}
                    title="Accent beats"
                  >
                    <option value={2}>2/4</option>
                    <option value={3}>3/4</option>
                    <option value={4}>4/4</option>
                    <option value={6}>6/8</option>
                    <option value={0}>No accent</option>
                  </select>
                  <div
                    className={`media-player__beat-indicator ${metronome.beatFlash ? "is-flashing" : ""}`}
                    title="Beat"
                  />
                  <button className="btn-ghost btn-xs" onClick={metronome.handleTapTempo} title="Tap tempo">Tap</button>
                  <button
                    className={`btn-ghost ${metronome.enabled ? "is-active" : ""}`}
                    id="metronomeToggle"
                    onClick={metronome.toggle}
                  >
                    {metronome.enabled ? "Stop" : "Start"}
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
