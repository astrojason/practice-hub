import { useState } from "react";

/**
 * Per-item practice timers, keyed by a session item key (e.g. "song-12") or the
 * special open-session key. `now` drives elapsed-time recomputation on every
 * clock tick without the timer state itself changing.
 */
export function useSessionTimers(now: number) {
  // activeTimers: itemKey → Date.now() when the current run started
  const [activeTimers, setActiveTimers] = useState<Map<string, number>>(new Map());
  // pausedElapsed: itemKey → accumulated seconds (set on pause or stop-and-save)
  const [pausedElapsed, setPausedElapsed] = useState<Map<string, number>>(new Map());

  function getElapsed(itemKey: string): number {
    const base = pausedElapsed.get(itemKey) ?? 0;
    const startedAt = activeTimers.get(itemKey);
    return startedAt ? base + Math.max(0, Math.floor((now - startedAt) / 1000)) : base;
  }

  function startTimer(itemKey: string) {
    setActiveTimers((prev) => new Map(prev).set(itemKey, Date.now()));
  }

  function pauseTimer(itemKey: string) {
    const total = getElapsed(itemKey);
    setActiveTimers((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setPausedElapsed((prev) => new Map(prev).set(itemKey, total));
  }

  function clearTimer(itemKey: string) {
    setActiveTimers((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setPausedElapsed((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
  }

  return { activeTimers, pausedElapsed, getElapsed, startTimer, pauseTimer, clearTimer };
}
