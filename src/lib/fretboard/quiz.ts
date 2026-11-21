// Quiz questions: name the note, find the degree, name the interval (by eye or ear),
// and name the chord quality by ear. Ported from the Craft app.

import {
  BOTH_NAMES,
  CHORDS,
  KEYS,
  SCALES,
  bothNames,
  chordIndex,
  chordVoicings,
  intervalName,
  otherName,
  plainName,
  spell,
  toneFor,
  voicingNotes,
  wholeNeck,
  type FretNote,
} from "./theory";

export type QuizKind = "note" | "degree" | "interval" | "earinterval" | "earchord" | "findnote";

export const QUIZ_KINDS: { id: QuizKind; name: string; help: string; byEar: boolean }[] = [
  { id: "note", name: "Name the note", help: "A note lights up on the neck. Which note is it?", byEar: false },
  { id: "degree", name: "Find the scale degree", help: "A note from the scale lights up. Which degree of the scale is it?", byEar: false },
  { id: "interval", name: "Name the interval", help: "Two notes light up; R is the lower one. What is the distance between them?", byEar: false },
  { id: "earinterval", name: "Ear: hear the interval", help: "Listen to two notes, low then high. What interval did you hear?", byEar: true },
  { id: "earchord", name: "Ear: chord quality", help: "Listen to the chord. What kind of chord is it?", byEar: true },
  { id: "findnote", name: "Find the note", help: "A note is named. Click it anywhere on the fretboard.", byEar: false },
];

/** Index of a kind in QUIZ_KINDS: what is saved in the history. */
export const kindIndex = (k: QuizKind) => QUIZ_KINDS.findIndex((q) => q.id === k);

export const INTERVALS = ["Minor 2nd", "Major 2nd", "Minor 3rd", "Major 3rd", "Perfect 4th", "Tritone", "Perfect 5th", "Minor 6th", "Major 6th", "Minor 7th", "Major 7th", "Octave"];
const INTERVAL_SHORT = ["m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7", "8ve"];
const EAR_CHORDS = ["", "m", "dim", "aug", "7", "maj7", "m7"];

export interface Question {
  kind: QuizKind;
  /** Notes on the neck (string, fret); the first is the lower / root one. */
  notes: FretNote[];
  /** Labels shown on each note after answering. */
  reveal: string[];
  choices: string[];
  answer: number;
  explain: string;
  /** Strum the notes together (chords) instead of one after another. */
  together: boolean;
  /** For "Find the note": the pitch class to find (the answer is chosen on the neck, not from a list). */
  targetPc?: number;
}

/** A small seeded random generator (xorshift), so questions can be repeated in tests. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }
  below(n: number): number {
    return this.next() % Math.max(1, n);
  }
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * What an answer is saved as in the history: the answer without its note in brackets
 * ("4  (Eb)" gives "4"), and a note name in its usual single spelling ("G#/Ab" gives "Ab").
 */
export function itemName(choice: string): string {
  const c = choice.split("  (")[0].trim();
  const pc = BOTH_NAMES.indexOf(c);
  return pc >= 0 ? KEYS[pc] : c;
}

export function makeQuestion(kind: QuizKind, rng: Rng, tun: number[], key: number, scaleIdx: number, maxFret: number): Question {
  switch (kind) {
    case "note": {
      const s = rng.below(6);
      const f = rng.below(maxFret + 1);
      const pc = mod(tun[s] + f, 12);
      return {
        kind,
        notes: [[s, f]],
        reveal: [plainName(pc)],
        choices: [...BOTH_NAMES],
        answer: pc,
        explain: `String ${6 - s}, fret ${f} is ${bothNames(pc)}.`,
        together: false,
      };
    }
    case "degree": {
      const tones = SCALES[scaleIdx].tones;
      const marks = wholeNeck(tun, key, tones).filter((m) => m.fret <= maxFret);
      const m = marks[rng.below(marks.length)];
      const answer = Math.max(0, tones.findIndex((t) => t.label === m.label));
      const note = spell(key, m.semis, m.label);
      const pc = mod(key + m.semis, 12);
      const other = otherName(note, pc);
      return {
        kind,
        notes: [[m.string, m.fret]],
        reveal: [m.label === "1" ? "R" : m.label],
        choices: tones.map((t) => `${t.label}  (${spell(key, t.semis, t.label)})`),
        answer,
        explain: `${note}${other ? ` (the same note as ${other})` : ""} is the ${m.label} of ${KEYS[key]} ${SCALES[scaleIdx].name} — ${intervalName(m.label)}.`,
        together: false,
      };
    }
    case "interval":
    case "earinterval": {
      for (let attempt = 0; attempt < 200; attempt++) {
        const iv = rng.below(12) + 1;
        const s = rng.below(5);
        const f = rng.below(Math.min(maxFret, 12) + 1);
        const p = tun[s] + f;
        // Second note on the same or a higher string, within a hand's reach.
        const options: FretNote[] = [];
        for (let s2 = s; s2 < 6; s2++) {
          const f2 = p + iv - tun[s2];
          if (f2 >= 0 && f2 <= maxFret && Math.abs(f2 - f) <= 4 && !(s2 === s && f2 === f)) options.push([s2, f2]);
        }
        if (!options.length) continue;
        const second = options[rng.below(options.length)];
        return {
          kind,
          notes: [[s, f], second],
          reveal: ["R", INTERVAL_SHORT[iv - 1]],
          choices: [...INTERVALS],
          answer: iv - 1,
          explain: `${bothNames(p)} up to ${bothNames(p + iv)} is a ${INTERVALS[iv - 1]} (${iv} half steps).`,
          together: false,
        };
      }
      return makeQuestion("note", rng, tun, key, scaleIdx, maxFret);
    }
    case "findnote": {
      const pc = rng.below(12);
      return {
        kind,
        notes: [],
        reveal: [],
        // Not shown: the answer is picked on the neck. Kept so the history saves the note's name.
        choices: [...BOTH_NAMES],
        answer: pc,
        explain: "",
        together: false,
        targetPc: pc,
      };
    }
    case "earchord": {
      const q = rng.below(EAR_CHORDS.length);
      const ci = chordIndex(EAR_CHORDS[q]);
      const root = rng.below(12);
      const vs = chordVoicings(tun, root, CHORDS[ci].tones);
      const notes = vs.length ? voicingNotes(vs[rng.below(vs.length)]) : [];
      const reveal = notes.map(([s, f]) => {
        const t = toneFor(CHORDS[ci].tones, root, tun[s] + f);
        return t ? (t.label === "1" ? "R" : t.label) : "";
      });
      const sym = CHORDS[ci].symbol;
      const named = bothNames(root).split("/").map((n) => `${n}${sym}`).join(" / ");
      return {
        kind,
        notes,
        reveal,
        choices: EAR_CHORDS.map((s) => CHORDS[chordIndex(s)].name),
        answer: q,
        explain: `That was ${named} — a ${CHORDS[ci].name.toLowerCase()} chord.`,
        together: true,
      };
    }
  }
}
