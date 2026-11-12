// Draws a track as standard notation: a five-line staff above (or instead of) its tab, using
// the same beat positions so the cursor, loops and clicks line up with both.
//
// Guitar is written in the treble clef an octave above it sounds, bass in the bass clef an
// octave above it sounds (both as usual), and drums on a percussion staff. Accidentals are
// sharps; there is no key signature, so a sharp is shown the first time it is needed in a bar.

import { el } from "./svg";
import { beatTicks } from "./tabRender";
import type { TabBeat, TabMeasure, TabTrack } from "./types";

/** Space between staff lines. */
export const STD_LINE = 10;
const STEP = STD_LINE / 2;
/** Height of the five lines. */
export const STD_HEIGHT = STD_LINE * 4;
const STEM = 30;

export type Clef = "treble" | "bass" | "percussion";

export interface StdStaff {
  top: number;
  bottom: number;
  clef: Clef;
}

export function clefFor(track: TabTrack): Clef {
  return track.instrument === "drums" ? "percussion" : track.instrument === "bass" ? "bass" : "treble";
}

// Pitch class → letter (C D E F G A B = 0..6) and whether it is a sharp.
const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

/** Diatonic position (steps up from C0) and sharpness of a MIDI pitch. */
export function pitchPosition(midi: number): { pos: number; sharp: boolean } {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  return { pos: octave * 7 + LETTER[pc], sharp: SHARP[pc] };
}

// Position of the bottom line: E4 in the treble clef, G2 in the bass clef.
const BOTTOM_POS: Record<"treble" | "bass", number> = { treble: 4 * 7 + 2, bass: 2 * 7 + 4 };

/** Half-steps above the bottom line for a General MIDI drum sound, and how it is drawn. */
function drumPlace(midi: number): { h: number; glyph: "x" | "o" } {
  switch (midi) {
    case 35:
    case 36: return { h: 1, glyph: "o" };
    case 38:
    case 40: return { h: 5, glyph: "o" };
    case 37: return { h: 5, glyph: "x" };
    case 41:
    case 43: return { h: 3, glyph: "o" };
    case 45:
    case 47: return { h: 6, glyph: "o" };
    case 48:
    case 50: return { h: 7, glyph: "o" };
    case 42: return { h: 9, glyph: "x" };
    case 44: return { h: -1, glyph: "x" };
    case 46: return { h: 9, glyph: "o" };
    case 49:
    case 57: return { h: 10, glyph: "x" };
    case 51:
    case 59: return { h: 8, glyph: "x" };
    default: return { h: 5, glyph: "x" };
  }
}

interface Head {
  h: number; // half-steps above the bottom line
  sharp: boolean;
  pos: number;
  x: boolean; // drawn as an x
}

function heads(track: TabTrack, beat: TabBeat, clef: Clef, transpose: number): Head[] {
  const out: Head[] = [];
  for (const n of beat.notes) {
    if (clef === "percussion") {
      const p = drumPlace(n.fret);
      out.push({ h: p.h, sharp: false, pos: p.h, x: p.glyph === "x" });
    } else {
      // Written an octave above the sounding pitch.
      const { pos, sharp } = pitchPosition(track.strings[n.string - 1] + n.fret + transpose + 12);
      out.push({ h: pos - BOTTOM_POS[clef], sharp, pos, x: false });
    }
  }
  return out.sort((a, b) => a.h - b.h);
}

interface Item {
  cx: number;
  tick: number;
  beat: TabBeat;
  heads: Head[];
  up: boolean;
  /** x each head is drawn at (a second apart is set to the other side of the stem). */
  xs: number[];
}

/** Draws the clef and the five lines across a line of bars. */
export function drawStaffLines(svg: SVGElement, std: StdStaff, xFrom: number, xTo: number): void {
  const lines = el("g", { stroke: "var(--tab-strings)", "stroke-width": "1" });
  for (let i = 0; i < 5; i++) {
    const y = std.top + STD_LINE * i + 0.5;
    lines.appendChild(el("line", { x1: xFrom, x2: xTo, y1: y, y2: y }));
  }
  svg.appendChild(lines);
  const clef = el("g", { fill: "var(--tab-note)" });
  if (std.clef === "percussion") {
    clef.appendChild(el("rect", { x: xFrom + 6, y: std.top + 10, width: 3, height: 20, stroke: "none" }));
    clef.appendChild(el("rect", { x: xFrom + 12, y: std.top + 10, width: 3, height: 20, stroke: "none" }));
  } else if (std.clef === "treble") {
    clef.appendChild(el("text", { x: xFrom + 2, y: std.top + 34, "font-size": "42", "font-family": "'Apple Symbols','Noto Music','Segoe UI Symbol','Symbola',serif", stroke: "none" }, "\u{1D11E}"));
    clef.appendChild(el("text", { x: xFrom + 12, y: std.bottom + 14, "font-size": "9", "text-anchor": "middle", stroke: "none" }, "8"));
  } else {
    clef.appendChild(el("text", { x: xFrom + 2, y: std.top + 26, "font-size": "36", "font-family": "'Apple Symbols','Noto Music','Segoe UI Symbol','Symbola',serif", stroke: "none" }, "\u{1D122}"));
  }
  svg.appendChild(clef);
}

function yOf(std: StdStaff, h: number): number {
  return std.bottom - h * STEP + 0.5;
}

/** Draws one bar of a track in standard notation. `slotX` maps a tick in the bar to its x. */
export function drawStandardBar(
  g: SVGElement,
  std: StdStaff,
  track: TabTrack,
  measure: TabMeasure | undefined,
  slotX: Map<number, number>,
  groupTicks: number,
  transpose: number
): void {
  const items: Item[] = [];
  let tick = 0;
  const mid = 4; // the middle line, in half-steps above the bottom line
  for (const b of measure?.beats ?? []) {
    const cx = slotX.get(tick);
    if (cx != null) {
      const hs = heads(track, b, std.clef, transpose);
      const avg = hs.length ? hs.reduce((s, h) => s + h.h, 0) / hs.length : mid;
      items.push({ cx, tick, beat: b, heads: hs, up: avg < mid, xs: hs.map(() => cx) });
    }
    tick += beatTicks(b);
  }

  // Accidentals: a sharp is written the first time it's needed on a line or space in the bar, and
  // a natural when that spot was sharp and now isn't.
  const state = new Map<number, boolean>();
  const accidentals = el("g", { fill: "var(--tab-note)", "font-size": "14", "text-anchor": "middle", stroke: "none" });
  const body = el("g", { fill: "var(--tab-note)", stroke: "var(--tab-note)", "stroke-width": "1" });

  const drawGroup = (group: Item[]) => {
    if (!group.length) return;
    const up = group.reduce((s, it) => s + (it.up ? 1 : -1), 0) >= 0;
    const tops = group.map((it) => Math.max(...it.heads.map((h) => h.h)));
    const bottoms = group.map((it) => Math.min(...it.heads.map((h) => h.h)));
    // Every stem in a beamed group ends on one line.
    const yEnd = up ? yOf(std, Math.max(...tops)) - STEM : yOf(std, Math.min(...bottoms)) + STEM;
    for (const it of group) {
      const lo = yOf(std, Math.max(...it.heads.map((h) => h.h)));
      const hi = yOf(std, Math.min(...it.heads.map((h) => h.h)));
      const sx = up ? it.cx + 4.8 : it.cx - 4.8;
      body.appendChild(el("line", { x1: sx, x2: sx, y1: up ? hi : lo, y2: yEnd }));
    }
    if (group.length === 1) {
      const it = group[0];
      const sx = up ? it.cx + 4.8 : it.cx - 4.8;
      const flags = it.beat.dur >= 32 ? 3 : it.beat.dur >= 16 ? 2 : it.beat.dur >= 8 ? 1 : 0;
      for (let f = 0; f < flags; f++) {
        const fy = yEnd + (up ? f * 5 : -f * 5);
        body.appendChild(el("path", { d: up ? `M${sx} ${fy}c0 8 9 9 7 18` : `M${sx} ${fy}c0 -8 9 -9 7 -18`, fill: "none", "stroke-width": "1.6" }));
      }
      return;
    }
    const sxOf = (it: Item) => (up ? it.cx + 4.8 : it.cx - 4.8);
    const xa = sxOf(group[0]);
    const xb = sxOf(group[group.length - 1]);
    const dir = up ? 1 : -1;
    body.appendChild(el("rect", { x: xa, y: up ? yEnd : yEnd - 3, width: xb - xa + 1, height: 3, stroke: "none" }));
    group.forEach((it, i) => {
      if (it.beat.dur < 16) return;
      const next = group[i + 1];
      const prev = group[i - 1];
      const y2 = yEnd + dir * 5 - (up ? 0 : 3);
      if (next && next.beat.dur >= 16) body.appendChild(el("rect", { x: sxOf(it), y: y2, width: sxOf(next) - sxOf(it) + 1, height: 3, stroke: "none" }));
      else if (!prev || prev.beat.dur < 16) body.appendChild(el("rect", { x: prev ? sxOf(it) - 6 : sxOf(it), y: y2, width: 6, height: 3, stroke: "none" }));
    });
    const tup = group[0].beat.triplet ? 3 : group[0].beat.tuplet ? group[0].beat.tuplet[0] : 0;
    if (tup) {
      body.appendChild(el("text", { x: (xa + xb) / 2, y: up ? yEnd - 4 : yEnd + 12, "font-size": "10", "text-anchor": "middle", stroke: "none" }, String(tup)));
    }
  };

  let group: Item[] = [];
  let groupIndex = 0;
  const flush = () => {
    drawGroup(group);
    group = [];
  };
  for (const it of items) {
    const { beat } = it;
    const gi = Math.floor(it.tick / groupTicks);
    if (gi !== groupIndex) {
      flush();
      groupIndex = gi;
    }
    if (!it.heads.length) {
      flush();
      drawRestAt(body, it.cx, std.bottom - 2 * STD_LINE, beat.dur);
      continue;
    }
    // Seconds are drawn on opposite sides of the stem.
    for (let i = 1; i < it.heads.length; i++) {
      if (it.heads[i].h - it.heads[i - 1].h === 1 && it.xs[i - 1] === it.cx) it.xs[i] = it.cx + (it.up ? 9 : -9);
    }
    it.heads.forEach((h, i) => {
      const hx = it.xs[i];
      const hy = yOf(std, h.h);
      // Ledger lines.
      const ledgers: number[] = [];
      for (let l = -2; l >= h.h; l -= 2) ledgers.push(l);
      for (let l = 10; l <= h.h; l += 2) ledgers.push(l);
      for (const l of ledgers) body.appendChild(el("line", { x1: hx - 8, x2: hx + 8, y1: yOf(std, l), y2: yOf(std, l), stroke: "var(--tab-strings)" }));
      if (h.x) {
        body.appendChild(el("path", { d: `M${hx - 4} ${hy - 4}l8 8m0 -8l-8 8`, fill: "none", "stroke-width": "1.6" }));
      } else if (beat.dur <= 2) {
        body.appendChild(el("ellipse", { cx: hx, cy: hy, rx: 5.4, ry: 3.8, transform: `rotate(-20 ${hx} ${hy})`, fill: "none", "stroke-width": "1.6" }));
      } else {
        body.appendChild(el("ellipse", { cx: hx, cy: hy, rx: 5.4, ry: 3.8, transform: `rotate(-20 ${hx} ${hy})`, stroke: "none" }));
      }
      if (beat.dotted || beat.doubleDotted) {
        const dy = h.h % 2 === 0 ? hy - STEP : hy;
        body.appendChild(el("circle", { cx: hx + 9, cy: dy, r: 1.6, stroke: "none" }));
        if (beat.doubleDotted) body.appendChild(el("circle", { cx: hx + 13, cy: dy, r: 1.6, stroke: "none" }));
      }
      if (std.clef !== "percussion") {
        const was = state.get(h.pos) ?? false;
        if (h.sharp !== was) {
          accidentals.appendChild(el("text", { x: hx - 12, y: hy + 5 }, h.sharp ? "♯" : "♮"));
          state.set(h.pos, h.sharp);
        }
      }
    });
    if (beat.dur >= 2) {
      // Half notes and shorter have a stem; eighths and shorter are collected into beamed groups.
      if (beat.dur >= 8) group.push(it);
      else {
        flush();
        drawGroup([it]);
      }
    } else {
      flush();
    }
  }
  flush();
  g.appendChild(body);
  g.appendChild(accidentals);
}

function drawRestAt(g: SVGElement, x: number, yMid: number, dur: number): void {
  if (dur === 1) g.appendChild(el("rect", { x: x - 5, y: yMid - STD_LINE, width: 10, height: 4, stroke: "none" }));
  else if (dur === 2) g.appendChild(el("rect", { x: x - 5, y: yMid - 4, width: 10, height: 4, stroke: "none" }));
  else if (dur === 4) g.appendChild(el("path", { d: `M${x - 2} ${yMid - 10}l5 6-5 5 5 6`, fill: "none", "stroke-width": "1.8" }));
  else {
    const flags = dur >= 32 ? 3 : dur >= 16 ? 2 : 1;
    g.appendChild(el("path", { d: `M${x + 3} ${yMid - 8}L${x - 1} ${yMid + 8}`, fill: "none" }));
    for (let f = 0; f < flags; f++) g.appendChild(el("circle", { cx: x - 1 + f * 1.4, cy: yMid - 6 + f * 5, r: 2, stroke: "none" }));
  }
}
