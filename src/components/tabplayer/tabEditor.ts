// The tab editor's edits. Each one takes the song and the caret and returns a changed copy (the
// song passed in is never modified) with the caret moved to a sensible place. Ported from the
// Tabline editor.

import { beatTicks, WHOLE } from "./tabRender";
import type { TabBeat, TabMeasure, TabNote, TabSong, TabTrack } from "./types";

export interface Caret {
  bar: number;
  /** Beat within the bar. */
  beat: number;
  /** 1 is the highest string. */
  string: number;
}

export interface Edit {
  song: TabSong;
  caret: Caret;
}

/** An edit that can't be made, with the reason to show. */
export interface EditError {
  error: string;
}

export type EditResult = Edit | EditError;

export const DURATIONS: { dur: number; title: string; label: string }[] = [
  { dur: 1, title: "Whole note", label: "1" },
  { dur: 2, title: "Half note", label: "½" },
  { dur: 4, title: "Quarter note", label: "¼" },
  { dur: 8, title: "Eighth note", label: "⅛" },
  { dur: 16, title: "Sixteenth note", label: "1/16" },
];

/** The drum sound each of the five drum lines types (cymbals, hi-hat, snare, toms, kick). */
export const DRUM_FOR_LINE: Record<number, number> = { 1: 49, 2: 42, 3: 38, 4: 45, 5: 36 };

export function isError(r: EditResult): r is EditError {
  return "error" in r;
}

function copy(song: TabSong): TabSong {
  return structuredClone(song);
}

export function clampCaret(song: TabSong, track: number, caret: Caret): Caret {
  const t = song.tracks[track];
  const bar = Math.max(0, Math.min(caret.bar, t.measures.length - 1));
  const beat = Math.max(0, Math.min(caret.beat, t.measures[bar].beats.length - 1));
  const string = Math.max(1, Math.min(caret.string, t.strings.length));
  return { bar, beat, string };
}

export function moveCaret(song: TabSong, track: number, caret: Caret, dBeat: number, dString: number): Caret {
  const t = song.tracks[track];
  let { bar, beat, string } = caret;
  string = Math.max(1, Math.min(t.strings.length, string + dString));
  if (dBeat > 0) {
    if (beat < t.measures[bar].beats.length - 1) beat++;
    else if (bar < t.measures.length - 1) {
      bar++;
      beat = 0;
    }
  } else if (dBeat < 0) {
    if (beat > 0) beat--;
    else if (bar > 0) {
      bar--;
      beat = t.measures[bar].beats.length - 1;
    }
  }
  return { bar, beat, string };
}

function withBeat(song: TabSong, track: number, caret: Caret, fn: (beat: TabBeat, measure: TabMeasure, t: TabTrack) => void): Edit {
  const next = copy(song);
  const t = next.tracks[track];
  const c = clampCaret(next, track, caret);
  const m = t.measures[c.bar];
  fn(m.beats[c.beat], m, t);
  return { song: next, caret: c };
}

const sortNotes = (notes: TabNote[]) => [...notes].sort((a, b) => a.string - b.string);

/** Puts a fret on the caret's string. */
export function setFret(song: TabSong, track: number, caret: Caret, fret: number): Edit {
  return withBeat(song, track, caret, (beat) => {
    beat.notes = sortNotes([...beat.notes.filter((n) => n.string !== caret.string), { string: caret.string, fret }]);
  });
}

/** Adds or removes a drum hit on the caret's line. */
export function toggleDrum(song: TabSong, track: number, caret: Caret, piece: number): Edit {
  return withBeat(song, track, caret, (beat) => {
    const has = beat.notes.some((n) => n.string === caret.string);
    beat.notes = has ? beat.notes.filter((n) => n.string !== caret.string) : sortNotes([...beat.notes, { string: caret.string, fret: piece }]);
  });
}

export function removeNote(song: TabSong, track: number, caret: Caret): Edit {
  return withBeat(song, track, caret, (beat) => {
    beat.notes = beat.notes.filter((n) => n.string !== caret.string);
  });
}

/** Makes the beat a rest. */
export function clearBeat(song: TabSong, track: number, caret: Caret): Edit {
  return withBeat(song, track, caret, (beat) => {
    beat.notes = [];
  });
}

export function setDuration(song: TabSong, track: number, caret: Caret, dur: number): Edit {
  return withBeat(song, track, caret, (beat) => {
    beat.dur = dur;
    if (dur === 1) beat.dotted = false;
  });
}

const ORDER = [1, 2, 4, 8, 16, 32];

export function stepDuration(song: TabSong, track: number, caret: Caret, dir: number): Edit {
  const cur = song.tracks[track].measures[caret.bar].beats[caret.beat].dur;
  const next = ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(cur) + dir))];
  return setDuration(song, track, caret, next);
}

export function toggleDot(song: TabSong, track: number, caret: Caret): Edit {
  return withBeat(song, track, caret, (beat) => {
    beat.dotted = !beat.dotted;
    if (beat.dotted) beat.doubleDotted = false;
  });
}

/** A rest of the same length after the caret's beat. */
export function insertBeat(song: TabSong, track: number, caret: Caret): Edit {
  const next = copy(song);
  const c = clampCaret(next, track, caret);
  const m = next.tracks[track].measures[c.bar];
  const b = m.beats[c.beat];
  m.beats.splice(c.beat + 1, 0, { dur: b.dur, dotted: b.dotted, triplet: false, notes: [] });
  return { song: next, caret: { ...c, beat: c.beat + 1 } };
}

export function deleteBeat(song: TabSong, track: number, caret: Caret): EditResult {
  const c = clampCaret(song, track, caret);
  if (song.tracks[track].measures[c.bar].beats.length <= 1) {
    return { error: 'A bar needs at least one beat. Use "− Bar" to delete the whole bar.' };
  }
  const next = copy(song);
  next.tracks[track].measures[c.bar].beats.splice(c.beat, 1);
  return { song: next, caret: clampCaret(next, track, c) };
}

function restBar(time: [number, number]): TabMeasure {
  return { beats: Array.from({ length: time[0] }, () => ({ dur: time[1], dotted: false, triplet: false, notes: [] })) };
}

/** A bar of rests, in every track, after the caret's bar. */
export function addBar(song: TabSong, track: number, caret: Caret): Edit {
  const next = copy(song);
  const at = clampCaret(next, track, caret).bar + 1;
  const time = next.tracks[track].measures[at - 1].time ?? next.time;
  for (const t of next.tracks) t.measures.splice(at, 0, restBar(time));
  return { song: next, caret: { bar: at, beat: 0, string: caret.string } };
}

/** Removes the caret's bar from every track. */
export function deleteBar(song: TabSong, track: number, caret: Caret): EditResult {
  if (song.tracks[track].measures.length <= 1) return { error: "A tab needs at least one bar." };
  const next = copy(song);
  const c = clampCaret(next, track, caret);
  for (const t of next.tracks) t.measures.splice(c.bar, 1);
  return { song: next, caret: clampCaret(next, track, c) };
}

/** The caret's beat nearest an x position, and the string nearest a y, in a laid-out bar. */
export function caretFromPoint(bar: number, beats: { x: number }[], x: number, y: number, geo: { top: number; gap: number }, strings: number): Caret {
  let best = 0;
  let bestD = Infinity;
  beats.forEach((b, i) => {
    const d = Math.abs(b.x - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const s = Math.round((y - geo.top) / geo.gap) + 1;
  return { bar, beat: best, string: Math.max(1, Math.min(strings, s)) };
}

function fraction(ticks: number): string {
  const names: Record<number, string> = { 3840: "a whole note", 1920: "a half note", 960: "a quarter", 480: "an eighth", 240: "a sixteenth", 120: "a 32nd" };
  return names[ticks] ?? `${Math.round((ticks / 960) * 100) / 100} beats`;
}

/** "Bar 3: a quarter short" and the like. */
export function barStatus(song: TabSong, track: number, bar: number): string {
  const m = song.tracks[track].measures[bar];
  const [n, d] = m.time ?? song.time;
  const want = (n * WHOLE) / d;
  const have = m.beats.reduce((sum, b) => sum + beatTicks(b), 0);
  let msg = `Bar ${bar + 1}`;
  if (have < want) msg += `: ${fraction(want - have)} short`;
  else if (have > want) msg += `: ${fraction(have - want)} too long`;
  return msg;
}
