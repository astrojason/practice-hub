import { useEffect, useRef } from "react";
import * as alphaTab from "@coderline/alphatab";
import type { TrackLayout, BeatGlyph, BarLayout } from "../../lib/tabLayout";
import {
  computeStaffMetrics,
  notationY,
  tabY,
  lineTopY,
  pageHeight,
  NOTATION_LINE_COUNT,
  LEFT_MARGIN_PX,
} from "./tabGeometry";

// ─── Paginated dual-staff renderer ───────────────────────────────────────────────
//
// Draws what tabLayout.ts computed onto a canvas: a fixed-width page with
// bars wrapped across multiple staff systems (lines), like real sheet music,
// rather than one continuously-growing horizontal strip.
//
// v1 simplifications (see tabLayout.ts for the layout-side ones too):
// - Key signature accidental positions are hardcoded for treble clef only.
// - Beams are drawn as a single connecting line regardless of note duration
//   (no distinct double-beam for sixteenths).
// - Rests are simplified duration-agnostic markers, not full engraving glyphs.
// - Bends are a generic hook glyph (not shaped by actual bendPoints values);
//   vibrato/slides/hammer-pull/palm-mute are simplified single glyphs.
// - Ties, hammer-ons/pull-offs, and slides only connect within a single bar
//   — a phrase crossing a bar or line boundary won't draw its connector.

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

function drawStaffLines(ctx: CanvasRenderingContext2D, width: number, stringCount: number, metrics: ReturnType<typeof computeStaffMetrics>) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  for (let i = 0; i < NOTATION_LINE_COUNT; i++) {
    const y = notationY(i * 2, metrics) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let i = 0; i < stringCount; i++) {
    const y = tabY(i, metrics) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawClefAndKey(ctx: CanvasRenderingContext2D, clef: alphaTab.model.Clef, keySignature: number, metrics: ReturnType<typeof computeStaffMetrics>) {
  ctx.fillStyle = INK;
  ctx.font = "56px serif";
  ctx.textBaseline = "alphabetic";
  const clefGlyph = clef === alphaTab.model.Clef.F4 ? "\u{1D122}" : "\u{1D11E}";
  ctx.fillText(clefGlyph, 10, notationY(4, metrics) + 19);

  ctx.font = "24px serif";
  const steps = keySignature > 0 ? SHARP_KEY_STEPS.slice(0, keySignature) : FLAT_KEY_STEPS.slice(0, -keySignature);
  const glyph = keySignature > 0 ? "♯" : "♭";
  let x = 54;
  for (const step of steps) {
    ctx.fillText(glyph, x, notationY(step, metrics) + 8);
    x += 13;
  }

  ctx.fillStyle = MUTED;
  ctx.font = "bold 13px sans-serif";
  ctx.fillText("TAB", 5, metrics.tabStaffTopY + 5);
}

function drawBarLines(ctx: CanvasRenderingContext2D, bars: BarLayout[], metrics: ReturnType<typeof computeStaffMetrics>) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  for (const bar of bars) {
    const x = bar.xEnd - 14 + LEFT_MARGIN_PX + 0.5;
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
  ctx.lineWidth = 1.6;

  for (const beat of beats) {
    if (beat.isRest || beat.notes.length === 0) continue;
    const steps = beat.notes.map((n) => n.notationStep);
    const stemTip = beat.stemUp ? Math.max(...steps) + 7 : Math.min(...steps) - 7;
    const anchor = beat.stemUp ? Math.min(...steps) : Math.max(...steps);
    if (beat.duration === alphaTab.model.Duration.Whole) continue;
    const x = beat.x + LEFT_MARGIN_PX + (beat.stemUp ? 5 : -5);
    ctx.beginPath();
    ctx.moveTo(x, notationY(anchor, metrics));
    ctx.lineTo(x, notationY(stemTip, metrics));
    ctx.stroke();

    // Flags for unbeamed 8th-or-shorter notes.
    if (beat.beamGroupId === null && beat.duration >= alphaTab.model.Duration.Eighth) {
      const flagCount = Math.log2(beat.duration / alphaTab.model.Duration.Quarter);
      for (let f = 0; f < flagCount; f++) {
        const fy = notationY(stemTip, metrics) + (beat.stemUp ? 1 : -1) * f * 8;
        ctx.beginPath();
        ctx.moveTo(x, fy);
        ctx.quadraticCurveTo(x + 14, fy + (beat.stemUp ? 11 : -11), x + 3, fy + (beat.stemUp ? 19 : -19));
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
      const x = b.x + LEFT_MARGIN_PX + (stemUp ? 5 : -5);
      const y = notationY(stemTip, metrics);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineWidth = 1.6;
  }
}

function drawBeat(ctx: CanvasRenderingContext2D, beat: BeatGlyph, metrics: ReturnType<typeof computeStaffMetrics>) {
  const x = beat.x + LEFT_MARGIN_PX;

  if (beat.isRest) {
    ctx.fillStyle = MUTED;
    ctx.fillRect(x - 6, notationY(4, metrics) - 3, 12, 6);
    return;
  }

  const filled = noteheadFilled(beat.duration);
  for (const note of beat.notes) {
    const y = notationY(note.notationStep, metrics);

    // Ledger lines
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    if (note.notationStep < 0) {
      for (let s = -2; s >= note.notationStep; s -= 2) {
        const ly = notationY(s, metrics);
        ctx.beginPath();
        ctx.moveTo(x - 11, ly);
        ctx.lineTo(x + 11, ly);
        ctx.stroke();
      }
    } else if (note.notationStep > 8) {
      for (let s = 10; s <= note.notationStep; s += 2) {
        const ly = notationY(s, metrics);
        ctx.beginPath();
        ctx.moveTo(x - 11, ly);
        ctx.lineTo(x + 11, ly);
        ctx.stroke();
      }
    }

    // Notehead
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(x, y, 7, 5, -0.3, 0, Math.PI * 2);
    if (filled) ctx.fill();
    else {
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // Accidental
    if (note.accidental) {
      ctx.fillStyle = INK;
      ctx.font = "19px sans-serif";
      ctx.fillText(note.accidental === "sharp" ? "♯" : "♭", x - 22, y + 6);
    }

    // Tab fret number, with a background clear so the string line doesn't cross it
    const ty = tabY(note.tabLineFromTop, metrics);
    const label = note.note.isDead ? "x" : note.note.isGhost ? `(${note.fret})` : String(note.fret);
    ctx.font = "bold 16px sans-serif";
    const w = ctx.measureText(label).width;
    ctx.fillStyle = BG;
    ctx.fillRect(x - w / 2 - 3, ty - 9, w + 6, 18);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.fillText(label, x, ty + 6);
    ctx.textAlign = "left";
  }
}

function drawArticulations(ctx: CanvasRenderingContext2D, beats: BeatGlyph[], metrics: ReturnType<typeof computeStaffMetrics>) {
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    if (beat.isRest) continue;

    // Palm mute: a small label under the tab staff. v1 marks every muted
    // beat individually rather than drawing a spanning bracket over a run.
    if (beat.beat.isPalmMute) {
      ctx.fillStyle = MUTED;
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PM", beat.x + LEFT_MARGIN_PX, metrics.tabStaffBottomY + 20);
      ctx.textAlign = "left";
    }

    for (const note of beat.notes) {
      const x = beat.x + LEFT_MARGIN_PX;
      const y = notationY(note.notationStep, metrics);

      // Bend: a short upward hook above the notehead.
      if (note.note.hasBend) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x + 4, y - 9);
        ctx.quadraticCurveTo(x + 14, y - 23, x + 6, y - 28);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 1, y - 25);
        ctx.lineTo(x + 6, y - 28);
        ctx.lineTo(x + 9, y - 22);
        ctx.stroke();
      }

      // Vibrato: a small wavy line trailing the notehead.
      if (note.note.vibrato !== alphaTab.model.VibratoType.None) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        const vy = y + 14;
        for (let s = 0; s < 4; s++) {
          ctx.moveTo(x + 11 + s * 7, vy);
          ctx.quadraticCurveTo(x + 11 + s * 7 + 3.5, vy - 4, x + 11 + s * 7 + 7, vy);
        }
        ctx.stroke();
      }

      // Hammer-on / pull-off: a slur from the origin note (in an earlier
      // beat within this bar — cross-bar connections are a v1 gap, same as
      // ties below) to this note.
      if (note.note.hammerPullOrigin) {
        for (let j = i - 1; j >= 0; j--) {
          const originGlyph = beats[j].notes.find((n) => n.note === note.note.hammerPullOrigin);
          if (!originGlyph) continue;
          const x1 = beats[j].x + LEFT_MARGIN_PX + 8;
          const y1 = notationY(originGlyph.notationStep, metrics);
          const dir = notationStepMidpointDir(originGlyph.notationStep, note.notationStep);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo((x1 + x) / 2, Math.min(y1, y) + dir * 11, x - 8, y);
          ctx.stroke();
          break;
        }
      }

      // Slide: a diagonal line from this note toward the next beat's note
      // on the same string.
      if (note.note.slideOutType !== alphaTab.model.SlideOutType.None && i + 1 < beats.length) {
        const nextGlyph = beats[i + 1].notes.find((n) => n.string === note.string);
        if (nextGlyph) {
          const x2 = beats[i + 1].x + LEFT_MARGIN_PX - 8;
          const y2 = notationY(nextGlyph.notationStep, metrics);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(x + 10, y);
          ctx.lineTo(x2 - 3, y2);
          ctx.stroke();
        }
      }
    }
  }
}

const MIDDLE_STAFF_STEP = 4; // middle line of a 5-line staff, in the 0=bottom-line scheme (matches tabLayout.ts)

function notationStepMidpointDir(stepA: number, stepB: number): -1 | 1 {
  return (stepA + stepB) / 2 > MIDDLE_STAFF_STEP ? 1 : -1;
}

function drawTies(ctx: CanvasRenderingContext2D, beats: BeatGlyph[], metrics: ReturnType<typeof computeStaffMetrics>) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  for (let i = 1; i < beats.length; i++) {
    const cur = beats[i];
    const prev = beats[i - 1];
    for (const note of cur.notes) {
      if (!note.isTieDestination) continue;
      const prevNote = prev.notes.find((n) => n.string === note.string);
      if (!prevNote) continue;
      const x1 = prev.x + LEFT_MARGIN_PX + 8;
      const x2 = cur.x + LEFT_MARGIN_PX - 8;
      const y = notationY(note.notationStep, metrics);
      const dir = note.notationStep > 4 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.quadraticCurveTo((x1 + x2) / 2, y + dir * 8, x2, y);
      ctx.stroke();
    }
  }
}

function groupBarsByLine(bars: BarLayout[]): BarLayout[][] {
  const lines: BarLayout[][] = [];
  for (const bar of bars) {
    if (!lines[bar.line]) lines[bar.line] = [];
    lines[bar.line].push(bar);
  }
  return lines;
}

export function TabCanvas({ layout, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const metrics = computeStaffMetrics(layout.stringCount);
    const width = layout.pageWidth;
    const height = pageHeight(layout.lineCount, metrics);
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    const lines = groupBarsByLine(layout.bars);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineBars = lines[lineIndex] ?? [];
      const top = lineTopY(lineIndex, metrics);
      ctx.save();
      ctx.translate(0, top);

      drawStaffLines(ctx, width, layout.stringCount, metrics);
      // Every staff system repeats its clef and key signature, matching
      // standard engraving convention (not just once per key-signature
      // change across the whole piece).
      if (lineBars.length > 0) {
        drawClefAndKey(ctx, lineBars[0].clef, lineBars[0].keySignature, metrics);
      }
      for (const bar of lineBars) {
        drawBeamsAndStems(ctx, bar.beats, metrics);
        for (const beat of bar.beats) drawBeat(ctx, beat, metrics);
        drawTies(ctx, bar.beats, metrics);
        drawArticulations(ctx, bar.beats, metrics);
      }
      drawBarLines(ctx, lineBars, metrics);

      ctx.restore();
    }
  }, [layout]);

  const metrics = computeStaffMetrics(layout.stringCount);
  const width = layout.pageWidth;
  const height = pageHeight(layout.lineCount, metrics);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      data-testid="tab-canvas"
      width={width}
      height={height}
    />
  );
}
