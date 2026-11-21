// Speed trainer: a timed session of rounds whose tempo steps up from a start to a
// target, with rests between rounds, and a log of every session.

import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";

export type Exercise = "scale" | "arpeggio" | "sequence" | "changes";

export const EXERCISES: { id: Exercise; name: string }[] = [
  { id: "scale", name: "Scale run" },
  { id: "arpeggio", name: "Arpeggio" },
  { id: "sequence", name: "Scale sequence" },
  { id: "changes", name: "Progression arpeggios" },
];

export interface SpeedSetup {
  minutes: number;
  startBpm: number;
  targetBpm: number;
  /** Length of each playing round, in seconds. */
  workSecs: number;
  /** Rest after each round, in seconds (0 = no rests). */
  restSecs: number;
  exercise: Exercise;
}

export const DEFAULT_SPEED: SpeedSetup = { minutes: 10, startBpm: 80, targetBpm: 120, workSecs: 60, restSecs: 20, exercise: "scale" };

export type Phase = { kind: "work"; bpm: number; secs: number } | { kind: "rest"; secs: number };

/**
 * The rounds of a session: as many work rounds as fit (with a rest after each but the last),
 * the tempo climbing evenly from the start to the target and the last round at the target.
 */
export function phases(s: SpeedSetup): Phase[] {
  const total = Math.max(1, s.minutes) * 60;
  const work = Math.max(10, s.workSecs);
  const rest = s.restSecs;
  const rounds = Math.max(1, Math.floor((total + rest) / (work + rest)));
  const out: Phase[] = [];
  for (let i = 0; i < rounds; i++) {
    const t = rounds === 1 ? 1 : i / (rounds - 1);
    out.push({ kind: "work", bpm: Math.round(s.startBpm + (s.targetBpm - s.startBpm) * t), secs: work });
    if (i + 1 < rounds && rest > 0) out.push({ kind: "rest", secs: rest });
  }
  return out;
}

export const totalSecs = (p: Phase[]) => p.reduce((s, x) => s + x.secs, 0);

export const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;

/** One logged session. */
export interface SpeedLog {
  /** When it started (seconds since 1970). */
  when: number;
  exercise: string;
  /** What it was played on, e.g. "C Major (Ionian) · position 1". */
  detail: string;
  startBpm: number;
  topBpm: number;
  /** Time spent, rests included, in seconds. */
  secs: number;
  /** Whether the whole session was played to the end. */
  finished: boolean;
}

const KEY = "ph:fretboard:speed-log";

export function loadSpeedLog(): { logs: SpeedLog[]; error: string | null } {
  const r = readLocalStorageJSON<SpeedLog[]>(KEY, []);
  return { logs: Array.isArray(r.value) ? r.value : [], error: r.error };
}

/** Append a session to the saved log. Throws if it cannot be saved. */
export function appendSpeedLog(log: SpeedLog): SpeedLog[] {
  const current = loadSpeedLog();
  if (current.error) throw new Error(current.error);
  const next = [...current.logs, log];
  writeLocalStorageJSON(KEY, next);
  return next;
}
