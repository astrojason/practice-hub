import type { DashboardData } from "../../api/types";
import { CHORDS, SCALES, chordIndex } from "./theory";
import type { ProgChord } from "./progression";

/** What the Instrumenta dashboard suggests the user practise, translated into this trainer's own choices. */
export interface Suggestions {
  key?: number;
  scaleIdx?: number;
  chordIdx?: number;
  progression?: { name: string; chords: ProgChord[] };
}

/** "B&#9837;" / "F&#35;" / "B♭" → "Bb" / "F#". */
function plainNote(name: string): string {
  return name
    .replace(/&#9837;|♭/g, "b")
    .replace(/&#35;|&#9839;|♯/g, "#")
    .replace(/\s*(major|minor)\s*$/i, "")
    .trim();
}

const NOTE_SEMIS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Index into KEYS for a key name such as "G", "F#", "B♭" or "Cb"; undefined if it isn't a note. */
export function keyIndexFor(name: string): number | undefined {
  const m = /^([A-G])([#b]?)$/.exec(plainNote(name));
  if (!m) return undefined;
  const semis = (NOTE_SEMIS[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  return semis; // KEYS is in half steps from C, so the index is the pitch class
}

// Names Instrumenta uses that differ from this trainer's.
const SCALE_ALIASES: Record<string, string> = {
  "ionian (major)": "Major (Ionian)",
  "aeolean (natural minor)": "Natural Minor (Aeolian)",
  "aeolian (natural minor)": "Natural Minor (Aeolian)",
  "minor blues": "Blues",
  diminished: "Diminished (Whole-Half)",
};

export function scaleIndexFor(name: string): number | undefined {
  const want = (SCALE_ALIASES[name.trim().toLowerCase()] ?? name).trim().toLowerCase();
  const i = SCALES.findIndex((s) => s.name.toLowerCase() === want);
  return i >= 0 ? i : undefined;
}

const CHORD_ALIASES: Record<string, string> = {
  "minor 7th (b5)": "Half-diminished (m7b5)",
  "minor 7th (♭5)": "Half-diminished (m7b5)",
  "half-diminished": "Half-diminished (m7b5)",
};

export function chordIndexFor(name: string): number | undefined {
  const plain = plainNote(name).toLowerCase();
  const wanted = CHORD_ALIASES[plain] ?? plain.replace(/(\d+)(st|nd|rd|th)\b/g, "$1");
  const i = CHORDS.findIndex((c) => c.name.toLowerCase() === wanted.toLowerCase());
  return i >= 0 ? i : undefined;
}

const ROMAN: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
const MAJOR_SEMIS = [0, 2, 4, 5, 7, 9, 11];

/** A roman numeral like "ii", "V7", "bVII" or "vii°" as a chord above the key. */
export function numeralChord(numeral: string): ProgChord | undefined {
  const m = /^(b|#|♭|♯|&#9837;|&#35;)?([ivIV]+)(°|o|dim|maj7|m7b5|7|6|sus4|sus2)?$/.exec(numeral.trim());
  if (!m) return undefined;
  const degree = ROMAN[m[2].toLowerCase()];
  if (degree === undefined) return undefined;
  const lower = m[2] === m[2].toLowerCase();
  const shift = m[1] === "b" || m[1] === "♭" || m[1] === "&#9837;" ? -1 : m[1] ? 1 : 0;
  const ext = m[3] ?? "";
  let symbol: string;
  if (ext === "°" || ext === "o" || ext === "dim") symbol = "dim";
  else if (ext === "7") symbol = lower ? "m7" : "7";
  else if (ext === "maj7") symbol = "maj7";
  else if (ext === "m7b5") symbol = "m7b5";
  else if (ext) symbol = ext;
  else symbol = lower ? "m" : "";
  return { semis: (MAJOR_SEMIS[degree] + shift + 12) % 12, chord: chordIndex(symbol), beats: 0 };
}

/** The scale, key, chord and progression cards on the dashboard, as defaults for the trainer. */
export function suggestionsFrom(dash: DashboardData | null | undefined): Suggestions {
  if (!dash) return {};
  const out: Suggestions = {};
  if (dash.key_signature) out.key = keyIndexFor(dash.key_signature.name);
  if (dash.scale) out.scaleIdx = scaleIndexFor(dash.scale.name);
  if (dash.chord) out.chordIdx = chordIndexFor(dash.chord.name);
  if (dash.progression) {
    const chords = dash.progression.chords.map(numeralChord);
    if (chords.length > 0 && chords.every((c): c is ProgChord => c !== undefined)) {
      out.progression = { name: dash.progression.name, chords };
    }
  }
  return out;
}
