// Draws tracks as lines of tablature (SVG), and keeps where every bar and beat landed so the
// player can move its cursor and clicks can find a bar. Ported from the Tabline app.

import type { TabBeat, TabSong } from "./types";

export const WHOLE = 3840;
const NS = "http://www.w3.org/2000/svg";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (midi: number) => NOTE_NAMES[((midi % 12) + 12) % 12];

const drumGlyph = (n: { string: number; fret: number }) => (n.fret === 46 ? "o" : n.string <= 2 ? "x" : "o");

export function beatTicks(b: TabBeat): number {
  let t = WHOLE / b.dur;
  if (b.doubleDotted) t = (t * 7) / 4;
  else if (b.dotted) t = (t * 3) / 2;
  if (b.triplet) t = (t * 2) / 3;
  if (b.tuplet && b.tuplet[0] > 0) t = (t * b.tuplet[1]) / b.tuplet[0];
  return t;
}

export interface BarTiming {
  starts: number[];
  lengths: number[];
  total: number;
}

/** Where every bar starts (ticks), honouring time-signature changes. */
export function barStarts(song: TabSong): BarTiming {
  const starts: number[] = [];
  const lengths: number[] = [];
  let t = 0;
  for (const m of song.tracks[0].measures) {
    const [n, d] = m.time || song.time;
    const len = (n * WHOLE) / d;
    starts.push(t);
    lengths.push(len);
    t += len;
  }
  return { starts, lengths, total: t };
}

/** The bar a tick falls in. */
export function barAt(timing: BarTiming, tick: number): number {
  const s = timing.starts;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid] <= tick) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Ticks of the beat grouping used for beams: a dotted quarter in compound time, else a quarter. */
function beamGroupTicks(song: TabSong): number {
  const [n, d] = song.time;
  if (d === 8 && n % 3 === 0 && n > 3) return 1440;
  if (d === 8) return 480 * 2;
  return 960;
}

// Horizontal room each note value asks for.
function beatWidth(b: TabBeat): number {
  const base = ({ 1: 74, 2: 60, 4: 50, 8: 46, 16: 30, 32: 22 } as Record<number, number>)[b.dur] || 40;
  return b.dotted ? base * 1.15 : b.triplet ? base * 0.8 : base;
}

const GEO = {
  top: 48, // y of string 1
  gap: 12, // between strings
  below: 50, // rhythm area below the last string
  lineGap: 24, // between lines
  gutter: 22, // string names at the start of a line
  barPad: 16, // room at the start of each bar
};

type Attrs = Record<string, string | number>;

// Colours given as CSS variables go into style, so light and dark themes both apply.
function el(name: string, attrs: Attrs = {}, text?: string): SVGElement {
  const e = document.createElementNS(NS, name);
  let style = "";
  for (const [k, v] of Object.entries(attrs)) {
    if ((k === "fill" || k === "stroke") && typeof v === "string" && v.startsWith("var(")) style += `${k}:${v};`;
    else e.setAttribute(k, String(v));
  }
  if (style) e.setAttribute("style", style);
  if (text != null) e.textContent = text;
  return e;
}

export interface RenderOptions {
  width?: number;
  transpose?: number;
  /** Bars (inclusive) to highlight as the practice loop. */
  loop?: [number, number] | null;
  /** The track named in the multi-track label as the current one. */
  currentTrack?: number;
}

export interface BarLayout {
  line: number;
  x0: number;
  x1: number;
  beats: { x: number; tick: number; beat: number }[];
  ticks: number;
}

export interface TabLayout {
  lines: { el: HTMLDivElement; svg: SVGElement; height: number }[];
  bars: BarLayout[];
  cursor: HTMLDivElement;
  geo: { cursorTop: number; cursorBottom: number };
}

interface Row {
  b: TabBeat;
  cx: number;
  tick: number;
}

/**
 * Lays out and draws the tracks `trackIndices` into `host`, one staff under another on each
 * line, with notes that sound together lined up.
 */
export function renderTracks(host: HTMLElement, song: TabSong, trackIndices: number[], opts: RenderOptions = {}): TabLayout {
  const tracks = trackIndices.map((i) => song.tracks[i]);
  const multi = tracks.length > 1;
  const width = Math.max(260, Math.floor(opts.width || host.clientWidth || 800));
  const transpose = opts.transpose || 0;
  const timing = barStarts(song);
  const groupTicks = beamGroupTicks(song);

  // Where each staff sits on a line.
  const staves: { track: (typeof tracks)[number]; index: number; top: number; bottom: number; isDrums: boolean }[] = [];
  let y = multi ? 64 : GEO.top;
  tracks.forEach((track, k) => {
    if (k > 0) y += GEO.below + 30;
    const top = y;
    const bottom = top + GEO.gap * (track.strings.length - 1);
    staves.push({ track, index: trackIndices[k], top, bottom, isDrums: track.instrument === "drums" });
    y = bottom;
  });
  const lineHeight = y + GEO.below;
  const first = staves[0];
  const last = staves[staves.length - 1];

  // Each bar's time slots: every moment a beat starts in any shown track, given the room of
  // the shortest beat starting there.
  const barSlots = tracks[0].measures.map((_, mi) => {
    const slots = new Map<number, number>();
    tracks.forEach((t) => {
      let tick = 0;
      for (const b of t.measures[mi]?.beats ?? []) {
        const w = beatWidth(b);
        slots.set(tick, Math.min(slots.get(tick) ?? Infinity, w));
        tick += beatTicks(b);
      }
    });
    return [...slots.entries()].sort((p, q) => p[0] - q[0]).map(([tick, w]) => ({ tick, w }));
  });
  const minWidths = barSlots.map((slots) => GEO.barPad + slots.reduce((sum, sl) => sum + sl.w, 0) + 8);

  // 1. Pack bars into lines.
  const lines: number[][] = [];
  let cur: number[] = [];
  let used = GEO.gutter;
  minWidths.forEach((w, i) => {
    if (cur.length && used + w > width) {
      lines.push(cur);
      cur = [];
      used = GEO.gutter;
    }
    cur.push(i);
    used += w;
  });
  if (cur.length) lines.push(cur);

  host.replaceChildren();
  const bars: BarLayout[] = [];
  const lineEls: TabLayout["lines"] = [];
  lines.forEach((barIdx, li) => {
    const isLast = li === lines.length - 1;
    const total = barIdx.reduce((sum, i) => sum + minWidths[i], 0);
    // The last line only stretches when it is nearly full.
    const avail = width - GEO.gutter;
    const scale = isLast && total < avail * 0.7 ? 1 : avail / total;
    const lineW = isLast && scale === 1 ? GEO.gutter + total : width;

    const wrap = document.createElement("div");
    wrap.className = "tab-line";
    wrap.dataset.line = String(li);
    wrap.style.height = `${lineHeight + GEO.lineGap}px`;
    const svg = el("svg", { width: lineW, height: lineHeight, viewBox: `0 0 ${lineW} ${lineHeight}` });
    const loopG = el("g");
    svg.appendChild(loopG);

    // Staves: string names, strings and, with several tracks, each track's name.
    for (const st of staves) {
      const names = el("g", { "font-size": "9", fill: "var(--tab-text)", "text-anchor": "middle" });
      st.track.strings.forEach((p, sIdx) => {
        const label = st.isDrums ? ["C", "H", "S", "T", "K"][sIdx] || "" : noteName(p);
        names.appendChild(el("text", { x: 8, y: st.top + GEO.gap * sIdx + 3 }, label));
      });
      svg.appendChild(names);
      const stringsG = el("g", { stroke: "var(--tab-strings)", "stroke-width": "1" });
      for (let sIdx = 0; sIdx < st.track.strings.length; sIdx++) {
        const yy = st.top + GEO.gap * sIdx + 0.5;
        stringsG.appendChild(el("line", { x1: GEO.gutter - 6, x2: lineW, y1: yy, y2: yy }));
      }
      svg.appendChild(stringsG);
      if (multi) {
        const current = st.index === opts.currentTrack;
        svg.appendChild(
          el(
            "text",
            {
              x: GEO.gutter + 2,
              y: st === first ? 28 : st.top - 14,
              "font-size": "10",
              "font-weight": current ? "700" : "500",
              fill: current ? "var(--accent)" : "var(--tab-marker)",
            },
            st.track.name
          )
        );
      }
    }
    if (multi) {
      svg.appendChild(el("line", { x1: GEO.gutter - 6.5, x2: GEO.gutter - 6.5, y1: first.top, y2: last.bottom + 1, stroke: "var(--tab-measure)", "stroke-width": "2" }));
    }

    const notesG = el("g", { "font-size": "13", "text-anchor": "middle", fill: "var(--tab-note)" });
    const rhythmG = el("g", { stroke: "var(--tab-rhythm)", "stroke-width": "1.2", fill: "var(--tab-rhythm)" });
    const topG = el("g");
    const hitG = el("g");

    let x = GEO.gutter;
    barIdx.forEach((mi) => {
      const w = minWidths[mi] * scale;
      const x0 = x;
      const x1 = x + w;
      const m0 = tracks[0].measures[mi];
      for (const st of staves) {
        svg.appendChild(el("line", { x1: x0 + 0.5, x2: x0 + 0.5, y1: st.top, y2: st.bottom + 1, stroke: "var(--tab-measure)", "stroke-width": "1" }));
      }
      topG.appendChild(el("text", { x: x0 + 3, y: first.top - 6, "font-size": "10", fill: "var(--tab-text)" }, String(mi + 1)));
      if (m0.marker) {
        topG.appendChild(el("text", { x: x0 + 3, y: 12, "font-size": "12", "font-weight": "600", fill: "var(--tab-marker)" }, m0.marker));
      }
      if (opts.loop && mi >= opts.loop[0] && mi <= opts.loop[1]) {
        loopG.appendChild(el("rect", { class: "tab-loop-range", x: x0, y: first.top - 18, width: w, height: last.bottom - first.top + 36 }));
      }

      // x of every time slot in this bar.
      const slotX = new Map<number, number>();
      let bx = x0 + GEO.barPad * scale;
      for (const sl of barSlots[mi]) {
        const sw = sl.w * scale;
        slotX.set(sl.tick, bx + Math.min(sw / 2, 14 * scale + 6));
        bx += sw;
      }

      const primaryBeatAt = new Map<number, number>();
      staves.forEach((st, k) => {
        const m = st.track.measures[mi];
        let tick = 0;
        const beatRows: Row[] = [];
        (m?.beats ?? []).forEach((b, bi) => {
          const cx = slotX.get(tick) as number;
          if (k === 0) primaryBeatAt.set(tick, bi);
          beatRows.push({ b, cx, tick });
          if (b.chord && k === 0) {
            topG.appendChild(el("text", { x: cx - 4, y: first.top - 20, "font-size": "13", fill: "var(--tab-chord)" }, b.chord));
          }
          for (const n of b.notes) {
            const ny = st.top + GEO.gap * (n.string - 1);
            let label: string;
            if (st.isDrums) label = drumGlyph(n);
            else {
              let f = n.fret + transpose;
              while (f < 0) f += 12;
              label = n.tie ? `(${f})` : String(f);
            }
            const tw = label.length > 1 ? 6 * label.length + 3 : 9;
            notesG.appendChild(el("rect", { x: cx - tw / 2 - 1, y: ny - 7, width: tw + 2, height: 13, fill: "var(--tab-bg)" }));
            notesG.appendChild(el("text", n.tie ? { x: cx, y: ny + 4.5, fill: "var(--tab-chord)", "font-size": "11" } : { x: cx, y: ny + 4.5 }, label));
          }
          tick += beatTicks(b);
        });
        drawRhythm(rhythmG, beatRows, st.bottom, groupTicks);
        // Clicks on a staff know which track was clicked.
        const hTop = k === 0 ? 0 : st.top - 22;
        const hBottom = k === staves.length - 1 ? lineHeight : staves[k + 1].top - 22;
        hitG.appendChild(el("rect", { class: "tab-bar-hit", x: x0, y: hTop, width: w, height: hBottom - hTop, "data-bar": mi, "data-track": st.index }));
      });

      const t0m = tracks[0].measures;
      if (m0.time && (mi === 0 || JSON.stringify(m0.time) !== JSON.stringify(t0m[mi - 1].time || song.time))) {
        topG.appendChild(el("text", { x: x0 + 3, y: last.bottom + 46, "font-size": "11", "font-weight": "600", fill: "var(--tab-marker)" }, `${m0.time[0]}/${m0.time[1]}`));
      } else if (!m0.time && mi > 0 && t0m[mi - 1].time) {
        topG.appendChild(el("text", { x: x0 + 3, y: last.bottom + 46, "font-size": "11", "font-weight": "600", fill: "var(--tab-marker)" }, `${song.time[0]}/${song.time[1]}`));
      }
      const beats = barSlots[mi].map((sl) => ({ x: slotX.get(sl.tick) as number, tick: sl.tick, beat: primaryBeatAt.has(sl.tick) ? (primaryBeatAt.get(sl.tick) as number) : -1 }));
      bars[mi] = { line: li, x0, x1, beats, ticks: timing.lengths[mi] };
      x = x1;
    });
    // Closing bar lines; double ones at the end of the song.
    const endX = x;
    for (const st of staves) {
      if (isLast) {
        svg.appendChild(el("line", { x1: endX - 4, x2: endX - 4, y1: st.top, y2: st.bottom + 1, stroke: "var(--tab-measure-end)", "stroke-width": "1" }));
        svg.appendChild(el("line", { x1: endX - 1.5, x2: endX - 1.5, y1: st.top, y2: st.bottom + 1, stroke: "var(--tab-measure-end)", "stroke-width": "3" }));
      } else {
        svg.appendChild(el("line", { x1: endX - 0.5, x2: endX - 0.5, y1: st.top, y2: st.bottom + 1, stroke: "var(--tab-measure)", "stroke-width": "1" }));
      }
    }

    svg.appendChild(notesG);
    svg.appendChild(rhythmG);
    svg.appendChild(topG);
    svg.appendChild(hitG);
    wrap.appendChild(svg);
    host.appendChild(wrap);
    lineEls.push({ el: wrap, svg, height: lineHeight });
  });

  const cursor = document.createElement("div");
  cursor.className = "tab-cursor";
  host.appendChild(cursor);

  return {
    lines: lineEls,
    bars,
    cursor,
    geo: { cursorTop: first.top, cursorBottom: last.bottom },
  };
}

function drawRhythm(g: SVGElement, rows: Row[], staffBottom: number, groupTicks: number): void {
  const y0 = staffBottom + 10;
  const yStem = staffBottom + 36;
  // Group beamed notes (eighths and shorter) inside the same beat group.
  let group: Row[] = [];
  const flush = () => {
    if (group.length === 1) {
      const r = group[0];
      g.appendChild(el("line", { x1: r.cx, x2: r.cx, y1: y0, y2: yStem }));
      const flags = r.b.dur >= 32 ? 3 : r.b.dur >= 16 ? 2 : 1;
      for (let f = 0; f < flags; f++) {
        g.appendChild(el("path", { d: `M${r.cx} ${yStem - f * 5}l7 -6`, fill: "none" }));
      }
    } else if (group.length > 1) {
      const xa = group[0].cx;
      const xb = group[group.length - 1].cx;
      for (const r of group) g.appendChild(el("line", { x1: r.cx, x2: r.cx, y1: y0, y2: yStem }));
      g.appendChild(el("rect", { x: xa, y: yStem - 3, width: xb - xa + 1, height: 3, stroke: "none" }));
      // Second beam for sixteenths: between neighbouring sixteenths, or a stub.
      group.forEach((r, i) => {
        if (r.b.dur < 16) return;
        const next = group[i + 1];
        const prev = group[i - 1];
        if (next && next.b.dur >= 16) g.appendChild(el("rect", { x: r.cx, y: yStem - 8, width: next.cx - r.cx + 1, height: 3, stroke: "none" }));
        else if (!prev || prev.b.dur < 16) g.appendChild(el("rect", { x: r.cx, y: yStem - 8, width: 6, height: 3, stroke: "none" }));
      });
      const tup = group[0].b.triplet ? 3 : group[0].b.tuplet ? group[0].b.tuplet[0] : 0;
      if (tup) {
        g.appendChild(el("text", { x: (xa + xb) / 2, y: yStem + 11, "font-size": "10", "text-anchor": "middle", stroke: "none" }, String(tup)));
      }
    }
    group = [];
  };
  let groupStart = 0;
  for (const r of rows) {
    const gi = Math.floor(r.tick / groupTicks);
    if (gi !== groupStart) {
      flush();
      groupStart = gi;
    }
    const b = r.b;
    if (!b.notes.length) {
      flush();
      drawRest(g, r.cx, staffBottom, b.dur);
    } else if (b.dur >= 8) {
      group.push(r);
    } else {
      flush();
      if (b.dur === 2) g.appendChild(el("line", { x1: r.cx, x2: r.cx, y1: y0 + 12, y2: yStem }));
      else if (b.dur === 4) g.appendChild(el("line", { x1: r.cx, x2: r.cx, y1: y0, y2: yStem }));
    }
    if (b.dotted || b.doubleDotted) g.appendChild(el("circle", { cx: r.cx + 5, cy: yStem - 2, r: 1.5, stroke: "none" }));
    if (b.doubleDotted) g.appendChild(el("circle", { cx: r.cx + 9, cy: yStem - 2, r: 1.5, stroke: "none" }));
  }
  flush();
}

function drawRest(g: SVGElement, x: number, staffBottom: number, dur: number): void {
  const y = staffBottom + 22;
  if (dur <= 2) {
    g.appendChild(el("rect", { x: x - 5, y: y - (dur === 1 ? 4 : 1), width: 10, height: 4, stroke: "none" }));
  } else if (dur === 4) {
    g.appendChild(el("path", { d: `M${x - 2} ${y - 9}l4 5-4 4 4 5`, fill: "none", "stroke-width": "1.6" }));
  } else {
    const flags = dur >= 32 ? 3 : dur >= 16 ? 2 : 1;
    g.appendChild(el("path", { d: `M${x + 3} ${y - 7}L${x - 1} ${y + 6}`, fill: "none" }));
    for (let f = 0; f < flags; f++) g.appendChild(el("circle", { cx: x - 1 + f * 1.2, cy: y - 5 + f * 4, r: 1.8, stroke: "none" }));
  }
}
