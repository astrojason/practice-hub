import { useEffect, useRef } from "react";
import * as alphaTab from "@coderline/alphatab";
import type { TrackLayout, BeatGlyph } from "../../lib/tabLayout";
import {
  computeStaffMetrics,
  notationY,
  tabY,
  NOTATION_LINE_COUNT,
  LEFT_MARGIN_PX,
  RIGHT_PADDING_PX,
} from "./tabGeometry";

// ─── Static dual-staff renderer ─────────────────────────────────────────────────
//
// Phase 3 of the custom tab renderer: draws what tabLayout.ts computed onto a
// canvas. No playback/cursor here (phase 4) — this only has to look like
// recognizable tab + standard notation for a fixture score.
//
// v1 simplifications (see tabLayout.ts for the layout-side ones too):
// - Key signature accidental positions are hardcoded for treble clef only.
// - Beams are drawn as a single connecting line regardless of note duration
//   (no distinct double-beam for sixteenths).
// - Rests are simplified duration-agnostic markers, not full engraving glyphs.
// - Bends/slides/hammer-ons/ties-across-bars-that-tie-to-nothing etc. are not
//   drawn yet (phase 5).

// Canvas 2D fillStyle/strokeStyle can't resolve CSS custom properties (a
// var(...) string is simply invalid and silently falls back to black) —
// these have to be literal, resolved colors. Matched to this app's dark
// theme (--bg/--surface/--text in src/*.css) since the canvas can't inherit
// page CSS the way DOM elements do.
const BG = "#1a1a24";
const INK = "#eaeaf2";
const MUTED = "#a8a8c0";

const SHARP_KEY_STEPS = [8, 5, 9, 6, 3, 7, 4];
const FLAT_KEY_STEPS = [4, 7, 3, 6, 2, 5, 1];

interface Props {
  layout: TrackLayout;
  className?: string;
}

function noteheadFilled(duration: alphaTab.model.Duration): boolean {
  return duration >= alphaTab.model.Duration.Quarter;
}

function drawStaffLines(ctx: CanvasRenderingContext2D, width: number, layout: TrackLayout, metrics: ReturnType<typeof computeStaffMetrics>) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  for (let i = 0; i < NOTATION_LINE_COUNT; i++) {
    const y = notationY(i * 2, metrics) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let i = 0; i < layout.stringCount; i++) {
    const y = tabY(i, metrics) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawClefAndKey(ctx: CanvasRenderingContext2D, clef: alphaTab.model.Clef, keySignature: number, metrics: ReturnType<typeof computeStaffMetrics>) {
  ctx.fillStyle = INK;
  ctx.font = "40px serif";
  ctx.textBaseline = "alphabetic";
  const clefGlyph = clef === alphaTab.model.Clef.F4 ? "\u{1D122}" : "\u{1D11E}";
  ctx.fillText(clefGlyph, 8, notationY(4, metrics) + 14);

  ctx.font = "18px serif";
  const steps = keySignature > 0 ? SHARP_KEY_STEPS.slice(0, keySignature) : FLAT_KEY_STEPS.slice(0, -keySignature);
  const glyph = keySignature > 0 ? "♯" : "♭";
  let x = 42;
  for (const step of steps) {
    ctx.fillText(glyph, x, notationY(step, metrics) + 6);
    x += 10;
  }

  ctx.fillStyle = MUTED;
  ctx.font = "11px sans-serif";
  ctx.fillText("TAB", 4, metrics.tabStaffTopY + 4);
}

function drawBarLines(ctx: CanvasRenderingContext2D, layout: TrackLayout, metrics: ReturnType<typeof computeStaffMetrics>) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  for (const bar of layout.bars) {
    const x = bar.xEnd - 12 + LEFT_MARGIN_PX + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, metrics.notationStaffTopY);
    ctx.lineTo(x, metrics.tabStaffBottomY);
    ctx.stroke();
  }
}

function drawBeamsAndStems(ctx: CanvasRenderingContext2D, beats: BeatGlyph[], metrics: ReturnType<typeof computeStaffMetrics>) {
  const groups = new Map<number, BeatGlyph[]>();
  for (const beat of beats) {
    if (beat.beamGroupId === null || beat.isRest || beat.notes.length === 0) continue;
    if (!groups.has(beat.beamGroupId)) groups.set(beat.beamGroupId, []);
    groups.get(beat.beamGroupId)!.push(beat);
  }

  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;

  for (const beat of beats) {
    if (beat.isRest || beat.notes.length === 0) continue;
    const steps = beat.notes.map((n) => n.notationStep);
    const stemTip = beat.stemUp ? Math.max(...steps) + 7 : Math.min(...steps) - 7;
    const anchor = beat.stemUp ? Math.min(...steps) : Math.max(...steps);
    if (beat.duration === alphaTab.model.Duration.Whole) continue;
    const x = beat.x + LEFT_MARGIN_PX + (beat.stemUp ? 4 : -4);
    ctx.beginPath();
    ctx.moveTo(x, notationY(anchor, metrics));
    ctx.lineTo(x, notationY(stemTip, metrics));
    ctx.stroke();

    // Flags for unbeamed 8th-or-shorter notes.
    if (beat.beamGroupId === null && beat.duration >= alphaTab.model.Duration.Eighth) {
      const flagCount = Math.log2(beat.duration / alphaTab.model.Duration.Quarter);
      for (let f = 0; f < flagCount; f++) {
        const fy = notationY(stemTip, metrics) + (beat.stemUp ? 1 : -1) * f * 6;
        ctx.beginPath();
        ctx.moveTo(x, fy);
        ctx.quadraticCurveTo(x + 10, fy + (beat.stemUp ? 8 : -8), x + 2, fy + (beat.stemUp ? 14 : -14));
        ctx.stroke();
      }
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const stemUp = group[0].stemUp;
    ctx.beginPath();
    for (let i = 0; i < group.length; i++) {
      const b = group[i];
      const steps = b.notes.map((n) => n.notationStep);
      const stemTip = stemUp ? Math.max(...steps) + 7 : Math.min(...steps) - 7;
      const x = b.x + LEFT_MARGIN_PX + (stemUp ? 4 : -4);
      const y = notationY(stemTip, metrics);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineWidth = 1.2;
  }
}

function drawBeat(ctx: CanvasRenderingContext2D, beat: BeatGlyph, metrics: ReturnType<typeof computeStaffMetrics>) {
  const x = beat.x + LEFT_MARGIN_PX;

  if (beat.isRest) {
    ctx.fillStyle = MUTED;
    ctx.fillRect(x - 4, notationY(4, metrics) - 2, 8, 4);
    return;
  }

  const filled = noteheadFilled(beat.duration);
  for (const note of beat.notes) {
    const y = notationY(note.notationStep, metrics);

    // Ledger lines
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    if (note.notationStep < 0) {
      for (let s = -2; s >= note.notationStep; s -= 2) {
        const ly = notationY(s, metrics);
        ctx.beginPath();
        ctx.moveTo(x - 8, ly);
        ctx.lineTo(x + 8, ly);
        ctx.stroke();
      }
    } else if (note.notationStep > 8) {
      for (let s = 10; s <= note.notationStep; s += 2) {
        const ly = notationY(s, metrics);
        ctx.beginPath();
        ctx.moveTo(x - 8, ly);
        ctx.lineTo(x + 8, ly);
        ctx.stroke();
      }
    }

    // Notehead
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(x, y, 5, 3.5, -0.3, 0, Math.PI * 2);
    if (filled) ctx.fill();
    else {
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    // Accidental
    if (note.accidental) {
      ctx.fillStyle = INK;
      ctx.font = "14px sans-serif";
      ctx.fillText(note.accidental === "sharp" ? "♯" : "♭", x - 16, y + 4);
    }

    // Tab fret number, with a background clear so the string line doesn't cross it
    const ty = tabY(note.tabLineFromTop, metrics);
    const label = String(note.fret);
    ctx.font = "11px sans-serif";
    const w = ctx.measureText(label).width;
    ctx.fillStyle = BG;
    ctx.fillRect(x - w / 2 - 2, ty - 6, w + 4, 12);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.fillText(label, x, ty + 4);
    ctx.textAlign = "left";
  }
}

function drawTies(ctx: CanvasRenderingContext2D, beats: BeatGlyph[], metrics: ReturnType<typeof computeStaffMetrics>) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  for (let i = 1; i < beats.length; i++) {
    const cur = beats[i];
    const prev = beats[i - 1];
    for (const note of cur.notes) {
      if (!note.isTieDestination) continue;
      const prevNote = prev.notes.find((n) => n.string === note.string);
      if (!prevNote) continue;
      const x1 = prev.x + LEFT_MARGIN_PX + 6;
      const x2 = cur.x + LEFT_MARGIN_PX - 6;
      const y = notationY(note.notationStep, metrics);
      const dir = note.notationStep > 4 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.quadraticCurveTo((x1 + x2) / 2, y + dir * 6, x2, y);
      ctx.stroke();
    }
  }
}

export function TabCanvas({ layout, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const metrics = computeStaffMetrics(layout.stringCount);
    const width = layout.totalWidth + LEFT_MARGIN_PX + RIGHT_PADDING_PX;
    canvas.width = width;
    canvas.height = metrics.canvasHeight;

    ctx.clearRect(0, 0, width, metrics.canvasHeight);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, metrics.canvasHeight);

    drawStaffLines(ctx, width, layout, metrics);

    let lastKeySig: number | null = null;
    for (const bar of layout.bars) {
      if (bar.keySignature !== lastKeySig) {
        drawClefAndKey(ctx, bar.clef, bar.keySignature, metrics);
        lastKeySig = bar.keySignature;
      }
      drawBeamsAndStems(ctx, bar.beats, metrics);
      for (const beat of bar.beats) drawBeat(ctx, beat, metrics);
      drawTies(ctx, bar.beats, metrics);
    }
    drawBarLines(ctx, layout, metrics);
  }, [layout]);

  const metrics = computeStaffMetrics(layout.stringCount);
  const width = layout.totalWidth + LEFT_MARGIN_PX + RIGHT_PADDING_PX;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      data-testid="tab-canvas"
      width={width}
      height={metrics.canvasHeight}
    />
  );
}
