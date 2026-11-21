// Understanding spoken quiz answers: what a phrase from the speech recogniser asks for
// ("C sharp", "flat three", "minor third", "minor seven", "next", "again").
// Ported from the Craft app's quiz module.

import { BOTH_NAMES, KEYS } from "./theory";
import { INTERVALS, type QuizKind } from "./quiz";

export type SpokenCommand = "next" | "again" | "stop";

/** Words the speech recogniser is told to expect, so it leans towards them. */
export function spokenVocabulary(kind: QuizKind): string[] {
  const v = ["next", "again", "hear it", "stop"];
  switch (kind) {
    case "note":
      for (const l of ["C", "D", "E", "F", "G", "A", "B"]) v.push(l, `${l} sharp`, `${l} flat`);
      v.push("ay", "alpha", "alpha flat", "alpha sharp", "bravo", "charlie", "delta", "echo", "foxtrot", "golf");
      break;
    case "degree":
      v.push("root", "flat two", "two", "flat three", "three", "four", "sharp four", "flat five", "five", "sharp five", "flat six", "six", "flat seven", "seven");
      break;
    case "interval":
    case "earinterval":
      v.push(...INTERVALS);
      break;
    case "earchord":
      v.push("major", "minor", "diminished", "augmented", "dominant seven", "major seven", "minor seven");
      break;
  }
  return v;
}

/** Lower-case words with sharps, flats and number endings split out: "C#" → "c sharp", "b3" → "flat 3", "5th" → "5". */
export function spokenWords(text: string): string[] {
  const t = text.toLowerCase().replace(/♯/g, " sharp ").replace(/#/g, " sharp ").replace(/♭/g, " flat ");
  const clean = [...t].map((c) => (/[\p{L}\p{N}]/u.test(c) || c === " " ? c : " ")).join("");
  const out: string[] = [];
  for (const w of clean.split(/\s+/).filter(Boolean)) {
    // A letter with a flat written as "b": "eb", "bb", "ab" (but not the word "b" itself).
    if (w.length === 2 && w.endsWith("b") && "abcdefg".includes(w[0])) {
      out.push(w[0], "flat");
      continue;
    }
    // "b3", "#4" style degrees ("#" already became "sharp").
    if (w.length >= 2 && w.startsWith("b") && /^\d+$/.test(w.slice(1))) {
      out.push("flat", w.slice(1));
      continue;
    }
    // "3rd", "5th", "2nd", "1st".
    const digits = /^\d+/.exec(w)?.[0] ?? "";
    if (digits && ["st", "nd", "rd", "th", ""].includes(w.slice(digits.length))) {
      out.push(digits);
      continue;
    }
    out.push(w);
  }
  return out;
}

const LETTERS: Record<string, number> = {
  // The letters, how they sound, and the radio alphabet ("alpha flat") for when a letter is misheard.
  c: 0, see: 0, sea: 0, si: 0, charlie: 0,
  d: 2, dee: 2, delta: 2,
  e: 4, ee: 4, echo: 4,
  f: 5, eff: 5, ef: 5, foxtrot: 5,
  g: 7, gee: 7, jee: 7, golf: 7,
  a: 9, ay: 9, eh: 9, hey: 9, alpha: 9, alfa: 9,
  b: 11, be: 11, bee: 11, bravo: 11,
};
const ACCIDENTALS: Record<string, number> = { sharp: 1, sharps: 1, shop: 1, sharpe: 1, flat: -1, flats: -1, flap: -1 };
const NUMBERS: Record<string, number> = {
  "1": 1, one: 1, won: 1, first: 1, root: 1, unison: 1,
  "2": 2, two: 2, to: 2, too: 2, second: 2,
  "3": 3, three: 3, third: 3, free: 3, tree: 3,
  "4": 4, four: 4, for: 4, fourth: 4, forth: 4,
  "5": 5, five: 5, fifth: 5,
  "6": 6, six: 6, sixth: 6, sex: 6,
  "7": 7, seven: 7, seventh: 7,
  "8": 8, eight: 8, octave: 8, eighth: 8,
  "9": 9, nine: 9, ninth: 9,
  "11": 11, eleven: 11, eleventh: 11,
  "13": 13, thirteen: 13, thirteenth: 13,
};

const letterOf = (w: string) => (w in LETTERS ? LETTERS[w] : null);
const accidentalOf = (w: string | undefined) => (w !== undefined && w in ACCIDENTALS ? ACCIDENTALS[w] : null);
const numberOf = (w: string | undefined) => (w !== undefined && w in NUMBERS ? NUMBERS[w] : null);
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** The first note name in the words: a letter, optionally followed by sharp or flat. */
function spokenNote(words: string[]): number | null {
  for (let i = 0; i < words.length; i++) {
    const pc = letterOf(words[i]);
    if (pc !== null) return mod(pc + (accidentalOf(words[i + 1]) ?? 0), 12);
  }
  return null;
}

const has = (words: string[], options: string[]) => words.some((w) => options.includes(w));

/** An interval in half steps from "minor third", "perfect 5th", "tritone", "octave"… */
function spokenInterval(words: string[]): number | null {
  if (has(words, ["tritone", "tritones"]) || (has(words, ["tri", "try"]) && has(words, ["tone", "tones"]))) return 6;
  if (has(words, ["octave", "octaves"])) return 12;
  const minor = has(words, ["minor", "miner", "mina"]);
  const major = has(words, ["major", "mayor", "measure"]);
  const aug = has(words, ["augmented", "aug"]);
  const dim = has(words, ["diminished", "dim"]);
  let n: number | null = null;
  for (const w of words) {
    if (["to", "too", "for"].includes(w)) continue;
    n = numberOf(w);
    if (n !== null) break;
  }
  if (n === null) return null;
  switch (n) {
    case 2: return minor ? 1 : major ? 2 : null;
    case 3: return minor ? 3 : major ? 4 : null;
    case 4: return aug ? 6 : 5;
    case 5: return dim ? 6 : 7;
    case 6: return minor ? 8 : major ? 9 : null;
    case 7: return minor ? 10 : major ? 11 : null;
    case 8: return 12;
    default: return null;
  }
}

/** A scale degree label from "flat three", "b3", "sharp four", "root", "minor third"… and whether it was exact. */
function spokenDegree(words: string[]): { label: string; exact: boolean } | null {
  if (has(words, ["minor", "major", "perfect", "augmented", "diminished", "tritone"])) {
    const semis = spokenInterval(words);
    if (semis === null) return null;
    const L = ["b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7", "1"];
    return { label: L[semis - 1], exact: true };
  }
  for (let i = 0; i < words.length; i++) {
    const acc = accidentalOf(words[i]);
    if (acc !== null) {
      const n = numberOf(words[i + 1]);
      if (n !== null) return { label: `${acc < 0 ? "b" : "#"}${n}`, exact: true };
    }
    const n = numberOf(words[i]);
    if (n !== null) return { label: String(n), exact: false };
  }
  return null;
}

const labelOf = (c: string) => c.split("  (")[0].trim();
const stripAcc = (s: string) => s.replace(/^[b#]+/, "");

function answerOne(kind: QuizKind, choices: string[], words: string[]): number | null {
  if (words.length === 0) return null;
  const found = (i: number) => (i >= 0 ? i : null);
  switch (kind) {
    case "note": {
      const pc = spokenNote(words);
      if (pc === null) return null;
      return found(choices.findIndex((c) => BOTH_NAMES.indexOf(c) === pc || KEYS.indexOf(c as (typeof KEYS)[number]) === pc));
    }
    case "degree": {
      const d = spokenDegree(words);
      if (d) {
        const i = choices.findIndex((c) => labelOf(c) === d.label);
        if (i >= 0) return i;
        if (!d.exact) {
          // Only a number was said: fine when the scale has just one degree with that number.
          const n = stripAcc(d.label);
          const hits = choices.map((c, k) => (stripAcc(labelOf(c)) === n ? k : -1)).filter((k) => k >= 0);
          if (hits.length === 1) return hits[0];
        }
      }
      // The note's name works too ("E flat" for the b3 of C).
      const pc = spokenNote(words);
      if (pc === null) return null;
      return found(
        choices.findIndex((c) => {
          const note = (c.split("  (")[1] ?? "").replace(/\)$/, "").trim();
          return spokenNote(spokenWords(note)) === pc;
        }),
      );
    }
    case "interval":
    case "earinterval": {
      const semis = spokenInterval(words);
      if (semis === null) return null;
      return found(choices.indexOf(INTERVALS[semis - 1]));
    }
    case "earchord": {
      const seventh = words.some((w) => numberOf(w) === 7);
      const minor = has(words, ["minor", "miner", "mina"]);
      const major = has(words, ["major", "mayor", "measure"]);
      let name: string;
      if (seventh) name = major ? "Major 7" : minor ? "Minor 7" : "Dominant 7";
      else if (has(words, ["diminished", "dim"])) name = "Diminished";
      else if (has(words, ["augmented", "aug"])) name = "Augmented";
      else if (minor) name = "Minor";
      else if (major) name = "Major";
      else return null;
      return found(choices.indexOf(name));
    }
  }
}

/** Which answer a spoken phrase picks, trying each of the recogniser's guesses in turn. */
export function spokenAnswer(kind: QuizKind, choices: string[], guesses: string[]): number | null {
  // The recogniser's alternatives often include the right one when its first guess is wrong
  // ("B flat" for "A flat"), so the answer most guesses agree on wins; ties go to the best guess.
  const votes = new Map<number, number>();
  const order: number[] = [];
  for (const g of guesses) {
    const r = answerOne(kind, choices, spokenWords(g));
    if (r === null) continue;
    if (!votes.has(r)) order.push(r);
    votes.set(r, (votes.get(r) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const r of order) if (best === null || (votes.get(r) ?? 0) > (votes.get(best) ?? 0)) best = r;
  return best;
}

/** "next" moves on, "again" / "hear it" plays the question again, "stop" ends the session. */
export function spokenCommand(guesses: string[]): SpokenCommand | null {
  for (const g of guesses) {
    const w = spokenWords(g);
    if (has(w, ["stop", "finish", "quit", "end"])) return "stop";
    if (has(w, ["next", "skip", "continue"])) return "next";
    if (has(w, ["again", "repeat", "replay", "hear"])) return "again";
  }
  return null;
}

// ── Speaking: how a note, degree or key is said aloud ──

const LETTER_SOUNDS: Record<string, string> = { A: "ay", B: "bee", C: "see", D: "dee", E: "ee", F: "eff", G: "gee" };

/** "Bb" → "bee flat", "F#" → "eff sharp", so a speech voice says the letter rather than a word. */
export function spokenNoteName(name: string): string {
  const letter = LETTER_SOUNDS[name[0]] ?? name[0];
  const rest = name.slice(1).replace(/##/g, " double sharp").replace(/bb/g, " double flat").replace(/#/g, " sharp").replace(/b/g, " flat");
  return `${letter}${rest}`;
}

/** "b3" → "flat three", "R" → "root". */
export function spokenDegreeName(label: string): string {
  if (label === "R" || label === "1") return "root";
  const names = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen"];
  const n = parseInt(label.replace(/\D/g, ""), 10);
  const acc = label.replace(/\d/g, "").replace(/##/g, "double sharp ").replace(/bb/g, "double flat ").replace(/#/g, "sharp ").replace(/b/g, "flat ");
  return `${acc}${names[n] ?? label}`.trim();
}
