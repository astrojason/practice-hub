// The quiz history: every answer, kept in local storage so reports and weak spots survive restarts.

import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";

export interface QuizRecord {
  /** When it was answered (seconds since 1970). */
  when: number;
  /** The training session it belongs to (its start time). */
  session: number;
  /** Which kind of question (index into QUIZ_KINDS). */
  kind: number;
  /** What the right answer was ("G", "b3", "Perfect 5th"...). */
  item: string;
  correct: boolean;
  /** How long the answer took, in milliseconds. */
  ms: number;
  /** The key the question was asked in, as a pitch class 0-11. */
  key: number | null;
  /** Where on the neck the note was (string 0 = low E, fret). */
  spot: [number, number] | null;
}

const KEY = "ph:fretboard:quiz-history";

export function loadHistory(): { records: QuizRecord[]; error: string | null } {
  const r = readLocalStorageJSON<QuizRecord[]>(KEY, []);
  return { records: Array.isArray(r.value) ? r.value : [], error: r.error };
}

/** Add an answer to the saved history. Throws if it cannot be saved. */
export function appendRecord(all: QuizRecord[], rec: QuizRecord): QuizRecord[] {
  const next = [...all, rec];
  writeLocalStorageJSON(KEY, next);
  return next;
}

/** Forget every saved answer. Throws if it cannot be done. */
export function clearHistory(): void {
  writeLocalStorageJSON(KEY, []);
}

export function bestStreak(records: QuizRecord[]): number {
  let best = 0;
  let run = 0;
  let session: number | null = null;
  for (const r of records) {
    if (session !== r.session) {
      session = r.session;
      run = 0;
    }
    if (r.correct) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  return best;
}

/** Totals for a set of answers. */
export function summarize(records: QuizRecord[]): { answered: number; right: number; avgMs: number; fastestMs: number } {
  const answered = records.length;
  const right = records.filter((r) => r.correct).length;
  const avgMs = answered ? Math.floor(records.reduce((s, r) => s + r.ms, 0) / answered) : 0;
  const rightTimes = records.filter((r) => r.correct).map((r) => r.ms);
  return { answered, right, avgMs, fastestMs: rightTimes.length ? Math.min(...rightTimes) : 0 };
}

/** Per answer item: tries, misses and average time, slowest first. */
export function byItem(records: QuizRecord[]): { item: string; tries: number; misses: number; avgMs: number }[] {
  const map = new Map<string, { tries: number; misses: number; total: number }>();
  for (const r of records) {
    const e = map.get(r.item) ?? { tries: 0, misses: 0, total: 0 };
    e.tries++;
    e.misses += r.correct ? 0 : 1;
    e.total += r.ms;
    map.set(r.item, e);
  }
  return [...map.entries()]
    .map(([item, e]) => ({ item, tries: e.tries, misses: e.misses, avgMs: Math.floor(e.total / e.tries) }))
    .sort((a, b) => b.avgMs - a.avgMs);
}
