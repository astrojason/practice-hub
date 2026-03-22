import { useEffect, useState } from "react";
import { getDashboard } from "../api/client";
import type { DashboardData } from "../api/types";

interface Props {
  token: string;
  onSignOut: () => Promise<void>;
}

export function SessionView({ token, onSignOut }: Props) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboard(token)
      .then((data) => {
        console.log("[practice-hub] Dashboard data:", data);
        setDashboard(data);
      })
      .catch((err) => {
        console.error("[practice-hub] Dashboard load failed:", err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [token]);

  if (error) {
    return (
      <div className="session-view">
        <p className="error">Failed to load dashboard: {error}</p>
        <button onClick={onSignOut}>Sign out</button>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="session-view">
        <p>Loading dashboard…</p>
      </div>
    );
  }

  const projectSongs = dashboard.project?.songs ?? [];
  const reviewSongs = dashboard.to_review?.songs ?? [];

  return (
    <div className="session-view">
      <header>
        <h1>Practice Hub</h1>
        <button onClick={onSignOut}>Sign out</button>
      </header>

      <section>
        <h2>Today's Session</h2>
        <p>
          Project songs: {projectSongs.length} &nbsp;|&nbsp; Repertoire review:{" "}
          {reviewSongs.length} &nbsp;|&nbsp; Exercises:{" "}
          {dashboard.exercises.length} &nbsp;|&nbsp; Study materials:{" "}
          {dashboard.study_materials.length}
        </p>
        <p className="placeholder-note">
          Full session view coming in Phase 2.
        </p>
      </section>
    </div>
  );
}
