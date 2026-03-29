import { useRef, useState, useEffect, useCallback } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

interface Props {
  onClose: () => void;
}

export function Metronome({ onClose }: Props) {
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(4);
  const [enabled, setEnabled] = useState(false);
  const [beatFlash, setBeatFlash] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextTimeRef = useRef(0);
  const beatIndexRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(false);
  const bpmRef = useRef(120);
  const beatsRef = useRef(4);
  const tapTimestampsRef = useRef<number[]>([]);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { beatsRef.current = beats; }, [beats]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    enabledRef.current = false;
    setEnabled(false);
  }, []);

  const start = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    ctxRef.current.resume();
    const ctx = ctxRef.current;

    if (timerRef.current !== null) clearInterval(timerRef.current);
    nextTimeRef.current = ctx.currentTime + 0.05;
    beatIndexRef.current = 0;
    enabledRef.current = true;
    setEnabled(true);

    timerRef.current = setInterval(() => {
      if (!enabledRef.current) return;
      const interval = 60 / bpmRef.current;
      const ahead = ctx.currentTime + 0.5;
      while (nextTimeRef.current < ahead) {
        const b = beatsRef.current;
        const accent = b > 0 ? beatIndexRef.current % b === 0 : false;
        scheduleClick(ctx, nextTimeRef.current, accent);
        // Visual flash scheduled to fire when the beat actually sounds
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

  const toggle = () => {
    if (enabled) stop();
    else start();
  };

  const handleTapTempo = () => {
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
  };

  // Restart if running when BPM or beats change
  useEffect(() => {
    if (enabled) { stop(); start(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, beats]);

  useEffect(() => {
    return () => {
      stop();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      ctxRef.current?.close().catch(() => {});
    };
  }, [stop]);

  return (
    <div className="metronome-panel" data-testid="metronome-panel">
      <div className="metronome-panel__header">
        <span className="metronome-panel__title">Metronome</span>
        <button className="btn-ghost" onClick={onClose} title="Close metronome">
          <XMarkIcon style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <div className="metronome-panel__controls">
        <div className="metronome-panel__bpm-group">
          <input
            type="number"
            className="metronome-panel__bpm-input"
            min="40"
            max="260"
            value={bpm}
            onChange={(e) => setBpm(Math.max(40, Math.min(260, parseInt(e.target.value) || 120)))}
            aria-label="BPM"
          />
          <span className="metronome-panel__bpm-label">BPM</span>
          <button className="btn-ghost btn-xs" onClick={handleTapTempo} title="Tap to set BPM">
            Tap
          </button>
        </div>

        <select
          className="metronome-panel__timesig"
          value={beats}
          onChange={(e) => setBeats(parseInt(e.target.value))}
          aria-label="Time signature"
        >
          <option value={2}>2/4</option>
          <option value={3}>3/4</option>
          <option value={4}>4/4</option>
          <option value={6}>6/8</option>
          <option value={0}>No accent</option>
        </select>

        <div
          className={`metronome-panel__beat-indicator ${beatFlash ? "is-flashing" : ""}`}
          aria-label="Beat indicator"
          aria-live="polite"
        />

        <button
          className={`btn-primary ${!enabled ? "" : "is-active"}`}
          onClick={toggle}
          title={enabled ? "Stop" : "Start"}
          style={{ minWidth: 64 }}
        >
          {enabled ? "Stop" : "Start"}
        </button>
      </div>
    </div>
  );
}
