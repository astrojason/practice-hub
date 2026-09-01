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
