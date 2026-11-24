// Name what you play: the chord a set of notes makes, the scales a set of notes
// fits, and the chords typed from a song chart.

import { CHORDS, SCALES, BOTH_NAMES, chromaticLabel, optionalLabels, plainName } from "./theory";

const mod = (n: number, m: number) => ((n % m) + m) % m;
const pcsOf = (root: number, semis: number[]) => [...new Set(semis.map((s) => mod(root + s, 12)))];

export interface ChordMatch {
  root: number;
  /** Index into CHORDS. */
  chord: number;
  bass: number;
  name: string;
  /** Chord tones the notes leave out (only ones a guitarist may drop, such as the 5th). */
  missing: string[];
}

/**
 * The chords a set of notes (MIDI numbers) can be. Every note must belong to the chord;
 * the chord may leave out only the tones a guitar shape usually drops. Exact matches come
 * first, then chords whose root is in the bass, then simpler chords. The lowest note
 * decides the inversion: C E G with E lowest is C/E.
 */
export function identifyChord(midis: number[]): ChordMatch[] {
  if (midis.length === 0) return [];
  const played = [...new Set(midis.map((m) => mod(m, 12)))];
  if (played.length < 2) return [];
  const bass = mod(Math.min(...midis), 12);
  const out: (ChordMatch & { order: number })[] = [];
  for (const root of played) {
    CHORDS.forEach((c, ci) => {
      const set = pcsOf(root, c.tones.map((t) => t.semis));
      if (!played.every((p) => set.includes(p))) return;
      const optional = optionalLabels(c.tones);
      // A triad's 5th may go too when the 3rd (or 3rd-replacing 2nd/4th) says what the chord is.
      if (c.tones.length === 3 && c.tones.some((t) => t.label === "5")) optional.push("5");
      const missing = c.tones.filter((t) => !played.includes(mod(root + t.semis, 12))).map((t) => t.label);
      if (!missing.every((l) => optional.includes(l))) return;
      // Two notes only name a chord when nothing is missing (a power chord, or C E as no chord at all).
      if (played.length === 2 && missing.length > 0) return;
      const name = plainName(root) + c.symbol + (bass !== root ? "/" + plainName(bass) : "");
      out.push({ root, chord: ci, bass, name, missing, order: (missing.length > 0 ? 1000 : 0) + (bass !== root ? 100 : 0) + missing.length * 10 + ci / 100 });
    });
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _order, ...m }) => m);
}

export interface SimilarChord {
  root: number;
  chord: number;
  name: string;
  /** What changes: "adds the 7", "drops the 5", "3 → 4". */
  how: string;
}

/** Chords on the same root that are one note away: one added, one dropped, or one swapped. */
export function similarChords(root: number, chordIdx: number): SimilarChord[] {
  const base = CHORDS[chordIdx];
  const set = new Map(base.tones.map((t) => [mod(t.semis, 12), t.label]));
  const out: SimilarChord[] = [];
  CHORDS.forEach((c, ci) => {
    if (ci === chordIdx) return;
    const other = new Map(c.tones.map((t) => [mod(t.semis, 12), t.label]));
    const added = [...other.keys()].filter((s) => !set.has(s));
    const dropped = [...set.keys()].filter((s) => !other.has(s));
    let how: string | null = null;
    if (added.length === 1 && dropped.length === 0) how = `adds the ${other.get(added[0])}`;
    else if (added.length === 0 && dropped.length === 1) how = `drops the ${set.get(dropped[0])}`;
    else if (added.length === 1 && dropped.length === 1) how = `${set.get(dropped[0])} → ${other.get(added[0])}`;
    if (how) out.push({ root, chord: ci, name: plainName(root) + c.symbol, how });
  });
  return out;
}

export interface ScaleMatch {
  root: number;
  /** Index into SCALES. */
  scale: number;
  name: string;
  /** Notes of the scale you did not pick (pitch classes). */
  extra: number[];
}

// How often a scale is the answer, most common first; the rest follow in list order.
const COMMON = [
  "Major (Ionian)", "Natural Minor (Aeolian)", "Major Pentatonic", "Minor Pentatonic", "Blues", "Dorian",
  "Mixolydian", "Harmonic Minor", "Melodic Minor", "Lydian", "Phrygian", "Locrian",
];
const commonness = (si: number) => {
  const i = COMMON.indexOf(SCALES[si].name);
  return i >= 0 ? i : COMMON.length + si;
};

export interface SongKey {
  root: number;
  minor: boolean;
}

/**
 * The scales that hold every picked note (pitch classes), fewest extra notes first. With a
 * key the root is fixed, the key's own scale leads whenever it fits, and scales of the
 * key's kind (major or minor) come before the others; without
 * one, scales starting on `home` (default: the first note picked) come first, then the most
 * common scales.
 */
export function identifyScales(pcs: number[], key: SongKey | null, home: number = pcs[0]): ScaleMatch[] {
  const picked = [...new Set(pcs.map((p) => mod(p, 12)))];
  if (picked.length < 2) return [];
  const roots = key ? [mod(key.root, 12)] : Array.from({ length: 12 }, (_, i) => i);
  const out: (ScaleMatch & { order: number[] })[] = [];
  for (const root of roots) {
    SCALES.forEach((s, si) => {
      if (s.name === "Chromatic") return;
      const set = pcsOf(root, s.tones.map((t) => t.semis));
      if (!picked.every((p) => set.includes(p))) return;
      const extra = set.filter((p) => !picked.includes(p));
      const minorish = s.tones.some((t) => t.label === "b3" || t.label === "#2") && !s.tones.some((t) => t.label === "3");
      const kindMiss = key ? (minorish === key.minor ? 0 : 1) : 0;
      // With a key, the key's own scale is the answer whenever it holds every note.
      const keyScale = key && s.name === (key.minor ? "Natural Minor (Aeolian)" : "Major (Ionian)") ? 0 : 1;
      out.push({
        root,
        scale: si,
        name: `${plainName(root)} ${s.name}`,
        extra,
        order: [key ? keyScale : 0, extra.length, kindMiss, root === mod(home, 12) ? 0 : 1, commonness(si), root],
      });
    });
  }
  out.sort((a, b) => {
    for (let i = 0; i < a.order.length; i++) if (a.order[i] !== b.order[i]) return a.order[i] - b.order[i];
    return 0;
  });
  return out.map(({ order: _order, ...m }) => m);
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_LABELS = ["1", "2", "3", "4", "5", "6", "7"];
const MINOR_LABELS = ["1", "2", "b3", "4", "5", "b6", "b7"];

/** Each picked note numbered in the key (1, 2, b3…), and whether it belongs to the key's scale. */
export function keyDegrees(pcs: number[], key: SongKey): { pc: number; label: string; inKey: boolean }[] {
  const steps = key.minor ? MINOR : MAJOR;
  const labels = key.minor ? MINOR_LABELS : MAJOR_LABELS;
  return pcs.map((p) => {
    const semis = mod(p - key.root, 12);
    const i = steps.indexOf(semis);
    return { pc: mod(p, 12), label: i >= 0 ? labels[i] : chromaticLabel(semis), inKey: i >= 0 };
  });
}

export const NOTE_NAMES = BOTH_NAMES;

export interface ParsedChord {
  root: number;
  /** Index into CHORDS. */
  chord: number;
  symbol: string;
  bass: number;
  text: string;
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Other ways chord charts write the symbols this app knows.
const ALIASES: Record<string, string> = {
  M: "", maj: "", major: "",
  min: "m", mi: "m", "-": "m", minor: "m",
  M7: "maj7", ma7: "maj7", "Δ": "maj7", "Δ7": "maj7", "∆": "maj7", "∆7": "maj7",
  min7: "m7", mi7: "m7", "-7": "m7",
  "°": "dim", o: "dim", "°7": "dim7", o7: "dim7",
  "ø": "m7b5", "ø7": "m7b5", "m7-5": "m7b5", min7b5: "m7b5", "-7b5": "m7b5",
  "+": "aug", "+7": "7#5", aug7: "7#5",
  sus: "sus4", "7sus": "7sus4", add2: "add9", "2": "sus2", "69": "6/9",
  mM7: "m(maj7)", mmaj7: "m(maj7)", minmaj7: "m(maj7)", "m(M7)": "m(maj7)",
  min6: "m6", min9: "m9", min11: "m11", min13: "m13", M9: "maj9", M13: "maj13",
};

function notePc(letter: string, acc: string): number {
  const base = LETTER_PC[letter.toUpperCase()];
  const shift = acc === "#" || acc === "♯" ? 1 : acc === "b" || acc === "♭" ? -1 : 0;
  return mod(base + shift, 12);
}

/**
 * Read chord names typed from a song chart ("Am F C G", "Dm7 G7 Cmaj7", "G/B").
 * Throws, naming the chord, when one isn't a chord this app knows.
 */
export function parseChords(text: string): ParsedChord[] {
  const tokens = text.split(/[\s,|]+/).filter(Boolean);
  return tokens.map((tok) => {
    const m = tok.match(/^([A-Ga-g])([#b♯♭]?)(.*?)(?:\/([A-Ga-g])([#b♯♭]?))?$/);
    if (!m) throw new Error(`"${tok}" isn't a chord name this app knows. Try names like Am, F, C7, Dm7, Bbmaj7 or G/B.`);
    const root = notePc(m[1], m[2]);
    const raw = m[3];
    const symbol = raw in ALIASES ? ALIASES[raw] : raw;
    const chord = CHORDS.findIndex((c) => c.symbol === symbol);
    if (chord < 0) throw new Error(`"${tok}" isn't a chord name this app knows. Try names like Am, F, C7, Dm7, Bbmaj7 or G/B.`);
    const bass = m[4] ? notePc(m[4], m[5]) : root;
    return { root, chord, symbol, bass, text: tok };
  });
}

/** Every pitch class the chords hold, their bass notes included. */
export function chordsPcs(chords: ParsedChord[]): number[] {
  const out: number[] = [];
  for (const c of chords) {
    for (const p of [...pcsOf(c.root, CHORDS[c.chord].tones.map((t) => t.semis)), c.bass]) if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** A shape written the way chord charts do, lowest string first: x32010. */
export function shapeText(frets: (number | null)[]): string {
  return frets.map((f) => (f === null ? "x" : f > 9 ? `(${f})` : String(f))).join("");
}
