// What the quiz history says you find hard: degrees in a key, note names, spots on the neck
// and intervals — so the other pages can point them out.
//
// - something becomes a weak spot when, over your last few tries (up to 6), you miss it or are
//   much slower than your usual pace (at least 2 tries needed);
// - it clears as soon as you answer it right, at your usual pace or faster, 3 times in a row.
//
// "Your usual pace" is either your typical (middle) time for that kind of question over your
// last 5 sessions with it, times 1.3, or a fixed time you set.
//
// Each kind of weak spot has its own reach: a degree is weak only in the key it was asked in
// (the 4th of Bb), a note name is weak everywhere (every Eb), a spot is that one fret.

import type { QuizRecord } from "./history";
import { KEYS, bothNames } from "./theory";

/** How many recent tries decide whether something is weak. */
export const RECENT = 6;
/** Quick right answers in a row that clear a weak spot. */
export const TO_CLEAR = 3;
/** Sessions the usual pace is taken from. */
export const PACE_SESSIONS = 5;
/** Answers of a kind needed before speed is judged at all. */
export const MIN_ANSWERS = 10;
/** "Slow" means this many times your typical answer time. */
export const SLOW = 1.3;

export type Pace = { type: "average" } | { type: "fixed"; ms: number };

export interface Stat {
  /** Which kind of question this comes from (index into QUIZ_KINDS). */
  kind: number;
  tries: number;
  misses: number;
  totalMs: number;
  /** The latest tries, oldest first: [right, milliseconds]. */
  recent: [boolean, number][];
}

const newStat = (kind: number): Stat => ({ kind, tries: 0, misses: 0, totalMs: 0, recent: [] });

function add(st: Stat, r: QuizRecord) {
  st.kind = r.kind;
  st.tries++;
  st.misses += r.correct ? 0 : 1;
  st.totalMs += r.ms;
  st.recent.push([r.correct, r.ms]);
  if (st.recent.length > RECENT) st.recent.shift();
}

const stat = (st: Stat) => ({ ...st, avgMs: st.tries ? Math.floor(st.totalMs / st.tries) : 0, right: st.tries - st.misses });
export { stat as statInfo };

export class Weakness {
  /** `${keyPc}:${degree}` from "Find the scale degree". */
  degree = new Map<string, Stat>();
  /** Pitch class from "Name the note". */
  note = new Map<number, Stat>();
  /** `${string}:${fret}` from the note and degree questions. */
  spot = new Map<string, Stat>();
  /** Interval name from the interval questions. */
  interval = new Map<string, Stat>();
  avgMs = 0;
  /** Typical (median) answer time for each kind over the recent sessions. */
  avgByKind = new Map<number, number>();
  /** How many recent answers of each kind that typical time comes from. */
  countByKind = new Map<number, number>();

  constructor(
    history: QuizRecord[],
    public pace: Pace = { type: "average" },
  ) {
    let total = 0;
    for (const r of history) {
      total += r.ms;
      const spotKey = r.spot ? `${r.spot[0]}:${r.spot[1]}` : null;
      const get = <K>(m: Map<K, Stat>, k: K) => {
        let st = m.get(k);
        if (!st) {
          st = newStat(r.kind);
          m.set(k, st);
        }
        return st;
      };
      if (r.kind === 5) {
        // "Find the note": how well each note name is found counts as naming it.
        const pc = KEYS.indexOf(r.item as (typeof KEYS)[number]);
        if (pc >= 0) add(get(this.note, pc), r);
      } else if (r.kind === 0) {
        const pc = KEYS.indexOf(r.item as (typeof KEYS)[number]);
        if (pc >= 0) add(get(this.note, pc), r);
        if (spotKey) add(get(this.spot, spotKey), r);
      } else if (r.kind === 1) {
        if (r.key !== null) add(get(this.degree, `${r.key}:${r.item}`), r);
        if (spotKey) add(get(this.spot, spotKey), r);
      } else if (r.kind === 2 || r.kind === 3) {
        add(get(this.interval, r.item), r);
      }
    }
    this.avgMs = history.length ? Math.floor(total / history.length) : 0;
    for (const k of new Set(history.map((r) => r.kind))) {
      const sessions: number[] = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const r = history[i];
        if (r.kind !== k || sessions.includes(r.session)) continue;
        if (sessions.length === PACE_SESSIONS) break;
        sessions.push(r.session);
      }
      const times = history.filter((r) => r.kind === k && sessions.includes(r.session)).map((r) => r.ms).sort((a, b) => a - b);
      if (!times.length) continue;
      const mid = Math.floor(times.length / 2);
      this.avgByKind.set(k, times.length % 2 === 0 ? Math.floor((times[mid - 1] + times[mid]) / 2) : times[mid]);
      this.countByKind.set(k, times.length);
    }
  }

  /** Your usual pace for a kind of question, in ms, and how many answers it still needs (0 once it's yours). */
  paceSource(kind: number): { ms: number | null; need: number } {
    if (this.pace.type === "fixed") return { ms: this.pace.ms, need: 0 };
    const have = this.countByKind.get(kind) ?? 0;
    const m = this.avgByKind.get(kind);
    if (m !== undefined && have >= MIN_ANSWERS && m > 0) return { ms: m * SLOW, need: 0 };
    return { ms: null, need: MIN_ANSWERS - Math.min(have, MIN_ANSWERS) };
  }

  paceMs(kind: number): number | null {
    return this.paceSource(kind).ms;
  }

  private quick(kind: number, ms: number): boolean {
    const limit = this.paceMs(kind);
    return limit === null || ms <= limit;
  }

  /** Right answers at your usual pace (or faster) at the end of the recent tries. */
  quickRun(st: Stat): number {
    let n = 0;
    for (let i = st.recent.length - 1; i >= 0; i--) {
      const [ok, ms] = st.recent[i];
      if (!(ok && this.quick(st.kind, ms))) break;
      n++;
    }
    return n;
  }

  /** How much trouble the recent tries show: 0 is fine; above 0.35 counts as a weak spot. */
  score(st: Stat): number {
    if (st.recent.length < 2 || this.quickRun(st) >= TO_CLEAR) return 0;
    const n = st.recent.length;
    const miss = st.recent.filter(([ok]) => !ok).length / n;
    const avg = st.recent.reduce((s, [, ms]) => s + ms, 0) / n;
    const limit = this.paceMs(st.kind);
    const slow = limit === null ? 0 : Math.max(0, avg / limit - 1);
    return miss + 0.5 * slow;
  }

  isWeak(st: Stat | undefined): boolean {
    return st !== undefined && this.score(st) > 0.35;
  }

  /** Quick right answers in a row still needed to clear a weak spot. */
  toClear(st: Stat): number {
    return Math.max(0, TO_CLEAR - this.quickRun(st));
  }

  /** One line about a weak stat: the record and what clears it. */
  describe(what: string, st: Stat): string {
    const need = this.toClear(st);
    const pace = this.paceMs(st.kind);
    const info = stat(st);
    return `${what}: ${info.right} of ${st.tries} right, ${(info.avgMs / 1000).toFixed(1)} s on average — ${need} more quick right answer${need === 1 ? "" : "s"} in a row to clear it${
      pace === null ? "" : ` (quick = ${(pace / 1000).toFixed(1)} s or less)`
    }`;
  }

  /** Why a note on the neck is a weak spot, if it is: one line per reason. */
  reasons(keyPc: number, degree: string, pc: number, spot: [number, number], strings = 6): string[] {
    const out: string[] = [];
    const d = this.degree.get(`${keyPc}:${degree}`);
    if (d && this.isWeak(d)) out.push(this.describe(`Finding the ${degree} in ${KEYS[((keyPc % 12) + 12) % 12]} (only in this key)`, d));
    const n = this.note.get(((pc % 12) + 12) % 12);
    if (n && this.isWeak(n)) out.push(this.describe(`Naming ${bothNames(pc)} (every ${bothNames(pc)} on the neck, any key)`, n));
    const sp = this.spot.get(`${spot[0]}:${spot[1]}`);
    if (sp && this.isWeak(sp)) out.push(this.describe(`This spot (string ${strings - spot[0]}, fret ${spot[1]} only)`, sp));
    return out;
  }
}
