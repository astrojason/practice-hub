import { useRef, useState, useCallback } from "react";
import type { PitchShifter } from "../../lib/soundtouch";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AudioEngineStatus = "idle" | "loading" | "ready" | "error";

export interface AudioEngineState {
  status: AudioEngineStatus;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  waveData: number[];
  speed: number;
  loopEnabled: boolean;
  loopStart: number | null;
  loopEnd: number | null;
  loopIncreaseEnabled: boolean;
  loopIncreaseBy: number;
  loopIncreaseAt: number;
  pitchSemitones: number;
  pitchCents: number;
  detectedBpm: number | null;
}

export interface AudioEngineActions {
  loadFile: (path: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setSpeed: (v: number) => void;
  setLoopStart: (v: number | null) => void;
  setLoopEnd: (v: number | null) => void;
  setLoopEnabled: (v: boolean) => void;
  setLoopIncreaseEnabled: (v: boolean) => void;
  setLoopIncreaseBy: (v: number) => void;
  setLoopIncreaseAt: (v: number) => void;
  setPitch: (semitones: number, cents: number) => void;
  setCountIn: (fn: (() => Promise<void>) | null) => void;
  destroy: () => void;
  getContext: () => AudioContext | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function assetUrl(path: string): string {
  return `http://127.0.0.1:17865/asset?path=${encodeURIComponent(path)}`;
}

function buildWaveData(buffer: AudioBuffer): number[] {
  const data = buffer.getChannelData(0);
  const samples = Math.min(data.length, 2400);
  const block = Math.max(1, Math.floor(data.length / samples));
  const amps: number[] = [];
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let j = 0; j < block; j++) {
      sum += Math.abs(data[i * block + j] || 0);
    }
    amps.push(sum / block);
  }
  const max = Math.max(...amps) || 1;
  return amps.map((a) => a / max);
}

function detectBpm(buffer: AudioBuffer): number | null {
  try {
    const channel = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const downsampleFactor = Math.max(1, Math.floor(sampleRate / 2000));
    const samples: number[] = [];
    for (let i = 0; i < channel.length; i += downsampleFactor) {
      samples.push(channel[i]);
      if (samples.length >= sampleRate * 15) break;
    }
    if (samples.length < 1000) return null;
    const minBpm = 60, maxBpm = 200;
    const minLag = Math.floor((60 / maxBpm) * 2000);
    const maxLag = Math.floor((60 / minBpm) * 2000);
    const correlations: { lag: number; corr: number }[] = [];
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < samples.length - lag; i++) {
        corr += samples[i] * samples[i + lag];
      }
      correlations.push({ lag, corr });
    }
    correlations.sort((a, b) => b.corr - a.corr);
    const best = correlations[0];
    if (!best || best.corr <= 0) return null;
    const bpm = 60 / (best.lag / 2000);
    if (!Number.isFinite(bpm)) return null;
    return Math.max(50, Math.min(220, Math.round(bpm)));
  } catch {
    return null;
  }
}

function pitchRatio(semitones: number, cents: number): number {
  return 2 ** (semitones / 12) * 2 ** (cents / 1200);
}

// ─── Engine state stored in a single ref ─────────────────────────────────────

interface EngineRef {
  ctx: AudioContext | null;
  buffer: AudioBuffer | null;
  shifter: InstanceType<typeof PitchShifter> | null;
  gain: GainNode | null;
  raf: number | null;
  isHandlingLoop: boolean;
  loopCount: number;
  duration: number;
  pendingSrc: string | null;
  _pausedAt: number;
  // Control values mirrored here for rAF access
  speed: number;
  loopEnabled: boolean;
  loopStart: number | null;
  loopEnd: number | null;
  loopIncreaseEnabled: boolean;
  loopIncreaseBy: number;
  loopIncreaseAt: number;
  pitchSemitones: number;
  pitchCents: number;
  countIn: (() => Promise<void>) | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAudioEngine(): [AudioEngineState, AudioEngineActions] {
  const e = useRef<EngineRef>({
    ctx: null,
    buffer: null,
    shifter: null,
    gain: null,
    raf: null,
    isHandlingLoop: false,
    loopCount: 0,
    duration: 0,
    pendingSrc: null,
    _pausedAt: 0,
    speed: 1.0,
    loopEnabled: true,
    loopStart: null,
    loopEnd: null,
    loopIncreaseEnabled: false,
    loopIncreaseBy: 5,
    loopIncreaseAt: 3,
    pitchSemitones: 0,
    pitchCents: 0,
    countIn: null,
  });

  const [status, setStatus] = useState<AudioEngineStatus>("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveData, setWaveData] = useState<number[]>([]);
  const [speed, _setSpeed] = useState(1.0);
  const [loopEnabled, _setLoopEnabled] = useState(true);
  const [loopStart, _setLoopStart] = useState<number | null>(null);
  const [loopEnd, _setLoopEnd] = useState<number | null>(null);
  const [loopIncreaseEnabled, _setLoopIncreaseEnabled] = useState(false);
  const [loopIncreaseBy, _setLoopIncreaseBy] = useState(5);
  const [loopIncreaseAt, _setLoopIncreaseAt] = useState(3);
  const [pitchSemitones, _setPitchSemitones] = useState(0);
  const [pitchCents, _setPitchCents] = useState(0);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);

  // ── Internal helpers ────────────────────────────────────────────────────────

  const stopEngine = useCallback((resetOffset = true) => {
    const eng = e.current;
    if (eng.raf !== null) {
      cancelAnimationFrame(eng.raf);
      eng.raf = null;
    }
    if (eng.shifter) {
      try { eng.shifter.disconnect(); } catch (_) {}
    }
    if (eng.gain) {
      try { eng.gain.disconnect(); } catch (_) {}
      eng.gain = null;
    }
    if (!resetOffset && eng.shifter && eng.duration > 0) {
      eng._pausedAt = (eng.shifter.percentagePlayed / 100) * eng.duration;
    } else if (resetOffset) {
      eng._pausedAt = 0;
    }
    setIsPlaying(false);
  }, []);

  const startEngine = useCallback(() => {
    const eng = e.current;
    if (!eng.ctx || !eng.buffer || !eng.shifter) return;

    if (eng.raf !== null) {
      cancelAnimationFrame(eng.raf);
      eng.raf = null;
    }
    if (eng.gain) {
      try { eng.gain.disconnect(); } catch (_) {}
    }

    const gain = eng.ctx.createGain();
    eng.shifter.tempo = eng.speed;
    eng.shifter.pitch = pitchRatio(eng.pitchSemitones, eng.pitchCents);
    eng.shifter.connect(gain);
    gain.connect(eng.ctx.destination);
    eng.gain = gain;

    if (eng.duration > 0) {
      eng.shifter.percentagePlayed = (eng._pausedAt / eng.duration) * 100;
    }

    eng.ctx.resume();
    setIsPlaying(true);
    setCurrentTime(eng._pausedAt);

    const tick = () => {
      const t = (eng.shifter!.percentagePlayed / 100) * eng.duration;
      setCurrentTime(t);

      if (eng.loopEnabled && !eng.isHandlingLoop && eng.duration > 0) {
        const end = eng.loopEnd ?? eng.duration;
        if (t >= end) {
          eng.isHandlingLoop = true;
          eng.loopCount++;

          const threshold = eng.loopIncreaseAt;
          if (eng.loopIncreaseEnabled && threshold > 0 && eng.loopCount >= threshold) {
            eng.loopCount = 0;
            const next = Math.min(3.0, eng.speed * (1 + eng.loopIncreaseBy / 100));
            eng.speed = next;
            _setSpeed(next);
          }

          const restartAt = eng.loopStart ?? 0;
          eng._pausedAt = restartAt;
          if (eng.raf !== null) { cancelAnimationFrame(eng.raf); eng.raf = null; }
          if (eng.gain) { try { eng.gain.disconnect(); } catch (_) {} eng.gain = null; }

          if (eng.countIn) {
            eng.countIn().then(() => {
              startEngine();
              eng.isHandlingLoop = false;
            });
          } else {
            Promise.resolve().then(() => {
              startEngine();
              eng.isHandlingLoop = false;
            });
          }
          return;
        }
      }

      eng.raf = requestAnimationFrame(tick);
    };

    eng.raf = requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Public actions ──────────────────────────────────────────────────────────

  const loadFile = useCallback(async (path: string) => {
    const eng = e.current;
    stopEngine(true);
    eng.pendingSrc = path;
    eng.isHandlingLoop = false;
    eng.loopCount = 0;
    eng._pausedAt = 0;

    setStatus("loading");
    setCurrentTime(0);
    setDuration(0);
    setWaveData([]);
    setDetectedBpm(null);

    if (!eng.ctx || eng.ctx.state === "closed") {
      eng.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }

    try {
      const response = await fetch(assetUrl(path), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      if (eng.pendingSrc !== path) return;

      const decoded = await eng.ctx.decodeAudioData(arrayBuffer.slice(0));
      if (eng.pendingSrc !== path) return;

      eng.buffer = decoded;
      eng.duration = decoded.duration;

      // BPM detection (async so we don't block)
      Promise.resolve().then(() => {
        const bpm = detectBpm(decoded);
        if (bpm) setDetectedBpm(bpm);
      });

      const { PitchShifter: PS } = await import("../../lib/soundtouch.js") as { PitchShifter: typeof PitchShifter };
      eng.shifter = new PS(eng.ctx, decoded, 4096, () => {
        if (eng.isHandlingLoop) return;
        if (eng.loopEnabled) {
          eng._pausedAt = eng.loopStart ?? 0;
          if (eng.countIn) {
            eng.countIn().then(() => startEngine());
          } else {
            Promise.resolve().then(() => startEngine());
          }
        } else {
          setIsPlaying(false);
          setCurrentTime(0);
          eng._pausedAt = 0;
        }
      });

      setDuration(decoded.duration);
      setWaveData(buildWaveData(decoded));
      setStatus("ready");

      const startAt = eng.loopStart ?? 0;
      eng._pausedAt = startAt;
      startEngine();
    } catch (err) {
      console.error("[useAudioEngine] loadFile failed:", err);
      setStatus("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopEngine]);

  const play = useCallback(() => { startEngine(); }, [startEngine]);
  const pause = useCallback(() => { stopEngine(false); }, [stopEngine]);

  const seek = useCallback((time: number) => {
    const eng = e.current;
    const clamped = Math.max(0, Math.min(eng.duration, time));
    eng._pausedAt = clamped;
    if (eng.raf !== null) {
      if (eng.gain) { try { eng.gain.disconnect(); } catch (_) {} eng.gain = null; }
      cancelAnimationFrame(eng.raf);
      eng.raf = null;
      startEngine();
    } else {
      setCurrentTime(clamped);
    }
  }, [startEngine]);

  const setSpeed = useCallback((v: number) => {
    const eng = e.current;
    eng.speed = v;
    _setSpeed(v);
    if (eng.shifter) eng.shifter.tempo = v;
  }, []);

  const setLoopStart = useCallback((v: number | null) => { e.current.loopStart = v; _setLoopStart(v); }, []);
  const setLoopEnd = useCallback((v: number | null) => { e.current.loopEnd = v; _setLoopEnd(v); }, []);
  const setLoopEnabled = useCallback((v: boolean) => { e.current.loopEnabled = v; _setLoopEnabled(v); }, []);
  const setLoopIncreaseEnabled = useCallback((v: boolean) => { e.current.loopIncreaseEnabled = v; _setLoopIncreaseEnabled(v); }, []);
  const setLoopIncreaseBy = useCallback((v: number) => { e.current.loopIncreaseBy = v; _setLoopIncreaseBy(v); }, []);
  const setLoopIncreaseAt = useCallback((v: number) => { e.current.loopIncreaseAt = v; _setLoopIncreaseAt(v); }, []);

  const setPitch = useCallback((semitones: number, cents: number) => {
    const eng = e.current;
    eng.pitchSemitones = semitones;
    eng.pitchCents = cents;
    _setPitchSemitones(semitones);
    _setPitchCents(cents);
    if (eng.shifter) {
      eng.shifter.pitch = pitchRatio(semitones, cents);
    }
  }, []);

  const setCountIn = useCallback((fn: (() => Promise<void>) | null) => {
    e.current.countIn = fn;
  }, []);

  const destroy = useCallback(() => {
    stopEngine(true);
    const eng = e.current;
    if (eng.ctx) { eng.ctx.close().catch(() => {}); eng.ctx = null; }
    eng.buffer = null;
    eng.shifter = null;
    setStatus("idle");
    setCurrentTime(0);
    setDuration(0);
    setWaveData([]);
  }, [stopEngine]);

  const getContext = useCallback((): AudioContext | null => e.current.ctx, []);

  // ── Assemble ────────────────────────────────────────────────────────────────

  const state: AudioEngineState = {
    status, isPlaying, currentTime, duration, waveData,
    speed, loopEnabled, loopStart, loopEnd,
    loopIncreaseEnabled, loopIncreaseBy, loopIncreaseAt,
    pitchSemitones, pitchCents, detectedBpm,
  };

  const actions: AudioEngineActions = {
    loadFile, play, pause, seek, setSpeed,
    setLoopStart, setLoopEnd, setLoopEnabled,
    setLoopIncreaseEnabled, setLoopIncreaseBy, setLoopIncreaseAt,
    setPitch, setCountIn, destroy, getContext,
  };

  return [state, actions];
}
