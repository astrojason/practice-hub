import * as alphaTab from "@coderline/alphatab";
import type { BeatTiming } from "./gpScore";

// ─── Pure layout engine ────────────────────────────────────────────────────────
//
// Converts a parsed alphaTab Score + precomputed beat timing into renderable
// geometry for a custom dual-staff (standard notation + tab) renderer. No
// DOM/Canvas references here — this module only computes numbers, so it can
// be unit tested the same way `resolvePlaybackPosition` is (see
// tests/gp-audio-clock.spec.ts).
//
// Horizontal layout is time-proportional (x = f(startMs)) rather than the
// fixed per-beat spacing traditional engraving uses. This is the property
// that turns the playback cursor into a deterministic `timeMs -> x` function
// instead of an event-driven relay — see TabCursor.tsx.
//
// Known v1 simplifications (acceptable per the phased rollout — see the plan):
// - Accidentals are spelled from a fixed sharp/flat chromatic table chosen by
//   the key signature's sign, not full per-measure accidental-lifetime
//   tracking. Notes may show a redundant accidental the key signature
//   already implies; they will never show a *wrong* pitch.
// - Beaming groups contiguous runs of eighth-or-shorter notes within a bar,
//   without meter-aware beat-grouping breaks.
// - Bends/slides/hammer-on/pull-off/vibrato/palm-mute glyphs are not laid
//   out here (phase 5).

export interface LayoutOptions {
  pixelsPerMs: number;
  barGapPx: number;
}

export const defaultLayoutOptions: LayoutOptions = {
  pixelsPerMs: 0.12,
  barGapPx: 24,
};

export type Accidental = "sharp" | "flat" | null;

export interface NoteGlyph {
  note: alphaTab.model.Note;
  /** Diatonic staff step, 0 = bottom line of the clef, +1 per line/space going up. */
  notationStep: number;
  accidental: Accidental;
  /** 1-based, matches alphaTab's Note.string (1 = lowest-pitched string). */
  string: number;
  /** 0-based tab line position counted from the top (highest-pitched string first). */
  tabLineFromTop: number;
  fret: number;
  isTieDestination: boolean;
}

export interface BeatGlyph {
  beat: alphaTab.model.Beat;
  x: number;
  startMs: number;
  durationMs: number;
  isRest: boolean;
  duration: alphaTab.model.Duration;
  dots: number;
  stemUp: boolean;
  /** Beats sharing this id should be drawn with a connecting beam. Null if unbeamed. */
  beamGroupId: number | null;
  notes: NoteGlyph[];
}

export interface BarLayout {
  bar: alphaTab.model.Bar;
  index: number;
  xStart: number;
  xEnd: number;
  clef: alphaTab.model.Clef;
  keySignature: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  beats: BeatGlyph[];
}

export interface TrackLayout {
  bars: BarLayout[];
  totalWidth: number;
  stringCount: number;
}

// ─── Pitch spelling ────────────────────────────────────────────────────────────

// [letterIndex, accidentalSemitoneOffset] per pitch class 0-11
const SHARP_SPELLING: [number, number][] = [
  [0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0],
  [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0],
];
const FLAT_SPELLING: [number, number][] = [
  [0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0],
  [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0],
];

const CLEF_REFERENCE: Record<number, { letterIndex: number; octave: number }> = {
  [alphaTab.model.Clef.G2]: { letterIndex: 2, octave: 4 }, // E4, treble bottom line
  [alphaTab.model.Clef.F4]: { letterIndex: 4, octave: 2 }, // G2, bass bottom line
  [alphaTab.model.Clef.C3]: { letterIndex: 3, octave: 3 }, // F3, alto bottom line
  [alphaTab.model.Clef.C4]: { letterIndex: 1, octave: 3 }, // D3, tenor bottom line
  [alphaTab.model.Clef.Neutral]: { letterIndex: 2, octave: 4 },
};

function spellPitch(realValue: number, keySignature: number): { letterIndex: number; octave: number; accidental: Accidental } {
  const pitchClass = ((realValue % 12) + 12) % 12;
  const octave = Math.floor(realValue / 12) - 1;
  const table = keySignature < 0 ? FLAT_SPELLING : SHARP_SPELLING;
  const [letterIndex, offset] = table[pitchClass];
  const accidental: Accidental = offset > 0 ? "sharp" : offset < 0 ? "flat" : null;
  return { letterIndex, octave, accidental };
}

function notationStepFor(realValue: number, clef: alphaTab.model.Clef, keySignature: number): { step: number; accidental: Accidental } {
  const { letterIndex, octave, accidental } = spellPitch(realValue, keySignature);
  const ref = CLEF_REFERENCE[clef] ?? CLEF_REFERENCE[alphaTab.model.Clef.G2];
  const refAbsolute = ref.letterIndex + 7 * ref.octave;
  const noteAbsolute = letterIndex + 7 * octave;
  return { step: noteAbsolute - refAbsolute, accidental };
}

// ─── Stem direction ─────────────────────────────────────────────────────────────

const MIDDLE_STAFF_STEP = 4; // middle line of a 5-line staff, in the 0=bottom-line scheme

function stemUpFor(steps: number[]): boolean {
  if (steps.length === 0) return true;
  let extreme = steps[0];
  for (const s of steps) {
    if (Math.abs(s - MIDDLE_STAFF_STEP) > Math.abs(extreme - MIDDLE_STAFF_STEP)) extreme = s;
  }
  return extreme <= MIDDLE_STAFF_STEP;
}

// ─── Beaming ────────────────────────────────────────────────────────────────────

function isBeamable(beat: alphaTab.model.Beat): boolean {
  return !beat.isRest && beat.duration >= alphaTab.model.Duration.Eighth;
}

// ─── Layout ─────────────────────────────────────────────────────────────────────

export function buildTrackLayout(
  score: alphaTab.model.Score,
  trackIndex: number,
  beatTiming: Map<number, BeatTiming>,
  options: LayoutOptions = defaultLayoutOptions,
): TrackLayout {
  const track = score.tracks[trackIndex];
  const staff = track.staves[0];
  const stringCount = staff.tuning.length;

  const bars: BarLayout[] = [];
  let beamGroupCounter = 0;
  let x = 0;

  for (const bar of staff.bars) {
    const masterBar = score.masterBars[bar.index];
    const xStart = x;

    // A bar may have multiple voices; v1 renders voice 0 only.
    const voice = bar.voices[0];
    const beatGlyphs: BeatGlyph[] = [];

    // First pass: build glyphs with time-proportional x.
    for (const beat of voice.beats) {
      const timing = beatTiming.get(beat.id);
      const startMs = timing?.startMs ?? 0;
      const durationMs = timing?.durationMs ?? 0;
      const beatX = startMs * options.pixelsPerMs;
      x = Math.max(x, beatX + durationMs * options.pixelsPerMs);

      const notes: NoteGlyph[] = beat.notes.map((note) => {
        const { step, accidental } = notationStepFor(note.realValue, bar.clef, masterBar.keySignature);
        return {
          note,
          notationStep: step,
          accidental,
          string: note.string,
          tabLineFromTop: stringCount - note.string,
          fret: note.fret,
          isTieDestination: note.isTieDestination,
        };
      });

      beatGlyphs.push({
        beat,
        x: beatX,
        startMs,
        durationMs,
        isRest: beat.isRest,
        duration: beat.duration,
        dots: beat.dots,
        stemUp: stemUpFor(notes.map((n) => n.notationStep)),
        beamGroupId: null,
        notes,
      });
    }

    // Second pass: group contiguous beamable runs (length >= 2).
    let runStart = -1;
    for (let i = 0; i <= beatGlyphs.length; i++) {
      const beamable = i < beatGlyphs.length && isBeamable(beatGlyphs[i].beat);
      if (beamable && runStart === -1) {
        runStart = i;
      } else if (!beamable && runStart !== -1) {
        if (i - runStart >= 2) {
          const groupId = beamGroupCounter++;
          for (let j = runStart; j < i; j++) beatGlyphs[j].beamGroupId = groupId;
        }
        runStart = -1;
      }
    }

    const xEnd = x + options.barGapPx;
    bars.push({
      bar,
      index: bar.index,
      xStart,
      xEnd,
      clef: bar.clef,
      keySignature: masterBar.keySignature,
      timeSignatureNumerator: masterBar.timeSignatureNumerator,
      timeSignatureDenominator: masterBar.timeSignatureDenominator,
      beats: beatGlyphs,
    });
    x = xEnd;
  }

  return { bars, totalWidth: x, stringCount };
}
