// Converts between ticks (960 to a quarter note) and seconds of the song as written,
// following its tempo changes, including gradual ones.

import { barStarts, type BarTiming } from "./tabRender";
import type { TabSong } from "./types";

const TPQ = 960;

interface Seg {
  tick0: number;
  tick1: number;
  bpm0: number;
  bpm1: number;
  sec0: number;
  sec1: number;
}

export interface SongClock {
  timing: BarTiming;
  secAt(tick: number): number;
  tickAt(sec: number): number;
}

export function songClock(song: TabSong): SongClock {
  const timing = barStarts(song);
  const points: { tick: number; bpm: number; linear: boolean }[] = [];
  for (const c of song.tempoMap ?? []) {
    const bar = Math.min(c.bar, timing.starts.length - 1);
    if (bar < 0) continue;
    points.push({ tick: timing.starts[bar] + c.position * timing.lengths[bar], bpm: c.bpm, linear: Boolean(c.linear) });
  }
  points.sort((a, b) => a.tick - b.tick);
  if (!points.length || points[0].tick > 0) points.unshift({ tick: 0, bpm: song.tempo, linear: false });

  function segSeconds(seg: Seg, x: number): number {
    const len = seg.tick1 - seg.tick0;
    if (seg.bpm1 === seg.bpm0 || !Number.isFinite(len)) return (x * 60) / (TPQ * seg.bpm0);
    const k = (seg.bpm1 - seg.bpm0) / len;
    return (60 / (TPQ * k)) * Math.log((seg.bpm0 + k * x) / seg.bpm0);
  }

  function segTicks(seg: Seg, s: number): number {
    const len = seg.tick1 - seg.tick0;
    if (seg.bpm1 === seg.bpm0 || !Number.isFinite(len)) return (s * TPQ * seg.bpm0) / 60;
    const k = (seg.bpm1 - seg.bpm0) / len;
    return (seg.bpm0 * (Math.exp((s * TPQ * k) / 60) - 1)) / k;
  }

  const segs: Seg[] = [];
  let sec = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    const tick1 = next ? next.tick : Infinity;
    const bpm1 = next && p.linear ? next.bpm : p.bpm;
    const seg: Seg = { tick0: p.tick, tick1, bpm0: p.bpm, bpm1, sec0: sec, sec1: Infinity };
    if (next) sec += segSeconds(seg, tick1 - p.tick);
    seg.sec1 = next ? sec : Infinity;
    segs.push(seg);
  }

  function find(key: "tick0" | "sec0", value: number): Seg {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid][key] <= value) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  }

  return {
    timing,
    secAt(tick) {
      if (tick <= 0) return (tick * 60) / (TPQ * segs[0].bpm0);
      const seg = find("tick0", tick);
      return seg.sec0 + segSeconds(seg, tick - seg.tick0);
    },
    tickAt(s) {
      if (s <= 0) return (s * TPQ * segs[0].bpm0) / 60;
      const seg = find("sec0", s);
      return seg.tick0 + segTicks(seg, s - seg.sec0);
    },
  };
}
