// Music theory for the Theory Training: keys, spelling, scales, chords, guitar
// positions and chord voicings. Ported from the Craft "visual scale, arpeggio,
// chord" app's theory module.

export const NUM_FRETS = 22;

/** The 12 keys offered, with their usual spelling. */
export const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const FLAT_NAMES = KEYS;
export const BOTH_NAMES = ["C", "C#/Db", "D", "D#/Eb", "E", "F", "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"];

const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface Tone {
  semis: number;
  label: string;
}

function tones(pairs: [number, string][]): Tone[] {
  return pairs.map(([semis, label]) => ({ semis, label }));
}

export interface ScaleDef {
  group: string;
  name: string;
  tones: Tone[];
}

export interface ChordDef {
  group: string;
  name: string;
  symbol: string;
  tones: Tone[];
}

export interface ProgPreset {
  name: string;
  chords: [number, string][];
  scale: string;
}

export const SCALES: ScaleDef[] = [
  { group: "Major-sounding modes", name: "Major (Ionian)", tones: tones([[0, "1"], [2, "2"], [4, "3"], [5, "4"], [7, "5"], [9, "6"], [11, "7"]]) },
  { group: "Major-sounding modes", name: "Lydian", tones: tones([[0, "1"], [2, "2"], [4, "3"], [6, "#4"], [7, "5"], [9, "6"], [11, "7"]]) },
  { group: "Major-sounding modes", name: "Mixolydian", tones: tones([[0, "1"], [2, "2"], [4, "3"], [5, "4"], [7, "5"], [9, "6"], [10, "b7"]]) },
  { group: "Minor-sounding modes", name: "Natural Minor (Aeolian)", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [5, "4"], [7, "5"], [8, "b6"], [10, "b7"]]) },
  { group: "Minor-sounding modes", name: "Dorian", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [5, "4"], [7, "5"], [9, "6"], [10, "b7"]]) },
  { group: "Minor-sounding modes", name: "Phrygian", tones: tones([[0, "1"], [1, "b2"], [3, "b3"], [5, "4"], [7, "5"], [8, "b6"], [10, "b7"]]) },
  { group: "Minor-sounding modes", name: "Locrian", tones: tones([[0, "1"], [1, "b2"], [3, "b3"], [5, "4"], [6, "b5"], [8, "b6"], [10, "b7"]]) },
  { group: "Pentatonic & blues", name: "Major Pentatonic", tones: tones([[0, "1"], [2, "2"], [4, "3"], [7, "5"], [9, "6"]]) },
  { group: "Pentatonic & blues", name: "Minor Pentatonic", tones: tones([[0, "1"], [3, "b3"], [5, "4"], [7, "5"], [10, "b7"]]) },
  { group: "Pentatonic & blues", name: "Blues", tones: tones([[0, "1"], [3, "b3"], [5, "4"], [6, "b5"], [7, "5"], [10, "b7"]]) },
  { group: "Pentatonic & blues", name: "Major Blues", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [4, "3"], [7, "5"], [9, "6"]]) },
  { group: "Pentatonic & blues", name: "Dominant Pentatonic", tones: tones([[0, "1"], [2, "2"], [4, "3"], [7, "5"], [10, "b7"]]) },
  { group: "Pentatonic & blues", name: "Suspended (Egyptian) Pentatonic", tones: tones([[0, "1"], [2, "2"], [5, "4"], [7, "5"], [10, "b7"]]) },
  { group: "Pentatonic & blues", name: "Minor 6 Pentatonic", tones: tones([[0, "1"], [3, "b3"], [5, "4"], [7, "5"], [9, "6"]]) },
  { group: "Pentatonic & blues", name: "Hirajoshi", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [7, "5"], [8, "b6"]]) },
  { group: "Pentatonic & blues", name: "In Sen", tones: tones([[0, "1"], [1, "b2"], [5, "4"], [7, "5"], [10, "b7"]]) },
  { group: "Pentatonic & blues", name: "Iwato", tones: tones([[0, "1"], [1, "b2"], [5, "4"], [6, "b5"], [10, "b7"]]) },
  { group: "Pentatonic & blues", name: "Kumoi", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [7, "5"], [9, "6"]]) },
  { group: "Pentatonic & blues", name: "Yo", tones: tones([[0, "1"], [2, "2"], [5, "4"], [7, "5"], [9, "6"]]) },
  { group: "Harmonic minor family", name: "Harmonic Minor", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [5, "4"], [7, "5"], [8, "b6"], [11, "7"]]) },
  { group: "Harmonic minor family", name: "Locrian #6", tones: tones([[0, "1"], [1, "b2"], [3, "b3"], [5, "4"], [6, "b5"], [9, "6"], [10, "b7"]]) },
  { group: "Harmonic minor family", name: "Ionian #5", tones: tones([[0, "1"], [2, "2"], [4, "3"], [5, "4"], [8, "#5"], [9, "6"], [11, "7"]]) },
  { group: "Harmonic minor family", name: "Dorian #4 (Ukrainian Dorian)", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [6, "#4"], [7, "5"], [9, "6"], [10, "b7"]]) },
  { group: "Harmonic minor family", name: "Phrygian Dominant", tones: tones([[0, "1"], [1, "b2"], [4, "3"], [5, "4"], [7, "5"], [8, "b6"], [10, "b7"]]) },
  { group: "Harmonic minor family", name: "Lydian #2", tones: tones([[0, "1"], [3, "#2"], [4, "3"], [6, "#4"], [7, "5"], [9, "6"], [11, "7"]]) },
  { group: "Harmonic minor family", name: "Super Locrian bb7", tones: tones([[0, "1"], [1, "b2"], [3, "b3"], [4, "b4"], [6, "b5"], [8, "b6"], [9, "bb7"]]) },
  { group: "Melodic minor family", name: "Melodic Minor", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [5, "4"], [7, "5"], [9, "6"], [11, "7"]]) },
  { group: "Melodic minor family", name: "Dorian b2", tones: tones([[0, "1"], [1, "b2"], [3, "b3"], [5, "4"], [7, "5"], [9, "6"], [10, "b7"]]) },
  { group: "Melodic minor family", name: "Lydian Augmented", tones: tones([[0, "1"], [2, "2"], [4, "3"], [6, "#4"], [8, "#5"], [9, "6"], [11, "7"]]) },
  { group: "Melodic minor family", name: "Lydian Dominant", tones: tones([[0, "1"], [2, "2"], [4, "3"], [6, "#4"], [7, "5"], [9, "6"], [10, "b7"]]) },
  { group: "Melodic minor family", name: "Mixolydian b6", tones: tones([[0, "1"], [2, "2"], [4, "3"], [5, "4"], [7, "5"], [8, "b6"], [10, "b7"]]) },
  { group: "Melodic minor family", name: "Locrian #2 (Half-diminished)", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [5, "4"], [6, "b5"], [8, "b6"], [10, "b7"]]) },
  { group: "Melodic minor family", name: "Altered (Super Locrian)", tones: tones([[0, "1"], [1, "b2"], [3, "#2"], [4, "3"], [6, "b5"], [8, "#5"], [10, "b7"]]) },
  { group: "Harmonic major & exotic", name: "Harmonic Major", tones: tones([[0, "1"], [2, "2"], [4, "3"], [5, "4"], [7, "5"], [8, "b6"], [11, "7"]]) },
  { group: "Harmonic major & exotic", name: "Double Harmonic (Byzantine)", tones: tones([[0, "1"], [1, "b2"], [4, "3"], [5, "4"], [7, "5"], [8, "b6"], [11, "7"]]) },
  { group: "Harmonic major & exotic", name: "Hungarian Minor", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [6, "#4"], [7, "5"], [8, "b6"], [11, "7"]]) },
  { group: "Harmonic major & exotic", name: "Hungarian Major", tones: tones([[0, "1"], [3, "#2"], [4, "3"], [6, "#4"], [7, "5"], [9, "6"], [10, "b7"]]) },
  { group: "Harmonic major & exotic", name: "Neapolitan Major", tones: tones([[0, "1"], [1, "b2"], [3, "b3"], [5, "4"], [7, "5"], [9, "6"], [11, "7"]]) },
  { group: "Harmonic major & exotic", name: "Neapolitan Minor", tones: tones([[0, "1"], [1, "b2"], [3, "b3"], [5, "4"], [7, "5"], [8, "b6"], [11, "7"]]) },
  { group: "Harmonic major & exotic", name: "Persian", tones: tones([[0, "1"], [1, "b2"], [4, "3"], [5, "4"], [6, "b5"], [8, "b6"], [11, "7"]]) },
  { group: "Harmonic major & exotic", name: "Enigmatic", tones: tones([[0, "1"], [1, "b2"], [4, "3"], [6, "#4"], [8, "#5"], [10, "#6"], [11, "7"]]) },
  { group: "Harmonic major & exotic", name: "Spanish 8-tone", tones: tones([[0, "1"], [1, "b2"], [3, "#2"], [4, "3"], [5, "4"], [6, "b5"], [8, "b6"], [10, "b7"]]) },
  { group: "Harmonic major & exotic", name: "Prometheus", tones: tones([[0, "1"], [2, "2"], [4, "3"], [6, "#4"], [9, "6"], [10, "b7"]]) },
  { group: "Harmonic major & exotic", name: "Tritone", tones: tones([[0, "1"], [1, "b2"], [4, "3"], [6, "b5"], [7, "5"], [10, "b7"]]) },
  { group: "Bebop", name: "Bebop Dominant", tones: tones([[0, "1"], [2, "2"], [4, "3"], [5, "4"], [7, "5"], [9, "6"], [10, "b7"], [11, "7"]]) },
  { group: "Bebop", name: "Bebop Major", tones: tones([[0, "1"], [2, "2"], [4, "3"], [5, "4"], [7, "5"], [8, "#5"], [9, "6"], [11, "7"]]) },
  { group: "Bebop", name: "Bebop Dorian", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [4, "3"], [5, "4"], [7, "5"], [9, "6"], [10, "b7"]]) },
  { group: "Bebop", name: "Bebop Melodic Minor", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [5, "4"], [7, "5"], [8, "#5"], [9, "6"], [11, "7"]]) },
  { group: "Symmetric", name: "Whole Tone", tones: tones([[0, "1"], [2, "2"], [4, "3"], [6, "#4"], [8, "#5"], [10, "b7"]]) },
  { group: "Symmetric", name: "Diminished (Whole-Half)", tones: tones([[0, "1"], [2, "2"], [3, "b3"], [5, "4"], [6, "b5"], [8, "#5"], [9, "6"], [11, "7"]]) },
  { group: "Symmetric", name: "Diminished (Half-Whole)", tones: tones([[0, "1"], [1, "b2"], [3, "#2"], [4, "3"], [6, "#4"], [7, "5"], [9, "6"], [10, "b7"]]) },
  { group: "Symmetric", name: "Augmented", tones: tones([[0, "1"], [3, "#2"], [4, "3"], [7, "5"], [8, "#5"], [11, "7"]]) },
  { group: "Symmetric", name: "Chromatic", tones: tones([[0, "1"], [1, "b2"], [2, "2"], [3, "b3"], [4, "3"], [5, "4"], [6, "b5"], [7, "5"], [8, "b6"], [9, "6"], [10, "b7"], [11, "7"]]) },
];

export const CHORDS: ChordDef[] = [
  { group: "Triads", name: "Major", symbol: "", tones: tones([[0, "1"], [4, "3"], [7, "5"]]) },
  { group: "Triads", name: "Minor", symbol: "m", tones: tones([[0, "1"], [3, "b3"], [7, "5"]]) },
  { group: "Triads", name: "Diminished", symbol: "dim", tones: tones([[0, "1"], [3, "b3"], [6, "b5"]]) },
  { group: "Triads", name: "Augmented", symbol: "aug", tones: tones([[0, "1"], [4, "3"], [8, "#5"]]) },
  { group: "Triads", name: "Sus2", symbol: "sus2", tones: tones([[0, "1"], [2, "2"], [7, "5"]]) },
  { group: "Triads", name: "Sus4", symbol: "sus4", tones: tones([[0, "1"], [5, "4"], [7, "5"]]) },
  { group: "Triads", name: "Power chord", symbol: "5", tones: tones([[0, "1"], [7, "5"]]) },
  { group: "Sixths & sevenths", name: "Major 6", symbol: "6", tones: tones([[0, "1"], [4, "3"], [7, "5"], [9, "6"]]) },
  { group: "Sixths & sevenths", name: "Minor 6", symbol: "m6", tones: tones([[0, "1"], [3, "b3"], [7, "5"], [9, "6"]]) },
  { group: "Sixths & sevenths", name: "Major 7", symbol: "maj7", tones: tones([[0, "1"], [4, "3"], [7, "5"], [11, "7"]]) },
  { group: "Sixths & sevenths", name: "Dominant 7", symbol: "7", tones: tones([[0, "1"], [4, "3"], [7, "5"], [10, "b7"]]) },
  { group: "Sixths & sevenths", name: "Minor 7", symbol: "m7", tones: tones([[0, "1"], [3, "b3"], [7, "5"], [10, "b7"]]) },
  { group: "Sixths & sevenths", name: "Half-diminished (m7b5)", symbol: "m7b5", tones: tones([[0, "1"], [3, "b3"], [6, "b5"], [10, "b7"]]) },
  { group: "Sixths & sevenths", name: "Diminished 7", symbol: "dim7", tones: tones([[0, "1"], [3, "b3"], [6, "b5"], [9, "bb7"]]) },
  { group: "Sixths & sevenths", name: "Minor-major 7", symbol: "m(maj7)", tones: tones([[0, "1"], [3, "b3"], [7, "5"], [11, "7"]]) },
  { group: "Sixths & sevenths", name: "7sus4", symbol: "7sus4", tones: tones([[0, "1"], [5, "4"], [7, "5"], [10, "b7"]]) },
  { group: "Sixths & sevenths", name: "Augmented major 7", symbol: "maj7#5", tones: tones([[0, "1"], [4, "3"], [8, "#5"], [11, "7"]]) },
  { group: "Sixths & sevenths", name: "Augmented 7", symbol: "7#5", tones: tones([[0, "1"], [4, "3"], [8, "#5"], [10, "b7"]]) },
  { group: "Extensions (9, 11, 13)", name: "Add 9", symbol: "add9", tones: tones([[0, "1"], [4, "3"], [7, "5"], [14, "9"]]) },
  { group: "Extensions (9, 11, 13)", name: "Minor add 9", symbol: "madd9", tones: tones([[0, "1"], [3, "b3"], [7, "5"], [14, "9"]]) },
  { group: "Extensions (9, 11, 13)", name: "6/9", symbol: "6/9", tones: tones([[0, "1"], [4, "3"], [7, "5"], [9, "6"], [14, "9"]]) },
  { group: "Extensions (9, 11, 13)", name: "Dominant 9", symbol: "9", tones: tones([[0, "1"], [4, "3"], [7, "5"], [10, "b7"], [14, "9"]]) },
  { group: "Extensions (9, 11, 13)", name: "Major 9", symbol: "maj9", tones: tones([[0, "1"], [4, "3"], [7, "5"], [11, "7"], [14, "9"]]) },
  { group: "Extensions (9, 11, 13)", name: "Minor 9", symbol: "m9", tones: tones([[0, "1"], [3, "b3"], [7, "5"], [10, "b7"], [14, "9"]]) },
  { group: "Extensions (9, 11, 13)", name: "9sus4", symbol: "9sus4", tones: tones([[0, "1"], [5, "4"], [7, "5"], [10, "b7"], [14, "9"]]) },
  { group: "Extensions (9, 11, 13)", name: "Add 11", symbol: "add11", tones: tones([[0, "1"], [4, "3"], [7, "5"], [17, "11"]]) },
  { group: "Extensions (9, 11, 13)", name: "Dominant 11", symbol: "11", tones: tones([[0, "1"], [4, "3"], [7, "5"], [10, "b7"], [14, "9"], [17, "11"]]) },
  { group: "Extensions (9, 11, 13)", name: "Minor 11", symbol: "m11", tones: tones([[0, "1"], [3, "b3"], [7, "5"], [10, "b7"], [14, "9"], [17, "11"]]) },
  { group: "Extensions (9, 11, 13)", name: "Major 7 #11", symbol: "maj7#11", tones: tones([[0, "1"], [4, "3"], [7, "5"], [11, "7"], [18, "#11"]]) },
  { group: "Extensions (9, 11, 13)", name: "Dominant 13", symbol: "13", tones: tones([[0, "1"], [4, "3"], [7, "5"], [10, "b7"], [14, "9"], [21, "13"]]) },
  { group: "Extensions (9, 11, 13)", name: "Minor 13", symbol: "m13", tones: tones([[0, "1"], [3, "b3"], [7, "5"], [10, "b7"], [14, "9"], [21, "13"]]) },
  { group: "Extensions (9, 11, 13)", name: "Major 13", symbol: "maj13", tones: tones([[0, "1"], [4, "3"], [7, "5"], [11, "7"], [14, "9"], [21, "13"]]) },
  { group: "Altered dominants", name: "7b5", symbol: "7b5", tones: tones([[0, "1"], [4, "3"], [6, "b5"], [10, "b7"]]) },
  { group: "Altered dominants", name: "7b9", symbol: "7b9", tones: tones([[0, "1"], [4, "3"], [7, "5"], [10, "b7"], [13, "b9"]]) },
  { group: "Altered dominants", name: "7#9", symbol: "7#9", tones: tones([[0, "1"], [4, "3"], [7, "5"], [10, "b7"], [15, "#9"]]) },
  { group: "Altered dominants", name: "7#11", symbol: "7#11", tones: tones([[0, "1"], [4, "3"], [7, "5"], [10, "b7"], [18, "#11"]]) },
  { group: "Altered dominants", name: "7b13", symbol: "7b13", tones: tones([[0, "1"], [4, "3"], [7, "5"], [10, "b7"], [20, "b13"]]) },
];

export const PROGRESSIONS: ProgPreset[] = [
  { name: "I – IV – V – I", chords: [[0, ""], [5, ""], [7, ""], [0, ""]], scale: "Major (Ionian)" },
  { name: "I – V – vi – IV (pop)", chords: [[0, ""], [7, ""], [9, "m"], [5, ""]], scale: "Major (Ionian)" },
  { name: "vi – IV – I – V", chords: [[9, "m"], [5, ""], [0, ""], [7, ""]], scale: "Major (Ionian)" },
  { name: "I – vi – IV – V (doo-wop)", chords: [[0, ""], [9, "m"], [5, ""], [7, ""]], scale: "Major (Ionian)" },
  { name: "ii – V – I (jazz)", chords: [[2, "m7"], [7, "7"], [0, "maj7"], [0, "maj7"]], scale: "Major (Ionian)" },
  { name: "I – vi – ii – V (turnaround)", chords: [[0, "maj7"], [9, "m7"], [2, "m7"], [7, "7"]], scale: "Major (Ionian)" },
  { name: "iii – vi – ii – V – I", chords: [[4, "m7"], [9, "m7"], [2, "m7"], [7, "7"], [0, "maj7"]], scale: "Major (Ionian)" },
  { name: "IV – V – iii – vi (royal road)", chords: [[5, "maj7"], [7, "7"], [4, "m7"], [9, "m"]], scale: "Major (Ionian)" },
  { name: "Canon (I – V – vi – iii – IV – I – IV – V)", chords: [[0, ""], [7, ""], [9, "m"], [4, "m"], [5, ""], [0, ""], [5, ""], [7, ""]], scale: "Major (Ionian)" },
  { name: "12-bar blues", chords: [[0, "7"], [0, "7"], [0, "7"], [0, "7"], [5, "7"], [5, "7"], [0, "7"], [0, "7"], [7, "7"], [5, "7"], [0, "7"], [7, "7"]], scale: "Blues" },
  { name: "Quick-change blues", chords: [[0, "7"], [5, "7"], [0, "7"], [0, "7"], [5, "7"], [5, "7"], [0, "7"], [0, "7"], [7, "7"], [5, "7"], [0, "7"], [7, "7"]], scale: "Minor Pentatonic" },
  { name: "Minor i – iv – v", chords: [[0, "m"], [5, "m"], [7, "m"], [0, "m"]], scale: "Natural Minor (Aeolian)" },
  { name: "Minor i – bVII – bVI – bVII", chords: [[0, "m"], [10, ""], [8, ""], [10, ""]], scale: "Natural Minor (Aeolian)" },
  { name: "Andalusian i – bVII – bVI – V", chords: [[0, "m"], [10, ""], [8, ""], [7, ""]], scale: "Harmonic Minor" },
  { name: "Minor ii° – V – i (jazz)", chords: [[2, "m7b5"], [7, "7"], [0, "m7"], [0, "m7"]], scale: "Harmonic Minor" },
  { name: "Mixolydian I – bVII – IV – I", chords: [[0, ""], [10, ""], [5, ""], [0, ""]], scale: "Mixolydian" },
  { name: "Dorian i – IV vamp", chords: [[0, "m7"], [5, "7"]], scale: "Dorian" },
  { name: "Phrygian i – bII vamp", chords: [[0, "m"], [1, ""]], scale: "Phrygian" },
  { name: "Lydian I – II vamp", chords: [[0, "maj7"], [2, ""]], scale: "Lydian" },
];

export interface Tuning {
  name: string;
  /** MIDI note of each open string, lowest (6th) string first. */
  strings: number[];
}

export const TUNINGS: Tuning[] = [
  { name: "Standard (E A D G B E)", strings: [40, 45, 50, 55, 59, 64] },
  { name: "Half-step down", strings: [39, 44, 49, 54, 58, 63] },
  { name: "Drop D", strings: [38, 45, 50, 55, 59, 64] },
  { name: "DADGAD", strings: [38, 45, 50, 55, 57, 62] },
  { name: "Open G", strings: [38, 43, 50, 55, 59, 62] },
];

/** A stringed instrument the neck can show, with its usual tunings (lowest string first, MIDI numbers). */
export interface InstrumentType {
  id: string;
  name: string;
  tunings: Tuning[];
}

export const INSTRUMENT_TYPES: InstrumentType[] = [
  { id: "guitar6", name: "6-string guitar", tunings: TUNINGS },
  {
    id: "guitar7",
    name: "7-string guitar",
    tunings: [
      { name: "Standard (B E A D G B E)", strings: [35, 40, 45, 50, 55, 59, 64] },
      { name: "Drop A (A E A D G B E)", strings: [33, 40, 45, 50, 55, 59, 64] },
      { name: "Half-step down", strings: [34, 39, 44, 49, 54, 58, 63] },
    ],
  },
  {
    id: "bass4",
    name: "4-string bass",
    tunings: [
      { name: "Standard (E A D G)", strings: [28, 33, 38, 43] },
      { name: "Drop D (D A D G)", strings: [26, 33, 38, 43] },
      { name: "Half-step down", strings: [27, 32, 37, 42] },
    ],
  },
  {
    id: "bass5",
    name: "5-string bass",
    tunings: [
      { name: "Standard (B E A D G)", strings: [23, 28, 33, 38, 43] },
      { name: "High C (E A D G C)", strings: [28, 33, 38, 43, 48] },
    ],
  },
  {
    id: "ukulele",
    name: "Ukulele",
    tunings: [
      { name: "Standard (G C E A, high G)", strings: [67, 60, 64, 69] },
      { name: "Low G (G C E A)", strings: [55, 60, 64, 69] },
      { name: "Baritone (D G B E)", strings: [50, 55, 59, 64] },
    ],
  },
];

export const instrumentType = (id: string): InstrumentType => INSTRUMENT_TYPES.find((i) => i.id === id) ?? INSTRUMENT_TYPES[0];

export function bothNames(pc: number): string {
  return BOTH_NAMES[mod(pc, 12)];
}

/** The other name of a spelled note that has one ("Eb" gives "D#"), or null for a natural note. */
export function otherName(spelled: string, pc: number): string | null {
  const both = bothNames(pc);
  if (!both.includes("/")) return null;
  return both.split("/").find((n) => n !== spelled) ?? null;
}

export function plainName(pc: number): string {
  return FLAT_NAMES[mod(pc, 12)];
}

function keyLetter(key: number): number {
  const i = LETTERS.indexOf(KEYS[key][0]);
  return i < 0 ? 0 : i;
}

/** The number in a degree label ("b3" -> 3, "#11" -> 11, "bb7" -> 7). */
export function degreeNumber(label: string): number {
  const digits = label.replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 1;
}

export function isAltered(label: string): boolean {
  return label.includes("b") || label.includes("#");
}

/** Spell a note correctly for its degree in the key (F# major's 7th is E#, not F). */
export function spell(key: number, semis: number, label: string): string {
  const letter = (keyLetter(key) + ((degreeNumber(label) - 1) % 7)) % 7;
  const target = mod(key + semis, 12);
  let acc = mod(target - LETTER_PC[letter], 12);
  if (acc > 6) acc -= 12;
  const accs: Record<number, string> = { [-2]: "bb", [-1]: "b", 0: "", 1: "#", 2: "##" };
  if (!(acc in accs)) return plainName(target);
  return LETTERS[letter] + accs[acc];
}

const INTERVAL_NAMES: Record<string, string> = {
  "1": "Root", b2: "Minor 2nd", "2": "Major 2nd", b9: "Flat 9th", "9": "9th", "#9": "Sharp 9th",
  b3: "Minor 3rd", "3": "Major 3rd", "4": "Perfect 4th", "11": "11th", "#4": "Augmented 4th",
  "#2": "Augmented 2nd", b4: "Diminished 4th", "#6": "Augmented 6th", "#11": "Sharp 11th",
  b5: "Diminished 5th", "5": "Perfect 5th", "#5": "Augmented 5th", b6: "Minor 6th", "6": "Major 6th",
  "13": "13th", b13: "Flat 13th", bb7: "Diminished 7th", b7: "Minor 7th", "7": "Major 7th",
};

export function intervalName(label: string): string {
  return INTERVAL_NAMES[label] ?? "";
}

/** Short interval symbol for a degree label: "b3" -> "m3", "5" -> "P5", "1" -> "R". */
export function intervalShort(label: string): string {
  if (label === "1") return "R";
  const n = degreeNumber(label);
  const perfect = [4, 5, 11].includes(n);
  if (label.startsWith("bb")) return "d" + n;
  if (label.startsWith("b")) return perfect ? "d" + n : "m" + n;
  if (label.startsWith("#")) return "A" + n;
  return perfect ? "P" + n : "M" + n;
}

export interface Mark {
  string: number;
  fret: number;
  midi: number;
  label: string;
  semis: number;
  inPosition: boolean;
}

/** Which degree a pitch class is in a tone set, if any. */
export function toneFor(ts: Tone[], root: number, pc: number): Tone | undefined {
  return ts.find((t) => mod(root + t.semis, 12) === mod(pc, 12));
}

/** Every note of the tone set across the whole neck. */
export function wholeNeck(tuning: number[], root: number, ts: Tone[]): Mark[] {
  const out: Mark[] = [];
  tuning.forEach((open, s) => {
    for (let f = 0; f <= NUM_FRETS; f++) {
      const midi = open + f;
      const tn = toneFor(ts, root, midi);
      if (tn) out.push({ string: s, fret: f, midi, label: tn.label, semis: mod(tn.semis, 12), inPosition: true });
    }
  });
  return out;
}

export type FretNote = [number, number]; // [string, fret]

export interface PositionInfo {
  title: string;
  notes: FretNote[];
}

function anchors(tuning: number[], root: number, ts: Tone[]): [number, string][] {
  const rootFret = mod(root - tuning[0], 12);
  const seen: number[] = [];
  const out: [number, string][] = [];
  for (const tn of ts) {
    const pc = mod(tn.semis, 12);
    if (seen.includes(pc)) continue;
    seen.push(pc);
    out.push([(rootFret + pc) % 12, tn.label]);
  }
  return out;
}

function fitOnNeck(notes: FretNote[]): FretNote[] {
  let v = notes.map((n) => [...n] as FretNote);
  if (v.length && Math.min(...v.map((n) => n[1])) < 0) v = v.map(([s, f]) => [s, f + 12]);
  if (v.length && Math.max(...v.map((n) => n[1])) > NUM_FRETS && v.every((n) => n[1] >= 12)) {
    v = v.map(([s, f]) => [s, f - 12]);
  }
  return v.filter((n) => n[1] >= 0 && n[1] <= NUM_FRETS);
}

export function windowNotes(tuning: number[], root: number, ts: Tone[], lo: number, hi: number): FretNote[] {
  const v: FretNote[] = [];
  tuning.forEach((open, s) => {
    for (let f = Math.max(lo, 0); f <= Math.min(hi, NUM_FRETS); f++) {
      if (toneFor(ts, root, open + f)) v.push([s, f]);
    }
  });
  return v;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

/**
 * Positions for a scale: 3 notes per string for 7-note scales, 2 per string for
 * pentatonics, and a 5-fret box for the rest. One position starts on each degree.
 */
/** String indexes from the lowest-sounding string up (a re-entrant ukulele's high G is not the lowest). */
function pitchOrder(tuning: number[]): number[] {
  return tuning.map((_, i) => i).sort((a, b) => tuning[a] - tuning[b] || a - b);
}

/** Run a position builder on the strings sorted by pitch, and map its notes back to the real strings. */
function viaPitchOrder(tuning: number[], build: (sorted: number[]) => PositionInfo[]): PositionInfo[] {
  const order = pitchOrder(tuning);
  if (order.every((o, i) => o === i)) return build(tuning);
  return build(order.map((i) => tuning[i])).map((p) => ({ ...p, notes: p.notes.map(([s, f]) => [order[s], f] as FretNote) }));
}

export function scalePositions(tuning: number[], root: number, ts: Tone[]): PositionInfo[] {
  return viaPitchOrder(tuning, (t) => scalePositionsSorted(t, root, ts));
}

function scalePositionsSorted(tuning: number[], root: number, ts: Tone[]): PositionInfo[] {
  const nps = ts.length === 7 ? 3 : ts.length === 5 ? 2 : 0;
  const out: PositionInfo[] = [];
  anchors(tuning, root, ts).forEach(([anchor, label], i) => {
    let notes: FretNote[];
    if (nps) {
      const start = tuning[0] + anchor;
      const pitches: number[] = [];
      for (let m = start; m < start + 60; m++) if (toneFor(ts, root, m)) pitches.push(m);
      notes = [];
      let idx = 0;
      tuning.forEach((open, s) => {
        for (let k = 0; k < nps; k++) {
          if (idx < pitches.length) notes.push([s, pitches[idx] - open]);
          idx++;
        }
      });
    } else {
      const lo = anchor === 0 ? 0 : anchor - 1;
      notes = windowNotes(tuning, root, ts, lo, lo + 4);
    }
    notes = fitOnNeck(notes);
    const style = nps === 3 ? " · 3 notes per string" : nps === 2 ? " · pentatonic box" : "";
    out.push({ title: `Position ${i + 1} — from the ${label} (${ORDINALS[i] ?? ""})${style}`, notes });
  });
  return withOctaveRepeats(out);
}

/** Each position again an octave up (or down) wherever the whole shape fits, so positions carry past the 12th fret. */
function withOctaveRepeats(base: PositionInfo[]): PositionInfo[] {
  const extra: PositionInfo[] = [];
  for (const shift of [12, -12]) {
    for (const p of base) {
      const notes = p.notes.map(([s, f]) => [s, f + shift] as FretNote);
      if (!notes.length || notes.some((n) => n[1] < 0 || n[1] > NUM_FRETS)) continue;
      const lo = Math.min(...notes.map((n) => n[1]));
      const hi = Math.max(...notes.map((n) => n[1]));
      const num = p.title.split(" —")[0];
      const rest = (p.title.split(" — ")[1] ?? "").split("  (frets")[0];
      extra.push({ title: `${num}, ${shift > 0 ? "octave up" : "octave down"} — ${rest} · frets ${lo}–${hi}`, notes });
    }
  }
  return [...base, ...extra];
}

/** Positions for an arpeggio: a 5-fret box starting on each chord tone on the low string. */
export function arpeggioPositions(tuning: number[], root: number, ts: Tone[]): PositionInfo[] {
  return viaPitchOrder(tuning, (t) => arpeggioPositionsSorted(t, root, ts));
}

function arpeggioPositionsSorted(tuning: number[], root: number, ts: Tone[]): PositionInfo[] {
  const base = anchors(tuning, root, ts).map(([anchor, label], i) => {
    const lo = anchor === 0 ? 0 : anchor - 1;
    const notes = fitOnNeck(windowNotes(tuning, root, ts, lo, lo + 4));
    const a = notes.length ? Math.min(...notes.map((n) => n[1])) : lo;
    const b = notes.length ? Math.max(...notes.map((n) => n[1])) : lo + 4;
    return { title: `Position ${i + 1} — starting on the ${label}  (frets ${a}–${b})`, notes };
  });
  return withOctaveRepeats(base);
}

/** A playable chord shape: a fret per string, or null for a muted string. */
export interface Voicing {
  frets: (number | null)[];
  bassString: number;
  score: number;
}

export function voicingNotes(v: Voicing): FretNote[] {
  const out: FretNote[] = [];
  v.frets.forEach((f, s) => {
    if (f !== null) out.push([s, f]);
  });
  return out;
}

export function voicingMinFret(v: Voicing): number {
  const f = v.frets.filter((x): x is number => x !== null && x > 0);
  return f.length ? Math.min(...f) : 0;
}

/** Tones a guitarist may leave out of a chord shape. */
export function optionalLabels(ts: Tone[]): string[] {
  const has = (l: string) => ts.some((t) => t.label === l);
  const o: string[] = [];
  if (ts.length >= 4 && !ts.some((t) => t.label === "b5" || t.label === "#5")) o.push("5");
  if (has("11") || has("13") || has("#11")) o.push("9");
  if (has("11") && has("3")) o.push("3");
  if (ts.length >= 6 && has("13")) o.push("11");
  return o;
}

function scoreVoicing(tuning: number[], frets: (number | null)[], bass: number, required: number[]): number | null {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  let mn = 0;
  let mx = 0;
  if (fretted.length) {
    mn = Math.min(...fretted);
    mx = Math.max(...fretted);
    if (mx - mn > 3) return null;
    const atMin = fretted.filter((f) => f === mn).length;
    const fingers = fretted.length > 4 && atMin >= 2 ? fretted.length - atMin + 1 : fretted.length;
    if (fingers > 4) return null;
  }
  const present: number[] = [];
  frets.forEach((f, s) => {
    if (f !== null) present.push(mod(tuning[s] + f, 12));
  });
  if (!required.every((p) => present.includes(p))) return null;
  const sounded = present.length;
  if (sounded < Math.min(3, tuning.length)) return null;
  let top = bass;
  frets.forEach((f, s) => {
    if (f !== null) top = s;
  });
  let innerMutes = 0;
  for (let s = bass; s <= top; s++) if (frets[s] === null) innerMutes++;
  if (innerMutes > 1) return null;
  const span = fretted.length ? mx - mn : 0;
  const opens = frets.filter((f) => f === 0).length;
  return sounded * 10 - innerMutes * 14 - span * 2 - fretted.length + opens;
}

/** Search for compact chord shapes with the root in the bass on the 6th, 5th and 4th strings. */
export function chordVoicings(tuning: number[], root: number, ts: Tone[]): Voicing[] {
  const pcs = ts.map((t) => mod(root + t.semis, 12));
  const optional = optionalLabels(ts);
  const required = [...new Set(ts.filter((t) => !optional.includes(t.label)).map((t) => mod(root + t.semis, 12)))];
  const found: Voicing[] = [];
  const same = (a: Voicing, b: Voicing) => a.bassString === b.bassString && a.frets.every((f, i) => f === b.frets[i]);

  for (let bass = 0; bass < Math.min(3, tuning.length - 1); bass++) {
    const r = mod(root - tuning[bass], 12);
    for (const base of [r, r + 12]) {
      if (base > 15) continue;
      const lo = Math.max(base - 3, 0);
      const hi = base + 4;
      const options: (number | null)[][] = [];
      for (let s = bass + 1; s < tuning.length; s++) {
        const o: (number | null)[] = [null];
        if (pcs.includes(mod(tuning[s], 12)) && base <= 5) o.push(0);
        for (let f = Math.max(lo, 1); f <= hi; f++) if (pcs.includes(mod(tuning[s] + f, 12))) o.push(f);
        options.push(o);
      }
      let best: Voicing | null = null;
      const idx = options.map(() => 0);
      for (;;) {
        const frets: (number | null)[] = tuning.map(() => null);
        frets[bass] = base;
        idx.forEach((i, k) => {
          frets[bass + 1 + k] = options[k][i];
        });
        const score = scoreVoicing(tuning, frets, bass, required);
        if (score !== null && (!best || score > best.score)) best = { frets, bassString: bass, score };
        let k = 0;
        for (; k < idx.length; k++) {
          idx[k]++;
          if (idx[k] < options[k].length) break;
          idx[k] = 0;
        }
        if (k === idx.length) break;
      }
      if (best && !found.some((f) => same(f, best as Voicing))) found.push(best);
    }
  }
  return found.sort((a, b) => voicingMinFret(a) - voicingMinFret(b) || a.bassString - b.bassString);
}

/** Triad (or seventh) built on each degree of a 7-note scale: [degree index, chord index]. */
export function diatonicChords(ts: Tone[], sevenths: boolean): [number, number][] {
  if (ts.length !== 7) return [];
  const out: [number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const at = (k: number) => mod(ts[(i + k) % 7].semis - ts[i].semis, 12);
    const [third, fifth, seventh] = [at(2), at(4), at(6)];
    const key = `${third},${fifth},${sevenths ? seventh : "-"}`;
    const map: Record<string, string> = {
      "4,7,-": "", "3,7,-": "m", "3,6,-": "dim", "4,8,-": "aug",
      "4,7,11": "maj7", "4,7,10": "7", "3,7,10": "m7", "3,6,10": "m7b5",
      "3,6,9": "dim7", "3,7,11": "m(maj7)", "4,8,11": "aug",
    };
    const symbol = map[key];
    if (symbol === undefined) continue;
    const ci = CHORDS.findIndex((c) => c.symbol === symbol);
    if (ci >= 0) out.push([i, ci]);
  }
  return out;
}

export function roman(degreeIndex: number, chord: ChordDef): string {
  const base = ["i", "ii", "iii", "iv", "v", "vi", "vii"][degreeIndex % 7];
  const sym = chord.symbol;
  const minorish = (sym.startsWith("m") && !sym.startsWith("maj")) || sym.startsWith("dim");
  let s = minorish ? base : base.toUpperCase();
  if (sym.startsWith("dim")) s += "°";
  else if (sym === "m7b5") s += "ø";
  else if (sym === "aug") s += "+";
  return s;
}

/** Major, minor, both (blues) or neither (suspended), from the 3rds a scale holds. */
export function tonality(ts: Tone[]): string {
  const has = (s: number) => ts.some((t) => mod(t.semis, 12) === s && degreeNumber(t.label) % 7 === 3);
  const [maj, min] = [has(4), has(3)];
  if (maj && !min) return "Major";
  if (!maj && min) return "Minor";
  if (maj && min) return "Major + minor";
  return "Neutral (no 3rd)";
}

/** How a scale differs from natural major or natural minor: the parent's name and the changes. */
export function differenceFromNatural(ts: Tone[]): { parent: string; changes: [string, number][] } {
  const minor = tonality(ts) === "Minor";
  const parent = minor ? "Natural Minor" : "Major";
  const reference = minor ? ["1", "2", "b3", "4", "5", "b6", "b7"] : ["1", "2", "3", "4", "5", "6", "7"];
  const offset = (l: string) => (l.match(/#/g)?.length ?? 0) - (l.match(/b/g)?.length ?? 0);
  const changes: [string, number][] = [];
  for (let d = 1; d <= 7; d++) {
    const rl = reference[d - 1];
    const here = ts.filter((t) => ((degreeNumber(t.label) - 1) % 7) + 1 === d);
    if (!here.length) {
      changes.push([`no ${d}`, 0]);
      continue;
    }
    const matched = here.some((t) => t.label === rl);
    for (const t of here) {
      if (t.label === rl) continue;
      const dir = offset(t.label) - offset(rl);
      let name = !t.label.includes("b") && !t.label.includes("#") ? `natural ${d}` : t.label;
      if (matched) name = `+${name}`;
      changes.push([name, Math.sign(dir)]);
    }
  }
  return { parent, changes };
}

const CHROMATIC = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];

export function chromaticLabel(semis: number): string {
  return CHROMATIC[mod(semis, 12)];
}

/** Combine two scales: the joined tones and where each came from (0 both, 1 first only, 2 second only). */
export function blend(a: Tone[], b: Tone[], bOffset: number): { tones: Tone[]; src: [number, number][] } {
  const tonesOut: Tone[] = a.map((t) => ({ semis: mod(t.semis, 12), label: t.label }));
  const src: [number, number][] = tonesOut.map((t) => [t.semis, 1]);
  for (const tb of b) {
    const s = mod(tb.semis + bOffset, 12);
    const e = src.find((x) => x[0] === s);
    if (e) e[1] = 0;
    else {
      tonesOut.push({ semis: s, label: chromaticLabel(s) });
      src.push([s, 2]);
    }
  }
  tonesOut.sort((x, y) => x.semis - y.semis);
  return { tones: tonesOut, src };
}

export function chordIndex(symbol: string): number {
  const i = CHORDS.findIndex((c) => c.symbol === symbol);
  return i < 0 ? 0 : i;
}

export function findScale(name: string): ScaleDef {
  return SCALES.find((s) => s.name === name) ?? SCALES[0];
}

/** Roman numeral for a chord whose root is `semis` above the key ("bVII", "ii7", "V7"). */
export function romanFor(semis: number, chord: ChordDef): string {
  const base = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"][mod(semis, 12)];
  const sym = chord.symbol;
  const minorish = (sym.startsWith("m") && !sym.startsWith("maj")) || sym.startsWith("dim");
  const s = minorish ? base.toLowerCase() : base;
  let suffix: string;
  if (sym === "" || sym === "m") suffix = "";
  else if (sym === "dim") suffix = "°";
  else if (sym === "dim7") suffix = "°7";
  else if (sym === "m7b5") suffix = "ø7";
  else if (sym === "aug") suffix = "+";
  else if (minorish && sym.startsWith("m")) suffix = sym.slice(1);
  else suffix = sym;
  return s + suffix;
}

/** Degree labels for a 7-note set of half steps, measured against the major scale. */
function sevenNoteLabels(semis: number[]): string[] | null {
  const major = [0, 2, 4, 5, 7, 9, 11];
  if (semis.length !== 7) return null;
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = semis[i] - major[i];
    if (d < -2 || d > 2) return null;
    out.push(["bb", "b", "", "#", "##"][d + 2] + (i + 1));
  }
  return out;
}

/**
 * The scale to play over one chord of a progression. If every chord tone belongs to the
 * key's scale it is that scale started from the chord's root (Dm7 in C major gives D
 * Dorian); otherwise the usual scale for the chord's quality.
 */
export function chordScale(parent: ScaleDef, chordSemis: number, chord: ChordDef): { name: string; tones: Tone[] } {
  const cs = mod(chordSemis, 12);
  const parentPcs = parent.tones.map((t) => mod(t.semis, 12));
  const fits = chord.tones.every((t) => parentPcs.includes(mod(cs + t.semis, 12)));
  if (fits) {
    const rotated = [...new Set(parentPcs.map((p) => mod(p - cs, 12)))].sort((a, b) => a - b);
    const labels = sevenNoteLabels(rotated) ?? rotated.map(chromaticLabel);
    const tones = rotated.map((semis, i) => ({ semis, label: labels[i] }));
    const found = SCALES.find((sc) => {
      const v = [...new Set(sc.tones.map((t) => mod(t.semis, 12)))].sort((a, b) => a - b);
      return v.length === rotated.length && v.every((x, i) => x === rotated[i]);
    });
    return { name: found?.name ?? `${parent.name} (from the chord's root)`, tones };
  }
  const byChord: Record<string, string> = {
    "maj7#11": "Lydian", m: "Natural Minor (Aeolian)", madd9: "Natural Minor (Aeolian)",
    m7: "Dorian", m9: "Dorian", m11: "Dorian", m13: "Dorian", m6: "Dorian",
    "7": "Mixolydian", "9": "Mixolydian", "13": "Mixolydian", "11": "Mixolydian", "7sus4": "Mixolydian",
    "9sus4": "Mixolydian", sus2: "Mixolydian", sus4: "Mixolydian",
    "7#11": "Lydian Dominant", "7b9": "Diminished (Half-Whole)", "7#9": "Altered (Super Locrian)",
    "7b13": "Mixolydian b6", "7b5": "Whole Tone", aug: "Whole Tone", "7#5": "Whole Tone",
    "maj7#5": "Lydian Augmented", m7b5: "Locrian #2 (Half-diminished)", dim: "Diminished (Whole-Half)",
    dim7: "Diminished (Whole-Half)", "m(maj7)": "Melodic Minor", "5": "Minor Pentatonic",
  };
  const sc = findScale(byChord[chord.symbol] ?? "Major (Ionian)");
  return { name: sc.name, tones: sc.tones };
}

/**
 * When following chords, the notes of the chord's scale (or arpeggio) that stay where the hand
 * already is: the fixed position whose frets sit within 2 of lo..hi and closest to it, or, if
 * none fits, every note of the scale inside that stretch of the neck (one fret either side).
 */
export function followPosition(tuning: number[], root: number, ts: Tone[], arpeggio: boolean, lo: number, hi: number): FretNote[] {
  const candidates = arpeggio ? arpeggioPositions(tuning, root, ts) : scalePositions(tuning, root, ts);
  const span = (n: FretNote[]) => [Math.min(...n.map((x) => x[1])), Math.max(...n.map((x) => x[1]))];
  let best: PositionInfo | null = null;
  let bestScore = Infinity;
  for (const p of candidates) {
    if (!p.notes.length || !p.notes.every((n) => n[1] >= lo - 2 && n[1] <= hi + 2)) continue;
    const [a, b] = span(p.notes);
    const score = Math.abs(a - lo) + Math.abs(b - hi);
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best ? best.notes : windowNotes(tuning, root, ts, Math.max(lo - 1, 0), Math.min(hi + 1, NUM_FRETS));
}
