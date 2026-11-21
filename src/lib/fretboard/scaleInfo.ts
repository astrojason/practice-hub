// A short guide to each scale: how it sounds, when to use it, well-known music that
// uses it, and its colour notes (what sets it apart from plain major or natural minor).
import { differenceFromNatural, type Tone } from "./theory";

export interface ScaleInfo {
  sound: string;
  useIt: string;
  heardIn: string[];
  /** Written explanation of the colour notes when the comparison alone doesn't say enough. */
  colourNote: string | null;
  /** Colour notes to mark when they can't be worked out by comparing (pentatonics, blues). */
  colourLabels: string[];
}

const INFO: Record<string, ScaleInfo> = {
  "Major (Ionian)": { sound: "Bright, settled, happy.", useIt: "Over major chords in pop, rock, country and folk; the home scale most other scales are compared with.", heardIn: ["\"Let It Be\" — The Beatles", "\"Don't Stop Believin'\" — Journey"], colourNote: "This is the reference: the major 3rd makes it bright and the major 7th pulls strongly back to the root.", colourLabels: ["3", "7"] },
  "Lydian": { sound: "Dreamy, floating, bright — like major with a lift.", useIt: "Over a major or maj7 chord (especially I or IV); film scores and spacey rock ballads.", heardIn: ["\"Flying in a Blue Dream\" — Joe Satriani", "\"Dreams\" — Fleetwood Mac"], colourNote: null, colourLabels: [] },
  "Mixolydian": { sound: "Major but bluesy and laid-back; less 'finished' than major.", useIt: "Over dominant 7th chords (V7, blues and rock I7), and rock songs that use the bVII chord.", heardIn: ["\"Sweet Home Alabama\" — Lynyrd Skynyrd", "\"Norwegian Wood\" — The Beatles", "\"Gloria\" — Them"], colourNote: null, colourLabels: [] },
  "Natural Minor (Aeolian)": { sound: "Sad, serious, dramatic.", useIt: "Over minor chords in rock, pop and metal; the vi chord of a major key.", heardIn: ["\"All Along the Watchtower\" — Bob Dylan / Jimi Hendrix", "\"Losing My Religion\" — R.E.M."], colourNote: "This is the minor reference: compared with major it has a b3, b6 and b7 — the b6 is what makes it darker than Dorian.", colourLabels: ["b3", "b6"] },
  "Dorian": { sound: "Minor but warm and hopeful, a little jazzy or funky.", useIt: "Over minor 7th chords (the ii chord), funk and jazz vamps, and minor rock and Latin grooves.", heardIn: ["\"Oye Como Va\" — Santana", "\"So What\" — Miles Davis", "\"Scarborough Fair\" (traditional)"], colourNote: null, colourLabels: [] },
  "Phrygian": { sound: "Dark, tense and Spanish-sounding.", useIt: "Over minor chords that move to a chord a half step up (i to bII); flamenco and metal riffs.", heardIn: ["\"Wherever I May Roam\" — Metallica", "\"Symphony of Destruction\" — Megadeth"], colourNote: null, colourLabels: [] },
  "Locrian": { sound: "Unstable and unsettled — it never feels at rest.", useIt: "Over half-diminished (m7b5) chords, the vii chord of a major key; dark metal riffs.", heardIn: ["\"Army of Me\" — Björk"], colourNote: null, colourLabels: [] },
  "Major Pentatonic": { sound: "Open, sweet, can't-go-wrong major.", useIt: "Over major chords in country, rock and pop solos; safe over a whole major key.", heardIn: ["\"My Girl\" — The Temptations (guitar riff)", "Country and southern-rock solos"], colourNote: "No 4th and no 7th, so there are no half steps — nothing clashes. That openness is its colour.", colourLabels: ["2", "6"] },
  "Minor Pentatonic": { sound: "Bluesy, strong, the classic rock-solo sound.", useIt: "Over minor keys and over blues and rock in either major or minor.", heardIn: ["\"Sunshine of Your Love\" — Cream", "\"Stairway to Heaven\" solo — Led Zeppelin"], colourNote: "No 2nd and no 6th, so it avoids half steps; the b3 and b7 give the bluesy edge.", colourLabels: ["b3", "b7"] },
  "Blues": { sound: "Gritty, crying, blues.", useIt: "Over a 12-bar blues and blues-rock, in major or minor keys.", heardIn: ["\"The Thrill Is Gone\" — B.B. King", "\"Pride and Joy\" — Stevie Ray Vaughan"], colourNote: "Minor pentatonic plus the b5 'blue note' — a passing tension between the 4th and 5th.", colourLabels: ["b5"] },
  "Major Blues": { sound: "Happy, bouncy blues; country-blues.", useIt: "Over major blues and boogie, country and rockabilly.", heardIn: ["Country and rockabilly lead lines"], colourNote: "Major pentatonic plus the b3, slid up into the major 3rd.", colourLabels: ["b3"] },
  "Harmonic Minor": { sound: "Exotic, classical, dramatic.", useIt: "Over a minor key whose V chord is major (V7 back to i), neoclassical rock and classical music.", heardIn: ["Neoclassical solos — Yngwie Malmsteen", "The chords of \"Hotel California\" — Eagles"], colourNote: "Natural minor with a raised (natural) 7th: the big jump from b6 to 7 is its exotic sound.", colourLabels: [] },
  "Melodic Minor": { sound: "Smooth, sophisticated minor; jazz minor.", useIt: "Over minor-major 7 and minor 6 chords; jazz. Its modes give Lydian dominant and Altered.", heardIn: ["Jazz lines over minor chords"], colourNote: null, colourLabels: [] },
  "Phrygian Dominant": { sound: "Middle-Eastern, flamenco, Spanish.", useIt: "Over the V7 chord of a minor key (V7 to i), flamenco, surf and metal.", heardIn: ["\"Hava Nagila\" (traditional)", "Flamenco and neoclassical metal"], colourNote: "Phrygian with a major 3rd: the b2 next to the major 3rd makes the exotic gap.", colourLabels: [] },
  "Lydian Dominant": { sound: "Bright and quirky; major with a twist.", useIt: "Over dominant 7th chords that don't resolve (II7, bVII7) and 7#11 chords.", heardIn: ["\"The Simpsons\" theme — Danny Elfman"], colourNote: null, colourLabels: [] },
  "Altered (Super Locrian)": { sound: "Maximum tension that wants to resolve.", useIt: "Over altered dominant chords (7b9, 7#9, 7#5) just before they resolve, mostly in jazz.", heardIn: ["Jazz lines over V7alt chords"], colourNote: "Every note that can be altered on a dominant chord is: b9, #9, #11 and b13.", colourLabels: ["b2", "#2", "b5", "#5"] },
  "Whole Tone": { sound: "Floating, dreamy, no home — like a dream sequence.", useIt: "Over augmented and 7#5 chords; dream and mystery effects.", heardIn: ["Debussy's piano music", "\"You Are the Sunshine of My Life\" intro — Stevie Wonder"], colourNote: "Only whole steps, so every note is equal and nothing feels like home.", colourLabels: ["#4", "#5"] },
  "Diminished (Half-Whole)": { sound: "Tense, symmetrical, jazz and metal.", useIt: "Over dominant 7b9 chords.", heardIn: ["Jazz and fusion lines over 7b9 chords"], colourNote: "Alternating half and whole steps; over a dominant chord it gives b9, #9 and #11.", colourLabels: ["b2", "#2", "#4"] },
  "Diminished (Whole-Half)": { sound: "Tense and symmetrical.", useIt: "Over diminished 7 chords.", heardIn: ["Jazz lines over diminished chords"], colourNote: "Alternating whole and half steps — it repeats every three frets.", colourLabels: [] },
  "Bebop Dominant": { sound: "Swinging jazz lines that land on the beat.", useIt: "Over dominant 7th chords in jazz and swing.", heardIn: ["Charlie Parker's lines"], colourNote: "Mixolydian plus a passing major 7th, so chord tones fall on the beats.", colourLabels: ["7"] },
  "Double Harmonic (Byzantine)": { sound: "Very exotic, Middle-Eastern.", useIt: "Over a major chord with a b2 chord above it; surf and world music.", heardIn: ["\"Misirlou\" — Dick Dale"], colourNote: "Two gaps of a step and a half (b2 to 3, b6 to 7) give its strong exotic colour.", colourLabels: [] },
  "Hungarian Minor": { sound: "Dark, gypsy, dramatic.", useIt: "Over minor chords for an Eastern European or gypsy colour.", heardIn: ["Gypsy and Eastern European folk"], colourNote: "Harmonic minor with a #4 as well.", colourLabels: [] },
  "Hirajoshi": { sound: "Japanese, delicate and dark.", useIt: "For a Japanese colour over minor chords.", heardIn: ["Japanese koto music"], colourNote: "A five-note scale with half steps (2 to b3, 5 to b6) that give it its colour.", colourLabels: ["b6"] },
  "In Sen": { sound: "Japanese, sparse and mysterious.", useIt: "For a Japanese colour over minor or suspended chords.", heardIn: ["Japanese traditional music"], colourNote: "Starts with a half step (the b2) and has no 3rd.", colourLabels: ["b2"] },
};

export function scaleInfo(name: string): ScaleInfo | undefined {
  return INFO[name];
}

/** The colour notes of a scale: the degrees that differ from its parent, or the ones the guide names. */
export function colourNotes(name: string, tones: Tone[]): { labels: string[]; explanation: string } {
  const guide = scaleInfo(name);
  const { parent, changes } = differenceFromNatural(tones);
  const moved = changes.filter(([, dir]) => dir !== 0);
  const changed: string[] = [];
  for (const [text] of moved) {
    const t = text.replace(/^\+/, "").replace(/^natural /, "");
    const tn = tones.find((x) => x.label === t);
    if (tn) changed.push(tn.label);
  }
  const labels = guide && guide.colourLabels.length ? guide.colourLabels : changed;
  let explanation = "";
  if (guide?.colourNote) explanation = guide.colourNote;
  else if (changed.length) {
    const names = moved.map(([t]) => t.replace(/^\+/, ""));
    const what = names.length === 1 ? `The ${names[0]}` : `The ${names.join(" and ")}`;
    const only = names.length === 1 ? " — it's the only difference" : "";
    explanation = `${what} compared with the ${parent.toLowerCase()} scale${only}.`;
  }
  return { labels, explanation };
}
