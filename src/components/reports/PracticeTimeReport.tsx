import { useEffect, useState } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { getUserStats } from "../../api/client";
import type { PracticeStats } from "../../api/types";

function fmtSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type RangeKey = "daily" | "monthly" | "yearly";

interface Props {
  token: string;
  onClose: () => void;
}

export function PracticeTimeReport({ token, onClose }: Props) {
  const [stats, setStats] = useState<PracticeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("monthly");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getUserStats(token);
        if (!cancelled) setStats(data);
      } catch {
        if (!cancelled) setError("Failed to load practice stats.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Practice Time</h2>
          <button className="btn-ghost modal-close" onClick={onClose} title="Close">
            <XMarkIcon />
          </button>
        </div>

        {loading && <div className="report-loading">Loading…</div>}
        {error && <div className="chart-error">{error}</div>}

        {stats && (
          <div className="modal-body report-body">
            {/* Totals row */}
            <div className="report-totals">
              <div className="report-total-card">
                <span className="report-total-label">Today</span>
                <span className="report-total-value">{fmtSeconds(stats.totals.daily)}</span>
              </div>
              <div className="report-total-card">
                <span className="report-total-label">This month</span>
                <span className="report-total-value">{fmtSeconds(stats.totals.monthly)}</span>
              </div>
              <div className="report-total-card">
                <span className="report-total-label">This year</span>
                <span className="report-total-value">{fmtSeconds(stats.totals.yearly)}</span>
              </div>
              <div className="report-total-card">
                <span className="report-total-label">All time</span>
                <span className="report-total-value">{fmtSeconds(stats.totals.lifetime)}</span>
              </div>
            </div>

            {/* Breakdown by type */}
            <div className="report-section">
              <span className="report-section-label">Breakdown</span>
              <div className="report-type-breakdown">
                {(
                  [
                    { label: "Songs", key: "songs" },
                    { label: "Exercises", key: "exercises" },
                    { label: "Study materials", key: "studyMaterials" },
                    { label: "Open sessions", key: "openSessions" },
                  ] as const
                ).map(({ label, key }) => {
                  const val = stats.totalsByType[key];
                  const pct = stats.totals.lifetime > 0 ? (val / stats.totals.lifetime) * 100 : 0;
                  return (
                    <div key={key} className="report-type-row">
                      <span className="report-type-label">{label}</span>
                      <div className="report-type-bar-track">
                        <div
                          className="report-type-bar-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="report-type-time">{fmtSeconds(val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Streak */}
            <div className="report-section report-streaks">
              <div className="report-streak-item">
                <span className="report-streak-value">{stats.rangeHighlights.all.longestStreakDays}</span>
                <span className="report-streak-label">Best goal streak (days)</span>
              </div>
              <div className="report-streak-item">
                <span className="report-streak-value">{stats.rangeHighlights.all.longestNonZeroStreak}</span>
                <span className="report-streak-label">Best practice streak (days)</span>
              </div>
            </div>

            {/* Chart range tabs */}
            <div className="report-section">
              <div className="report-range-tabs">
                {(["daily", "monthly", "yearly"] as RangeKey[]).map((r) => (
                  <button
                    key={r}
                    className={`report-range-tab ${range === r ? "active" : ""}`}
                    onClick={() => setRange(r)}
                  >
                    {r === "daily" ? "Last 30 days" : r === "monthly" ? "This year" : "By year"}
                  </button>
                ))}
              </div>

              {range === "daily" && (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={stats.chart.daily} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "var(--text-dim)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval={6}
                    />
                    <YAxis
                      tickFormatter={(v) => fmtSeconds(v)}
                      tick={{ fill: "var(--text-dim)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                      formatter={(v: unknown) => [fmtSeconds(v as number), "Practice time"]}
                    />
                    <Bar dataKey="totalSeconds" radius={[3, 3, 0, 0]}>
                      {stats.chart.daily.map((entry) => (
                        <Cell
                          key={entry.date}
                          fill={entry.totalSeconds > 0 ? "var(--accent)" : "var(--surface-3)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}

              {range === "monthly" && (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={stats.chart.monthly} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--text-dim)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => fmtSeconds(v)}
                      tick={{ fill: "var(--text-dim)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                      formatter={(v: unknown) => [fmtSeconds(v as number), "Practice time"]}
                    />
                    <Bar dataKey="totalSeconds" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}

              {range === "yearly" && (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={stats.chart.yearly} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                    <XAxis
                      dataKey="year"
                      tick={{ fill: "var(--text-dim)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => fmtSeconds(v)}
                      tick={{ fill: "var(--text-dim)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                      formatter={(v: unknown) => [fmtSeconds(v as number), "Practice time"]}
                    />
                    <Bar dataKey="totalSeconds" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
