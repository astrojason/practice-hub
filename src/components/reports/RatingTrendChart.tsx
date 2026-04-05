import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { SongSession, ExerciseSession, StudyMaterialSession } from "../../api/types";
import {
  getSongSessionHistory,
  getExerciseSessionHistory,
  getStudyMaterialSessionHistory,
} from "../../api/client";

type AnySession = SongSession | ExerciseSession | StudyMaterialSession;
type EntityType = "song" | "exercise" | "study_material";

const RATING_VALUES: Record<string, number> = {
  Awful: 1,
  Bad: 2,
  Neutral: 3,
  Good: 4,
  Great: 5,
};

const RATING_LABELS: Record<number, string> = {
  1: "Awful",
  2: "Bad",
  3: "Neutral",
  4: "Good",
  5: "Great",
};

function toChartPoints(sessions: AnySession[]) {
  return sessions
    .filter((s) => s.rating != null)
    .map((s) => ({
      date: new Date(s.created_timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value: RATING_VALUES[s.rating!] ?? null,
      rating: s.rating,
      ts: s.created_timestamp,
    }))
    .sort((a, b) => a.ts - b.ts);
}

function averageRating(sessions: AnySession[]): number | null {
  const rated = sessions.filter((s) => s.rating != null);
  if (rated.length === 0) return null;
  const sum = rated.reduce((acc, s) => acc + (RATING_VALUES[s.rating!] ?? 0), 0);
  return sum / rated.length;
}

interface Props {
  token: string;
  entityType: EntityType;
  entityId: number;
  /** Sessions already loaded from dashboard meta — if provided, no fetch needed */
  sessions?: AnySession[];
}

export function RatingTrendChart({ token, entityType, entityId, sessions: preloaded }: Props) {
  const [sessions, setSessions] = useState<AnySession[]>(preloaded ?? []);
  const [loading, setLoading] = useState(!preloaded);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preloaded) {
      setSessions(preloaded);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        let loaded: AnySession[] = [];
        if (entityType === "song") {
          const res = await getSongSessionHistory(token, entityId, 1, 50);
          loaded = res.user_song_sessions;
        } else if (entityType === "exercise") {
          const res = await getExerciseSessionHistory(token, entityId, 1, 50);
          loaded = res.user_exercise_sessions;
        } else {
          const res = await getStudyMaterialSessionHistory(token, entityId, 1, 50);
          loaded = res.user_study_material_sessions;
        }
        if (!cancelled) setSessions(loaded);
      } catch {
        if (!cancelled) setError("Failed to load session history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token, entityType, entityId, preloaded]);

  if (loading) return <div className="chart-loading">Loading history…</div>;
  if (error) return <div className="chart-error">{error}</div>;
  if (sessions.length === 0) return <div className="chart-empty">No sessions logged yet.</div>;

  const points = toChartPoints(sessions);
  const avg = averageRating(sessions);
  const avgLabel = avg != null ? RATING_LABELS[Math.round(avg)] : null;

  return (
    <div className="rating-chart">
      {avg != null && (
        <div className="rating-chart-avg">
          Avg: <strong>{avg.toFixed(1)}</strong>
          {avgLabel && <span className="rating-chart-avg-label">{avgLabel}</span>}
        </div>
      )}
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--text-dim)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[1, 5]}
            ticks={[1, 2, 3, 4, 5]}
            tickFormatter={(v) => RATING_LABELS[v]?.[0] ?? ""}
            tick={{ fill: "var(--text-dim)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "var(--text-dim)" }}
            formatter={(value: unknown) => [RATING_LABELS[value as number] ?? value, "Rating"]}
          />
          {avg != null && (
            <ReferenceLine y={avg} stroke="var(--accent)" strokeDasharray="3 3" strokeOpacity={0.5} />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 1 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="rating-chart-count">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</div>
    </div>
  );
}
