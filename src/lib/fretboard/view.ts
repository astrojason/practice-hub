// What the neck shows: given the page, key, selection and (when a progression is
// playing) the current chord, work out the notes to draw and how to mark them.

import type { NeckMark } from "../../components/fretboard/Neck";
import { followTones, chordRoot, type ChordFocus, type Follow, type ProgChord } from "./progression";
import {
  CHORDS,
  SCALES,
  chromaticLabel,
  chordVoicings,
  followPosition,
  plainName,
  romanFor,
  toneFor,
  voicingMinFret,
  voicingNotes,
  wholeNeck,
  type FretNote,
  type PositionInfo,
  type Tone,
  type Voicing,
} from "./theory";

export type Page = "scales" | "arpeggios" | "chords" | "progressions";

export interface ViewInput {
  page: Page;
  key: number;
  scaleIdx: number;
  chordIdx: number;
  idx: number;
  tuning: number[];
  scalePos: PositionInfo[];
  arpPos: PositionInfo[];
  voicings: Voicing[];
  /** The chord that is sounding (or selected on the Progressions page), if any. */
  chordNow: ProgChord | undefined;
  /** Whether a progression is playing under this page (not just the Progressions page itself). */
  overlay: boolean;
  follow: Follow;
  focus: ChordFocus;
}

export interface ViewModel {
  root: number;
  tones: Tone[];
  marks: NeckMark[];
  voicing: Voicing | undefined;
  /** "Now: Dm7 (ii7) — D Dorian" while following a progression. */
  nowLine: string | null;
  /** Whether the key's scale colour notes apply (only the plain scale view). */
  plainScale: boolean;
}

const range = (notes: FretNote[]): [number, number] =>
  notes.length ? [Math.min(...notes.map((n) => n[1])), Math.max(...notes.map((n) => n[1]))] : [0, 4];

export function computeView(i: ViewInput): ViewModel {
  const scale = SCALES[i.scaleIdx];
  const scaleLike = i.page === "scales" || i.page === "progressions";
  const baseNotes: FretNote[] = scaleLike ? (i.scalePos[i.idx]?.notes ?? []) : i.page === "arpeggios" ? (i.arpPos[i.idx]?.notes ?? []) : [];
  const baseVoicing = i.page === "chords" ? i.voicings[i.idx] : undefined;
  const [lo, hi] = baseVoicing ? range(voicingNotes(baseVoicing)) : range(baseNotes);

  let root = i.key;
  let tones: Tone[] = scaleLike ? scale.tones : CHORDS[i.chordIdx].tones;
  let active: FretNote[] = scaleLike ? baseNotes : baseVoicing ? voicingNotes(baseVoicing) : baseNotes;
  let voicing = baseVoicing;
  let nowLine: string | null = null;
  let plainScale = scaleLike;

  const now = i.chordNow;
  const showNow = now !== undefined && (i.overlay || i.page === "progressions");
  let chordTonePcs: Set<number> | null = null;
  let shapeNotes: FretNote[] = [];
  let extraChordMarks = false;

  if (now && showNow) {
    const cd = CHORDS[now.chord];
    const cr = chordRoot(i.key, now);
    const name = plainName(cr) + cd.symbol;
    nowLine = `Now: ${name} (${romanFor(now.semis, cd)})`;
    chordTonePcs = new Set(cd.tones.map((t) => (cr + t.semis) % 12));
    const list = chordVoicings(i.tuning, cr, cd.tones);
    const near = list.length ? [...list].sort((a, b) => Math.abs(voicingMinFret(a) - lo) - Math.abs(voicingMinFret(b) - lo))[0] : undefined;

    if (i.page === "arpeggios") {
      root = cr;
      tones = cd.tones;
      active = followPosition(i.tuning, cr, tones, true, lo, hi);
      plainScale = false;
    } else if (i.page === "chords") {
      root = cr;
      tones = cd.tones;
      voicing = near;
      active = near ? voicingNotes(near) : [];
      plainScale = false;
    } else if (i.page === "progressions" && i.follow === "chordscale") {
      const ft = followTones(i.scaleIdx, now);
      root = cr;
      tones = ft.tones;
      active = followPosition(i.tuning, cr, tones, false, lo, hi);
      nowLine += ` — ${plainName(cr)} ${ft.name}`;
      plainScale = false;
    } else if (i.page === "progressions" && i.follow === "arpeggio") {
      root = cr;
      tones = cd.tones;
      active = followPosition(i.tuning, cr, tones, true, lo, hi);
      nowLine += ` — ${name} arpeggio`;
      plainScale = false;
    } else {
      // The key's scale stays; the chord's tones are marked on it.
      extraChordMarks = true;
      shapeNotes = near ? voicingNotes(near) : [];
    }
  }

  const activeSet = new Set(active.map(([s, f]) => `${s}:${f}`));
  const shapeSet = new Set(shapeNotes.map(([s, f]) => `${s}:${f}`));
  const marks: NeckMark[] = wholeNeck(i.tuning, root, tones).map((m) => ({ ...m, inPosition: activeSet.has(`${m.string}:${m.fret}`) }));

  if (extraChordMarks && chordTonePcs) {
    // Chord tones that fall outside the scale still show during a progression.
    i.tuning.forEach((open, s) => {
      for (let f = Math.max(lo, 0); f <= hi; f++) {
        const midi = open + f;
        if (chordTonePcs!.has(midi % 12) && !toneFor(tones, root, midi) && !marks.some((m) => m.string === s && m.fret === f)) {
          const semis = (((midi - root) % 12) + 12) % 12;
          marks.push({ string: s, fret: f, midi, label: chromaticLabel(semis), semis, inPosition: true });
        }
      }
    });
  }

  if (now && showNow && chordTonePcs) {
    const cd = CHORDS[now.chord];
    const cr = chordRoot(i.key, now);
    const useShape = i.page === "progressions" && i.focus === "shape" && extraChordMarks;
    for (const m of marks) {
      if (!m.inPosition) continue;
      const role = cd.tones.find((t) => (cr + t.semis) % 12 === m.midi % 12);
      if (!role) continue;
      if (useShape) {
        if (!shapeSet.has(`${m.string}:${m.fret}`)) continue;
        m.big = true;
      }
      m.chordtone = true;
      m.badge = role.label === "1" ? "R" : role.label;
    }
  }

  return { root, tones, marks, voicing, nowLine, plainScale };
}
