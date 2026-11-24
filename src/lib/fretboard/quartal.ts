// Quartal (and quintal) chords: notes stacked in 4ths (or 5ths) instead of 3rds, with
// the size of each interval adjustable in cents so the drift from equal temperament
// can be heard.

import { NUM_FRETS, plainName, type Voicing } from "./theory";

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface StackNote {
  /** The exact pitch, as a (possibly fractional) MIDI number. */
  exact: number;
  /** The nearest piano key. */
  midi: number;
  name: string;
  /** Cents away from that key (negative is flat). */
  off: number;
}

/** `count` notes from the root (starting at C3), each `cents` above the last. */
export function quartalStack(rootPc: number, count: number, cents: number): StackNote[] {
  const base = 48 + (((rootPc % 12) + 12) % 12);
  // Stacked 4ths read naturally in flats (C F Bb Eb), stacked 5ths in sharps (C G D A E B F#).
  const nameOf = (m: number) => (cents >= 600 ? SHARP_NAMES[((m % 12) + 12) % 12] : plainName(m));
  return Array.from({ length: count }, (_, k) => {
    const exact = base + (k * cents) / 100;
    const midi = Math.round(exact);
    return { exact, midi, name: nameOf(midi), off: Math.round((exact - midi) * 100) || 0 };
  });
}

/**
 * Where a perfect stack sits on the neck: one note per string on neighbouring strings, as
 * low on the neck as it fits with a stretch of at most four frets. Null when it doesn't fit.
 */
export function quartalShape(tuning: number[], rootPc: number, count: number, semis: number): Voicing | null {
  let best: { frets: (number | null)[]; bassString: number; cost: number } | null = null;
  for (let bass = 0; bass + count <= tuning.length; bass++) {
    const r = (((rootPc - tuning[bass]) % 12) + 12) % 12;
    for (const baseFret of [r, r + 12]) {
      if (baseFret > 15) continue;
      const frets: (number | null)[] = tuning.map(() => null);
      let ok = true;
      for (let k = 0; k < count; k++) {
        const f = tuning[bass] + baseFret + k * semis - tuning[bass + k];
        if (f < 0 || f > NUM_FRETS) {
          ok = false;
          break;
        }
        frets[bass + k] = f;
      }
      if (!ok) continue;
      const fretted = frets.filter((f): f is number => f !== null && f > 0);
      if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 4) continue;
      const cost = fretted.reduce((a, b) => a + b, 0) / Math.max(fretted.length, 1);
      if (!best || cost < best.cost) best = { frets, bassString: bass, cost };
    }
  }
  return best ? { frets: best.frets, bassString: best.bassString, score: 0 } : null;
}
