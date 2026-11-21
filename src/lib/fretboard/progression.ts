// Chord progressions: the chords, how the guitar and drums play them, and the
// timed events for a loop. Ported from the Craft app's progression playback.

import type { SeqEvent } from "./audio";
import { CHORDS, PROGRESSIONS, SCALES, chordIndex, chordScale, chordVoicings, voicingNotes, type Tone, type Voicing } from "./theory";

export interface ProgChord {
  /** Half steps above the key. */
  semis: number;
  /** Index into CHORDS. */
  chord: number;
  /** Beats this chord lasts; 0 uses the progression's default. */
  beats: number;
}

export type Comp = "whole" | "beats" | "fingerpick" | "bassstrum";
export const COMPS: { id: Comp; name: string }[] = [
  { id: "whole", name: "One strum per chord" },
  { id: "beats", name: "Strum every beat" },
  { id: "fingerpick", name: "Fingerpicking" },
  { id: "bassstrum", name: "Bass note + strum" },
];

export type DrumStyle = "off" | "rock" | "pop" | "ballad" | "halftime" | "funk" | "shuffle" | "bossa" | "jazz";
export const DRUM_STYLES: { id: DrumStyle; name: string }[] = [
  { id: "off", name: "No drums" },
  { id: "rock", name: "Rock" },
  { id: "pop", name: "Pop" },
  { id: "ballad", name: "Ballad" },
  { id: "halftime", name: "Half-time" },
  { id: "funk", name: "Funk" },
  { id: "shuffle", name: "Blues shuffle" },
  { id: "bossa", name: "Bossa nova" },
  { id: "jazz", name: "Jazz swing" },
];

export type Follow = "off" | "chordscale" | "arpeggio";
export type ChordFocus = "shape" | "alltones";

export function presetChords(index: number): ProgChord[] {
  return PROGRESSIONS[index].chords.map(([semis, sym]) => ({ semis, chord: chordIndex(sym), beats: 0 }));
}

export function presetScaleIndex(index: number): number {
  return Math.max(0, SCALES.findIndex((sc) => sc.name === PROGRESSIONS[index].scale));
}

/** The name a chord shows with its root: "Dm7", "F#maj7". */
export function chordLabel(rootName: string, chord: number): string {
  return rootName + CHORDS[chord].symbol;
}

/** Drum hits for `beats` beats of a style: [time, General MIDI drum, velocity]. */
export function drumPattern(style: DrumStyle, beats: number, beat: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  if (style === "off") return out;
  const swing = style === "shuffle" || style === "jazz";
  for (let b = 0; b < beats; b++) {
    const barStep = (b % 4) * 4;
    for (let k = 0; k < 4; k++) {
      const timeOf = (kk: number) => (b + (swing && kk === 2 ? 2 / 3 : kk / 4)) * beat;
      const hit = (steps: number[], note: number, vel: number) => {
        if (steps.includes(barStep + k)) out.push([timeOf(k), note, vel]);
      };
      const all16 = Array.from({ length: 16 }, (_, i) => i);
      const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
      switch (style) {
        case "rock":
          hit([0, 8, 10], 36, 0.9);
          hit([4, 12], 38, 0.85);
          hit(eighths, 42, k === 0 ? 0.6 : 0.42);
          break;
        case "pop":
          hit([0, 7, 8], 36, 0.85);
          hit([4, 12], 38, 0.8);
          hit([0, 2, 4, 6, 8, 10, 12], 42, k === 0 ? 0.55 : 0.38);
          hit([14], 46, 0.45);
          break;
        case "ballad":
          hit([0, 8], 36, 0.7);
          hit([4, 12], 37, 0.6);
          hit(eighths, 42, 0.3);
          break;
        case "halftime":
          hit([0, 10], 36, 0.85);
          hit([8], 38, 0.85);
          hit(eighths, 42, 0.4);
          break;
        case "funk":
          hit([0, 3, 10], 36, 0.85);
          hit([4, 12], 38, 0.85);
          hit([7, 9, 15], 38, 0.22);
          hit(all16, 42, k % 2 === 0 ? 0.45 : 0.25);
          break;
        case "shuffle":
          hit([0, 8], 36, 0.85);
          hit([4, 12], 38, 0.8);
          hit(eighths, 42, k === 0 ? 0.5 : 0.35);
          break;
        case "bossa":
          hit([0, 3, 4, 7, 8, 11, 12, 15], 36, k === 0 ? 0.6 : 0.4);
          hit([0, 6, 10, 12], 37, 0.55);
          hit(eighths, 42, 0.3);
          break;
        case "jazz":
          hit([0, 4, 6, 8, 12, 14], 51, k === 0 ? 0.55 : 0.4);
          hit([4, 12], 44, 0.4);
          hit([0, 4, 8, 12], 36, 0.2);
          break;
      }
    }
  }
  if (["rock", "pop", "funk", "halftime"].includes(style) && beats > 0) out.push([0, 49, 0.6]);
  return out;
}

export interface ChordPlay {
  root: number;
  chord: number;
  voicing: Voicing | undefined;
}

export interface ProgOptions {
  tuning: number[];
  key: number;
  chords: ProgChord[];
  defaultBeats: number;
  bpm: number;
  notesPerBeat: number;
  comp: Comp;
  drums: DrumStyle;
  click: boolean;
  countInBars: number;
  /** The shape to prefer for each chord (closest to this fret). */
  nearFret?: number;
}

export function chordRoot(key: number, c: ProgChord): number {
  return (key + c.semis) % 12;
}

/** The shape played for each chord: the one nearest the hand, so shapes stay close together. */
export function progVoicings(o: Pick<ProgOptions, "tuning" | "key" | "chords" | "nearFret">): (Voicing | undefined)[] {
  let near = o.nearFret ?? 3;
  return o.chords.map((c) => {
    const list = chordVoicings(o.tuning, chordRoot(o.key, c), CHORDS[c.chord].tones);
    if (!list.length) return undefined;
    const best = [...list].sort((a, b) => dist(a, near) - dist(b, near))[0];
    near = Math.round(voicingNotes(best).reduce((s, n) => s + n[1], 0) / Math.max(1, voicingNotes(best).length));
    return best;
  });
}

function dist(v: Voicing, near: number): number {
  const frets = voicingNotes(v).map((n) => n[1]);
  return Math.abs(Math.min(...frets) - near) + (v.bassString === 0 ? 0 : 0.5);
}

export interface BuiltProgression {
  events: SeqEvent[];
  length: number;
  loopFrom: number;
  /** Start time (seconds, from the loop start) of each chord. */
  starts: number[];
}

/** Turn a progression into timed events: marker per chord, guitar part, drums, click. */
export function buildProgression(o: ProgOptions, voicings: (Voicing | undefined)[]): BuiltProgression {
  const beat = 60 / o.bpm;
  const step = beat / o.notesPerBeat;
  const events: SeqEvent[] = [];
  const countIn = o.countInBars * 4 * beat;
  const body: SeqEvent[] = [];
  const starts: number[] = [];
  const note = (string: number, fret: number, t: number, vel: number): SeqEvent => ({
    time: t,
    kind: { type: "note", midi: o.tuning[string] + fret, string, velocity: vel, highlight: `${string}:${fret}` },
  });
  const strum = (notes: [number, number][], t: number, vel: number, up: boolean) => {
    const order = up ? [...notes].reverse() : notes;
    order.forEach(([s, f], i) => body.push(note(s, f, t + i * 0.018, vel - 0.025 * i)));
  };

  let t0 = 0;
  let totalBeats = 0;
  voicings.forEach((v, i) => {
    const nb = o.chords[i].beats || o.defaultBeats;
    const start = t0;
    starts.push(start);
    t0 += nb * beat;
    totalBeats += nb;
    body.push({ time: start, kind: { type: "marker", code: String(i) } });
    if (!v) return;
    const notes = voicingNotes(v);
    switch (o.comp) {
      case "whole":
        strum(notes, start, 0.82, false);
        break;
      case "beats":
        for (let b = 0; b < nb; b++) {
          strum(notes, start + b * beat, b === 0 ? 0.85 : 0.62, false);
          if (o.notesPerBeat >= 2 && b % 2 === 1) strum(notes.slice(2), start + b * beat + beat / 2, 0.5, true);
        }
        break;
      case "fingerpick": {
        const pattern = [...notes, ...[...notes].reverse().slice(1, Math.max(1, notes.length - 1))];
        const n = Math.max(1, nb * o.notesPerBeat);
        for (let k = 0; k < n; k++) {
          const [s, f] = pattern[k % pattern.length];
          body.push(note(s, f, start + k * step, k === 0 ? 0.85 : 0.62));
        }
        break;
      }
      case "bassstrum":
        for (let b = 0; b < nb; b++) {
          if (b % 2 === 0) body.push(note(notes[0][0], notes[0][1], start + b * beat, 0.85));
          else strum(notes.slice(1), start + b * beat, 0.65, false);
        }
        break;
    }
  });
  for (const [t, drum, vel] of drumPattern(o.drums, totalBeats, beat)) body.push({ time: t, kind: { type: "drum", note: drum, velocity: vel } });
  if (o.click) for (let b = 0; b < totalBeats; b++) body.push({ time: b * beat, kind: { type: "click", accent: b % 4 === 0 } });

  for (let i = 0; i < o.countInBars * 4; i++) events.push({ time: i * beat, kind: { type: "click", accent: i % 4 === 0 } });
  for (const e of body) events.push({ ...e, time: e.time + countIn });
  return { events, length: countIn + t0, loopFrom: countIn, starts };
}

/** The scale to show over a chord when following chords. */
export function followTones(parentScale: number, c: ProgChord): { name: string; tones: Tone[] } {
  return chordScale(SCALES[parentScale], c.semis, CHORDS[c.chord]);
}
