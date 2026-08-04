import { useCallback, useEffect, useRef, useState } from "react";

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

function newAudioContext(): AudioContext {
  return new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
}

interface Options {
  /** Share an existing AudioContext (e.g. from an audio engine already playing) instead of owning one. */
  getAudioContext?: () => AudioContext | null;
  /** Multiplies the effective BPM — e.g. MediaPlayer's "follow speed" option. Defaults to 1.0. */
  speedMultiplier?: () => number;
  /**
   * Restart the click loop (resetting to the downbeat) immediately when bpm/beats
   * change while running, rather than letting the new tempo phase in gradually as
   * already-scheduled near-future clicks finish. The standalone Metronome panel
   * wants the immediate reset; MediaPlayer's inline metronome doesn't. Default false.
   */
  restartOnChange?: boolean;
}

/**
 * Click-scheduling metronome engine — click audio, tap tempo, beat-flash, and
 * an optional count-in — shared by the standalone Metronome panel and the
 * metronome built into MediaPlayer. Each caller controls its own AudioContext
 * strategy: MediaPlayer shares the one already playing audio via
 * `getAudioContext`; the standalone panel omits it and gets its own.
 */
export function useMetronomeEngine(options: Options = {}) {
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(4);
  const [enabled, setEnabled] = useState(false);
  const [beatFlash, setBeatFlash] = useState(false);

  const ownCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextTimeRef = useRef(0);
  const beatIndexRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(false);
  const bpmRef = useRef(120);
  const beatsRef = useRef(4);
  const tapTimestampsRef = useRef<number[]>([]);

  const getAudioContextRef = useRef(options.getAudioContext);
  const speedMultiplierRef = useRef(options.speedMultiplier);
  useEffect(() => { getAudioContextRef.current = options.getAudioContext; }, [options.getAudioContext]);
  useEffect(() => { speedMultiplierRef.current = options.speedMultiplier; }, [options.speedMultiplier]);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { beatsRef.current = beats; }, [beats]);

  function resolveContext(): AudioContext {
    const shared = getAudioContextRef.current?.();
    if (shared && shared.state !== "closed") return shared;
    if (getAudioContextRef.current) return newAudioContext();
    if (!ownCtxRef.current || ownCtxRef.current.state === "closed") {
      ownCtxRef.current = newAudioContext();
    }
    return ownCtxRef.current;
  }

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    enabledRef.current = false;
    setEnabled(false);
  }, []);

  const start = useCallback(() => {
    const ctx = resolveContext();
    ctx.resume();

    if (timerRef.current !== null) clearInterval(timerRef.current);
    nextTimeRef.current = ctx.currentTime + 0.05;
    beatIndexRef.current = 0;
    enabledRef.current = true;
    setEnabled(true);

    timerRef.current = setInterval(() => {
      if (!enabledRef.current) return;
      const speed = speedMultiplierRef.current ? speedMultiplierRef.current() : 1.0;
      const effectiveBpm = bpmRef.current * speed;
      const interval = 60 / effectiveBpm;
      const ahead = ctx.currentTime + 0.5;
      while (nextTimeRef.current < ahead) {
        const b = beatsRef.current;
        const accent = b > 0 ? beatIndexRef.current % b === 0 : false;
        scheduleClick(ctx, nextTimeRef.current, accent);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        const delay = Math.max(0, (nextTimeRef.current - ctx.currentTime) * 1000);
        flashTimerRef.current = setTimeout(() => {
          setBeatFlash(true);
          setTimeout(() => setBeatFlash(false), 80);
        }, delay);
        nextTimeRef.current += interval;
        beatIndexRef.current++;
      }
    }, 100);
  }, []);

  const toggle = useCallback(() => {
    if (enabledRef.current) stop();
    else start();
  }, [start, stop]);

  const handleTapTempo = useCallback(() => {
    const now = Date.now();
    const taps = tapTimestampsRef.current;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const next = Math.max(40, Math.min(260, Math.round(60000 / avg)));
      setBpm(next);
    }
  }, []);

  /** Plays `beats` clicks at the current BPM and resolves once they've finished. */
  const performCountIn = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const ctx = resolveContext();
      ctx.resume();
      const beatCount = beatsRef.current || 4;
      const speed = speedMultiplierRef.current ? speedMultiplierRef.current() : 1.0;
      const effectiveBpm = bpmRef.current * speed;
      const interval = 60 / effectiveBpm;
      const startTime = ctx.currentTime + 0.05;
      for (let i = 0; i < beatCount; i++) {
        scheduleClick(ctx, startTime + i * interval, i === 0);
      }
      const waitMs = (beatCount * interval * 1000) | 0;
      setTimeout(resolve, waitMs);
    });
  }, []);

  // Restart immediately on bpm/beats change while running, if requested.
  useEffect(() => {
    if (options.restartOnChange && enabledRef.current) { stop(); start(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, beats]);

  useEffect(() => {
    return () => {
      stop();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      ownCtxRef.current?.close().catch(() => {}); /* non-critical: context already closed */
    };
  }, [stop]);

  /** Directly set the ref used by the running interval, for immediate effect without waiting a render. */
  const setBpmImmediate = useCallback((value: number) => {
    bpmRef.current = value;
    setBpm(value);
  }, []);

  return {
    bpm, setBpm,
    beats, setBeats,
    enabled,
    beatFlash,
    start, stop, toggle,
    handleTapTempo,
    performCountIn,
    setBpmImmediate,
  };
}
