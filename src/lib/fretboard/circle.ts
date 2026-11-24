// The circle of fifths: keys in fifths order, key signatures, the seven modes that
// share a key's notes, and the chords a key borrows or leans on.

import { CHORDS, KEYS, chordIndex, diatonicChords, findScale, roman, type ScaleDef } from "./theory";

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Major keys clockwise from C (pitch classes). */
export const CIRCLE = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
export const CIRCLE_MAJORS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
/** The other spelling of the keys at the bottom of the circle. */
export const CIRCLE_ALT: Record<number, string> = { 11: "Cb", 6: "Gb", 1: "C#" };
export const CIRCLE_MINORS = ["Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "Bbm", "Fm", "Cm", "Gm", "Dm"];
export const CIRCLE_DIMS = ["B°", "F#°", "C#°", "G#°", "D#°", "A#°", "E#°", "C°", "G°", "D°", "A°", "E°"];

const SHARP_ORDER = ["F#", "C#", "G#", "D#", "A#", "E#", "B#"];
const FLAT_ORDER = ["Bb", "Eb", "Ab", "Db", "Gb", "Cb", "Fb"];
const SHARPS: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6 };
const FLATS: Record<number, number> = { 5: 1, 10: 2, 3: 3, 8: 4, 1: 5 };

export interface KeySignature {
  count: number;
  kind: "none" | "sharps" | "flats";
  notes: string[];
  text: string;
}

/** The key signature of a major key (pitch class), as usually written. */
export function keySignature(majorPc: number): KeySignature {
  const pc = mod(majorPc, 12);
  if (pc === 0) return { count: 0, kind: "none", notes: [], text: "no sharps or flats" };
  if (pc in SHARPS) {
    const n = SHARPS[pc];
    return { count: n, kind: "sharps", notes: SHARP_ORDER.slice(0, n), text: `${n} sharp${n === 1 ? "" : "s"}` };
  }
  const n = FLATS[pc];
  return { count: n, kind: "flats", notes: FLAT_ORDER.slice(0, n), text: `${n} flat${n === 1 ? "" : "s"}` };
}

export interface ModeDef {
  name: string;
  /** The scale in the app's scale list. */
  scale: string;
  /** Semitones from the mode's root up to the major key it shares notes with. */
  parent: number;
  formula: string;
  flavour: string;
  sound: string;
}

/** The seven modes, brightest to darkest. */
export const MODES: ModeDef[] = [
  { name: "Lydian", scale: "Lydian", parent: 7, formula: "1 2 3 #4 5 6 7", flavour: "#4", sound: "Major with a raised 4th: airy, floating, a little unreal." },
  { name: "Ionian", scale: "Major (Ionian)", parent: 0, formula: "1 2 3 4 5 6 7", flavour: "–", sound: "The major scale: bright and at rest. I, IV and V carry most songs, and V pulls back home." },
  { name: "Mixolydian", scale: "Mixolydian", parent: 5, formula: "1 2 3 4 5 6 b7", flavour: "b7", sound: "Major with a flat 7th: loose and bluesy, the sound of a lot of rock." },
  { name: "Dorian", scale: "Dorian", parent: 10, formula: "1 2 b3 4 5 6 b7", flavour: "6", sound: "Minor with a natural 6th: minor but hopeful, at home in funk and jazz." },
  { name: "Aeolian", scale: "Natural Minor (Aeolian)", parent: 3, formula: "1 2 b3 4 5 b6 b7", flavour: "b6", sound: "The natural minor scale: serious or sad, the usual minor sound in rock and ballads." },
  { name: "Phrygian", scale: "Phrygian", parent: 8, formula: "1 b2 b3 4 5 b6 b7", flavour: "b2", sound: "Minor with a flat 2nd just above the root: dark, with a Spanish or metal edge." },
  { name: "Locrian", scale: "Locrian", parent: 1, formula: "1 b2 b3 4 b5 b6 b7", flavour: "b5", sound: "Its 5th is flat, so the home chord is diminished: tense and unsettled." },
];

export const modeDef = (name: string): ModeDef => MODES.find((m) => m.name === name) ?? MODES[1];

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

function spellFrom(rootLetter: number, rootPc: number, semis: number, degree: number): string {
  const letter = (rootLetter + degree) % 7;
  const target = mod(rootPc + semis, 12);
  let acc = mod(target - LETTER_PC[letter], 12);
  if (acc > 6) acc -= 12;
  const accs: Record<number, string> = { [-2]: "bb", [-1]: "b", 0: "", 1: "#", 2: "##" };
  return LETTERS[letter] + (accs[acc] ?? "?");
}

const accidentals = (names: string[]) => names.join("").replace(/[A-G]/g, "").length;

/** The letter to name a root by: whichever spelling (C# or Db) gives the scale fewer sharps and flats. */
function rootLetter(rootPc: number, scale: ScaleDef): number {
  const pc = mod(rootPc, 12);
  const natural = LETTER_PC.indexOf(pc);
  if (natural >= 0) return natural;
  const flat = LETTER_PC.indexOf(mod(pc + 1, 12));
  const sharp = LETTER_PC.indexOf(mod(pc - 1, 12));
  const names = (l: number) => scale.tones.map((t, i) => spellFrom(l, pc, t.semis, i));
  const [f, s] = [accidentals(names(flat)), accidentals(names(sharp))];
  if (f !== s) return f < s ? flat : sharp;
  return KEYS[pc].includes("#") ? sharp : flat;
}

export interface KeyChord {
  name: string;
  roman: string;
  root: number;
  /** Index into CHORDS. */
  chord: number;
}

export interface ModeKey {
  root: number;
  mode: ModeDef;
  /** The major key (pitch class) with the same notes. */
  parent: number;
  rootName: string;
  /** "G major", "E minor", "D Dorian". */
  name: string;
  scale: ScaleDef;
  notes: string[];
  chords: KeyChord[];
}

export function modeKey(root: number, mode: string, sevenths: boolean): ModeKey {
  const def = modeDef(mode);
  const scale = findScale(def.scale);
  const pc = mod(root, 12);
  const letter = rootLetter(pc, scale);
  const notes = scale.tones.map((t, i) => spellFrom(letter, pc, t.semis, i));
  const rootName = notes[0];
  const name = def.name === "Ionian" ? `${rootName} major` : def.name === "Aeolian" ? `${rootName} minor` : `${rootName} ${def.name}`;
  const chords = diatonicChords(scale.tones, sevenths).map(([d, ci]) => ({
    name: notes[d] + CHORDS[ci].symbol,
    roman: roman(d, CHORDS[ci]),
    root: mod(pc + scale.tones[d].semis, 12),
    chord: ci,
  }));
  return { root: pc, mode: def, parent: mod(pc + def.parent, 12), rootName, name, scale, notes, chords };
}

/** The modes that share a key's notes, brightest first: [root, mode name]. */
export function relatedModes(parent: number): [number, string][] {
  return MODES.map((m) => [mod(parent - m.parent, 12), m.name]);
}

/**
 * Chords a key commonly borrows. A major key takes iv, bIII, bVI and bVII from the minor key
 * on the same root; a minor key takes the major V (and V7) from harmonic minor and IV from Dorian.
 */
export function borrowedChords(root: number, mode: string): KeyChord[] {
  const list: [number, number, string, string][] =
    mode === "Ionian"
      ? [[5, 3, "m", "iv"], [3, 2, "", "bIII"], [8, 5, "", "bVI"], [10, 6, "", "bVII"]]
      : mode === "Aeolian"
        ? [[7, 4, "", "V"], [7, 4, "7", "V7"], [5, 3, "", "IV"]]
        : [];
  const m = modeKey(root, mode, false);
  const letter = LETTERS.indexOf(m.rootName[0]);
  return list.map(([semis, degree, symbol, rn]) => ({
    name: spellFrom(letter, m.root, semis, degree) + symbol,
    roman: rn,
    root: mod(m.root + semis, 12),
    chord: chordIndex(symbol),
  }));
}

/** The V7 of each major or minor chord in the key (not the home chord): A7 is V7/ii in C major. */
export function secondaryDominants(root: number, mode: string): KeyChord[] {
  const m = modeKey(root, mode, false);
  const letter = LETTERS.indexOf(m.rootName[0]);
  const out: KeyChord[] = [];
  diatonicChords(m.scale.tones, false).forEach(([d, ci]) => {
    const sym = CHORDS[ci].symbol;
    if (d === 0 || (sym !== "" && sym !== "m")) return;
    const semis = m.scale.tones[d].semis + 7;
    out.push({
      name: spellFrom(letter, m.root, semis, d + 4) + "7",
      roman: `V7/${roman(d, CHORDS[ci])}`,
      root: mod(m.root + semis, 12),
      chord: chordIndex("7"),
    });
  });
  return out;
}
