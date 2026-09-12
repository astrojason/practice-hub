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

function dayKey(timestamp: number): string {
  // Local calendar day, matching the en-CA (YYYY-MM-DD) convention used
  // elsewhere in the app (see SessionView.tsx, LastSessionInfo.tsx).
  return new Date(timestamp).toLocaleDateString("en-CA");
}

function previousCalendarDay(d: Date): Date {
  // Step by calendar date component, not by a fixed 24h of milliseconds, so
  // this doesn't misfire across a DST transition.
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  return prev;
}

/**
 * Current consecutive-day practice streak, counting back from today. If
 * today has no session yet, the streak is still "alive" as long as
 * yesterday was practiced — the day isn't over.
 *
 * A single missed day doesn't break the streak ("don't miss twice") — it's
 * skipped over without adding to the count. Missing two days in a row does
 * break it.
 */
export function calculateStreak(sessions: { created_timestamp: number }[], now: number = Date.now()): number {
  if (sessions.length === 0) return 0;

  const practicedDays = new Set(sessions.map((s) => dayKey(s.created_timestamp)));

  let cursor = new Date(now);
  if (!practicedDays.has(dayKey(cursor.getTime()))) {
    cursor = previousCalendarDay(cursor);
  }

  let streak = 0;
  let missedInARow = 0;
  while (missedInARow < 2) {
    if (practicedDays.has(dayKey(cursor.getTime()))) {
      streak++;
      missedInARow = 0;
    } else {
      missedInARow++;
      if (missedInARow >= 2) break;
    }
    cursor = previousCalendarDay(cursor);
  }
  return streak;
}
