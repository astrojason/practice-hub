const DAY_MS = 86_400_000;
const ORANGE_THRESHOLD_DAYS = 7;
const RED_THRESHOLD_DAYS = 14;

export type UsageStalenessLevel = "none" | "orange" | "red";

/**
 * An item younger than the orange threshold is never flagged — it hasn't had
 * a fair chance at a session yet, regardless of how long it's gone unpracticed.
 */
export function getUsageStalenessLevel(
  itemCreatedTimestamp: number,
  sessions: { created_timestamp: number }[],
  now: number = Date.now()
): UsageStalenessLevel {
  const daysSinceAdded = (now - itemCreatedTimestamp) / DAY_MS;
  if (daysSinceAdded < ORANGE_THRESHOLD_DAYS) return "none";

  const lastSessionTimestamp = sessions.length > 0 ? sessions[0].created_timestamp : null;
  const daysSinceLastSession =
    lastSessionTimestamp != null ? (now - lastSessionTimestamp) / DAY_MS : daysSinceAdded;

  if (daysSinceLastSession >= RED_THRESHOLD_DAYS) return "red";
  if (daysSinceLastSession >= ORANGE_THRESHOLD_DAYS) return "orange";
  return "none";
}

/**
 * Combines session lists that may overlap (e.g. a frozen full-catalog
 * snapshot and the live, possibly newer, active-children list) into one
 * list ordered most-recent-first, de-duplicated by session id.
 */
export function mergeSessionsById<T extends { id: number; created_timestamp: number }>(
  ...lists: T[][]
): T[] {
  const byId = new Map<number, T>();
  for (const list of lists) {
    for (const session of list) byId.set(session.id, session);
  }
  return [...byId.values()].sort((a, b) => b.created_timestamp - a.created_timestamp);
}

/** Sum of `seconds` across sessions (already de-duplicated by the caller). */
export function totalSessionSeconds(sessions: { seconds: number }[]): number {
  return sessions.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
}

/** Compact duration: "45s", "35m", "1h 5m". */
export function formatPracticeDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function dayKey(timestamp: number): string {
  // Local calendar day, matching the en-CA (YYYY-MM-DD) convention used
  // elsewhere in the app (see SessionView.tsx, LastSessionInfo.tsx).
  return new Date(timestamp).toLocaleDateString("en-CA");
}

/** A streak token is earned each time the streak reaches a multiple of this. */
export const STREAK_TOKEN_INTERVAL = 7;

export interface StreakGap {
  /** First missed local calendar day, YYYY-MM-DD. */
  from: string;
  /** Second missed local calendar day, YYYY-MM-DD. */
  to: string;
}

export interface StreakStatus {
  /** Current streak; 0 while an open gap is waiting on a token decision. */
  streak: number;
  /** Tokens earned across the item's whole history (1 per 7 completed days). */
  tokensEarned: number;
  /** Earned minus spent; never negative. */
  tokenBalance: number;
  /**
   * The two most recent days were missed (today still pending) on a 7+ day
   * streak, and a token is available to cover them. Spending it keeps the
   * streak alive; the next completion continues it. `streakAtRisk` is the
   * count that would be lost.
   */
  openGap: (StreakGap & { streakAtRisk: number }) | null;
}

/**
 * Current consecutive-day practice streak, counting forward from the first
 * practiced day up to today. Today doesn't count as a miss while it's still
 * in progress, so the streak stays alive as long as yesterday was practiced.
 *
 * A single missed day doesn't break the streak ("don't miss twice") — it's
 * skipped over without adding to the count. Missing two days in a row breaks
 * it, unless the user spent a streak token on exactly that gap (`uses`): the
 * token forgives it without adding to the count, and the next completion
 * continues the streak. Tokens are never applied automatically.
 *
 * A token is earned each time the completed-day count reaches a multiple of 7
 * (only real completions count — skipped and forgiven days don't) and
 * accumulates; each recorded use spends one. A 3+ day miss can't be covered.
 */
export function getStreakStatus(
  sessions: { created_timestamp: number }[],
  uses: { covered_from: string }[] = [],
  now: number = Date.now()
): StreakStatus {
  if (sessions.length === 0) return { streak: 0, tokensEarned: 0, tokenBalance: 0, openGap: null };

  // Work in whole local calendar days (UTC-midnight day numbers built from the
  // local YYYY-MM-DD key, so DST can't skew the gaps) and step gap-to-gap
  // rather than day-by-day, so long histories stay cheap.
  const dayNumber = (timestamp: number): number => {
    const [y, m, d] = dayKey(timestamp).split("-").map(Number);
    return Date.UTC(y, m - 1, d) / DAY_MS;
  };
  const isoOfDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
  const practiced = [...new Set(sessions.map((s) => dayNumber(s.created_timestamp)))].sort((a, b) => a - b);
  const covered = new Set(uses.map((u) => u.covered_from));

  let streak = 0;
  let tokensEarned = 0;
  let pendingGap: (StreakGap & { streakAtRisk: number }) | null = null;

  // Apply `missed` consecutive unpracticed days starting the day after `lastDay`.
  const applyMisses = (missed: number, lastDay: number, trailing: boolean) => {
    if (missed < 2) return;
    if (missed === 2 && covered.has(isoOfDay(lastDay + 1))) return;
    if (trailing && missed === 2 && streak >= STREAK_TOKEN_INTERVAL) {
      pendingGap = { from: isoOfDay(lastDay + 1), to: isoOfDay(lastDay + 2), streakAtRisk: streak };
    }
    streak = 0;
  };

  let prev = practiced[0];
  for (const day of practiced) {
    if (day !== prev) applyMisses(day - prev - 1, prev, false);
    streak++;
    if (streak % STREAK_TOKEN_INTERVAL === 0) tokensEarned++;
    prev = day;
  }

  // Days after the last practice up to (not including) today are misses;
  // today itself is still in progress.
  applyMisses(Math.max(0, dayNumber(now) - prev - 1), prev, true);

  const tokenBalance = Math.max(0, tokensEarned - uses.length);
  return { streak, tokensEarned, tokenBalance, openGap: tokenBalance > 0 ? pendingGap : null };
}
