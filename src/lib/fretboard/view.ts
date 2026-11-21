// What the neck shows: given the page, key, selection and (when a progression is
// playing) the current chord, work out the notes to draw and how to mark them.

import type { NeckMark } from "../../components/fretboard/Neck";
import type { Weakness } from "./weakness";
import { followTones, chordRoot, type ChordFocus, type Follow, type ProgChord } from "./progression";
import {
  CHORDS,
  SCALES,
  blend,
  chromaticLabel,
  chordVoicings,
  degreeNumber,
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

export type Page = "scales" | "arpeggios" | "chords" | "progressions" | "practice" | "speed" | "quiz";

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
  hiddenDegrees: number[];
  hiddenStrings: number[];
  ghosts: boolean;
  showPrev: boolean;
  showNext: boolean;
  /** Position number (1-based) to join the chosen position to, or 0 for none. */
  connect: number;
  connectStrings: number[];
  blendScale: number;
  blendRoot: number;
  /** On the Practice page, the step being shown (selected or playing). */
  practiceStep?: { root: number; tones: Tone[]; show: FretNote[] };
  /** The quiz question's notes, with the text to show in each (empty until revealed). */
  quizNotes?: { notes: FretNote[]; text: string[] };
  /** "Find the note": the neck is clickable, and after the answer the right spots are shown. */
  quizFind?: { maxFret: number; targetPc: number; pick: FretNote | null };
  /** The quiz history's weak spots, to mark on the neck. */
  weak?: Weakness | null;
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
  /** The notes a run plays on scale and arpeggio pages (the position, plus any connection). */
  runNotes: FretNote[];
  /** The fret range of the highlighted position(s), for giving it more room. */
  window: [number, number];
  /** The chord sounding (or selected) while following a progression. */
  nowChord?: { name: string; roman: string; root: number; chord: number; voicing: Voicing | undefined };
  /** When two scales are blended: [semitones, 0 both / 1 first / 2 second]. */
  blendSrc: [number, number][] | null;
}

const nowActive = (now: ProgChord | undefined, show: boolean) => now !== undefined && show;

const range = (notes: FretNote[]): [number, number] =>
  notes.length ? [Math.min(...notes.map((n) => n[1])), Math.max(...notes.map((n) => n[1]))] : [0, 4];

export function computeView(i: ViewInput): ViewModel {
  if (i.page === "quiz" && i.quizFind) {
    const f = i.quizFind;
    const marks: NeckMark[] = [];
    i.tuning.forEach((open, s) => {
      for (let fret = 0; fret <= f.maxFret; fret++) {
        const midi = open + fret;
        const isTarget = midi % 12 === f.targetPc;
        const isPick = f.pick !== null && f.pick[0] === s && f.pick[1] === fret;
        const mark: NeckMark = { string: s, fret, midi, label: "1", semis: 0, inPosition: false, quiz: true };
        if (f.pick === null) mark.pickable = true;
        else if (isPick) {
          mark.inPosition = true;
          mark.result = isTarget ? "right" : "wrong";
          mark.text = plainName(midi);
        } else if (isTarget) {
          mark.inPosition = true;
          mark.result = "answer";
          mark.text = plainName(midi);
        } else continue;
        marks.push(mark);
      }
    });
    return { root: i.key, tones: [], marks, voicing: undefined, nowLine: null, plainScale: false, runNotes: [], window: [0, 0], blendSrc: null };
  }
  if (i.page === "quiz") {
    const marks: NeckMark[] = (i.quizNotes?.notes ?? []).map(([s, f], k) => {
      const midi = i.tuning[s] + f;
      return { string: s, fret: f, midi, label: "1", semis: 0, inPosition: true, quiz: true, text: i.quizNotes?.text[k] ?? "" };
    });
    return { root: i.key, tones: [], marks, voicing: undefined, nowLine: null, plainScale: false, runNotes: [], window: [0, 0], blendSrc: null };
  }
  const scale = SCALES[i.scaleIdx];
  const scaleLike = i.page === "scales" || i.page === "progressions" || i.page === "practice" || i.page === "speed";
  // The last choice on the Position list is the whole neck.
  const list0 = scaleLike ? i.scalePos : i.page === "arpeggios" ? i.arpPos : [];
  const whole = i.page !== "chords" && list0.length > 0 && i.idx >= list0.length;
  const wholeNotes = (ts: Tone[]): FretNote[] => wholeNeck(i.tuning, i.key, ts).map((m) => [m.string, m.fret]);
  const baseNotes: FretNote[] = whole
    ? wholeNotes(scaleLike ? scale.tones : CHORDS[i.chordIdx].tones)
    : scaleLike
      ? (i.scalePos[i.idx]?.notes ?? [])
      : i.page === "arpeggios"
        ? (i.arpPos[i.idx]?.notes ?? [])
        : [];
  const baseVoicing = i.page === "chords" ? i.voicings[i.idx] : undefined;
  const [lo, hi] = baseVoicing ? range(voicingNotes(baseVoicing)) : range(baseNotes);

  let root = i.key;
  let tones: Tone[] = scaleLike ? scale.tones : CHORDS[i.chordIdx].tones;
  let active: FretNote[] = scaleLike ? baseNotes : baseVoicing ? voicingNotes(baseVoicing) : baseNotes;
  let voicing = baseVoicing;
  let nowLine: string | null = null;
  let plainScale = scaleLike;

  if ((i.page === "practice" || i.page === "speed") && i.practiceStep) {
    root = i.practiceStep.root;
    tones = i.practiceStep.tones;
    active = i.practiceStep.show;
    plainScale = false;
  }

  const now = i.page === "practice" || i.page === "speed" ? undefined : i.chordNow;
  const showNow = now !== undefined && (i.overlay || i.page === "progressions");
  let nowChord: ViewModel["nowChord"];
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
    nowChord = { name, roman: romanFor(now.semis, cd), root: cr, chord: now.chord, voicing: near };

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

  // Connect the position to a neighbour along the chosen strings.
  let linkSet = new Set<string>();
  let runNotes = active;
  if (i.page === "scales" && !nowActive(now, showNow) && i.connect > 0 && i.connect - 1 !== i.idx && !whole) {
    const other = i.scalePos[i.connect - 1]?.notes;
    if (other?.length) {
      const [lo2, hi2] = range(other);
      const [a, b] = [Math.min(lo, lo2), Math.max(hi, hi2)];
      const inBoth = new Set([...active, ...other].map(([s, f]) => `${s}:${f}`));
      const path: FretNote[] = [];
      for (const s of i.connectStrings) {
        for (let f = a; f <= b; f++) {
          if (toneFor(tones, root, i.tuning[s] + f) && !inBoth.has(`${s}:${f}`)) {
            path.push([s, f]);
            linkSet.add(`${s}:${f}`);
          }
        }
      }
      active = [...active, ...other, ...path];
      runNotes = active;
    }
  }

  // Blend a second scale over the first: notes only in the first are ringed, only in the second are diamonds.
  let blendSrc: [number, number][] | null = null;
  if (i.page === "scales" && i.blendScale >= 0 && !nowActive(now, showNow)) {
    const b = blend(tones, SCALES[i.blendScale].tones, i.blendRoot);
    tones = b.tones;
    blendSrc = b.src;
  }

  const activeSet = new Set(active.map(([s, f]) => `${s}:${f}`));
  const shapeSet = new Set(shapeNotes.map(([s, f]) => `${s}:${f}`));
  const marks: NeckMark[] = wholeNeck(i.tuning, root, tones).map((m) => {
    const key = `${m.string}:${m.fret}`;
    const mark: NeckMark = { ...m, inPosition: activeSet.has(key) };
    if (linkSet.has(key)) mark.link = true;
    if (blendSrc) {
      const src = blendSrc.find((e) => e[0] === m.semis)?.[1];
      mark.source = src as 0 | 1 | 2 | undefined;
      // The second scale's own notes show across the position's frets too.
      if (src === 2 && m.fret >= lo && m.fret <= hi) mark.inPosition = true;
    }
    return mark;
  });

  // Neighbouring positions, a little faded, so you can see how they join.
  const neighbours: [FretNote[], "prev" | "next"][] = [];
  const list = list0;
  if (!whole && i.showPrev && list[i.idx - 1]) neighbours.push([list[i.idx - 1].notes, "prev"]);
  if (!whole && i.showNext && list[i.idx + 1]) neighbours.push([list[i.idx + 1].notes, "next"]);
  for (const [notes, side] of neighbours) {
    for (const [s, f] of notes) {
      const m = marks.find((x) => x.string === s && x.fret === f);
      if (m && !m.inPosition) {
        m.neighbor = true;
        m.side = side;
      }
    }
  }

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
      if (!role) {
        // Scale tones that are not in the chord fade back so the chord notes stand out.
        m.dimmed = true;
        continue;
      }
      if (useShape) {
        if (!shapeSet.has(`${m.string}:${m.fret}`)) continue;
        m.big = true;
      }
      m.chordtone = true;
      m.badge = role.label === "1" ? "R" : role.label;
    }
  }

  const hiddenDeg = new Set(i.hiddenDegrees);
  const hiddenStr = new Set(i.hiddenStrings);
  const kept = marks.filter((m) => {
    if (hiddenStr.has(m.string)) return false;
    if (hiddenDeg.has(((degreeNumber(m.label) - 1) % 7) + 1)) return false;
    if (!i.ghosts && !m.inPosition && !m.neighbor) return false;
    return true;
  });
  // Weak spots from the quiz history.
  if (i.weak) {
    for (const m of kept) {
      if (!m.inPosition) continue;
      const why = i.weak.reasons(i.key, m.label, m.midi % 12, [m.string, m.fret], i.tuning.length);
      if (why.length) m.weak = why.join("\n");
    }
  }
  const [wlo, whi] = range(active);

  return { root, tones, marks: kept, voicing, nowLine, plainScale: plainScale && !blendSrc, runNotes, window: [wlo, whi], nowChord, blendSrc };
}
