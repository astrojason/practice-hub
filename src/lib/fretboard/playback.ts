import type { SeqEvent } from "./audio";
import type { Direction } from "./settings";

export interface Step {
  midi: number;
  string: number;
  fret: number;
}

/** The notes of a run in playing order for a direction. Up-and-down doesn't repeat the turning notes. */
export function orderSteps(notes: Step[], dir: Direction): Step[] {
  const up = [...notes].sort((a, b) => a.midi - b.midi || a.string - b.string);
  const down = [...up].reverse();
  if (dir === "up") return up;
  if (dir === "down") return down;
  // Down again without the top note, and without the bottom one (it starts the next pass).
  return [...up, ...down.slice(1, down.length > 2 ? -1 : undefined)];
}

export const highlightCode = (s: { string: number; fret: number }) => `${s.string}:${s.fret}`;

export interface BuiltSequence {
  events: SeqEvent[];
  length: number;
  loopFrom: number;
}

export interface BuildOptions {
  steps: Step[];
  bpm: number;
  notesPerBeat: number;
  beatsPerBar?: number;
  countInBars: number;
  click: boolean;
}

/** Turn a run of notes into timed events: count-in clicks, the notes, and the metronome. */
export function buildSequence(o: BuildOptions): BuiltSequence {
  const beat = 60 / o.bpm;
  const bar = o.beatsPerBar ?? 4;
  const stepDur = beat / o.notesPerBeat;
  const countIn = o.countInBars * bar * beat;
  const events: SeqEvent[] = [];
  for (let i = 0; i < o.countInBars * bar; i++) {
    events.push({ time: i * beat, kind: { type: "click", accent: i % bar === 0 } });
  }
  o.steps.forEach((s, i) => {
    events.push({
      time: countIn + i * stepDur,
      kind: { type: "note", midi: s.midi, string: s.string, highlight: highlightCode(s) },
    });
  });
  // A pass lasts a whole number of beats so a repeating click stays in time.
  const beats = Math.max(1, Math.ceil((o.steps.length * stepDur) / beat - 1e-9));
  if (o.click) {
    for (let i = 0; i < beats; i++) events.push({ time: countIn + i * beat, kind: { type: "click", accent: i % bar === 0 } });
  }
  return { events, length: countIn + beats * beat, loopFrom: countIn };
}

export interface ChordBuildOptions {
  notes: Step[];
  bpm: number;
  notesPerBeat: number;
  countInBars: number;
  click: boolean;
}

/** A chord strummed once, then picked note by note: the Chords page's Play. */
export function buildChordSequence(o: ChordBuildOptions): BuiltSequence {
  const beat = 60 / o.bpm;
  const countIn = o.countInBars * 4 * beat;
  const events: SeqEvent[] = [];
  for (let i = 0; i < o.countInBars * 4; i++) events.push({ time: i * beat, kind: { type: "click", accent: i % 4 === 0 } });
  const sorted = [...o.notes].sort((a, b) => a.string - b.string);
  sorted.forEach((s, i) => {
    events.push({ time: countIn + i * 0.035, kind: { type: "note", midi: s.midi, string: s.string, velocity: 0.8, highlight: highlightCode(s) } });
  });
  const pickStart = countIn + beat;
  sorted.forEach((s, i) => {
    events.push({ time: pickStart + (i * beat) / o.notesPerBeat, kind: { type: "note", midi: s.midi, string: s.string, highlight: highlightCode(s) } });
  });
  const beats = Math.max(2, Math.ceil(1 + (sorted.length / o.notesPerBeat) - 1e-9));
  if (o.click) for (let i = 0; i < beats; i++) events.push({ time: countIn + i * beat, kind: { type: "click", accent: i % 4 === 0 } });
  return { events, length: countIn + beats * beat, loopFrom: countIn };
}
