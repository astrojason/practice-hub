interface Props {
  displayedSeconds: number;
  dailyGoalSeconds: number;
  goalReached: boolean;
  allComplete: boolean;
  isRebuilding: boolean;
  onRebuild: () => void;
  onOpenSession: () => void;
  onSignOut: () => void;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SessionHeader({
  displayedSeconds,
  dailyGoalSeconds,
  goalReached,
  allComplete,
  isRebuilding,
  onRebuild,
  onOpenSession,
  onSignOut,
}: Props) {
  const progressPct = Math.min(
    100,
    Math.round((displayedSeconds / dailyGoalSeconds) * 100)
  );

  return (
    <header className="session-header">
      <div className="session-header-top">
        <h1 className="session-title">Practice Hub</h1>
        <div className="session-header-actions">
          <button onClick={onOpenSession} className="btn-secondary">
            Open Session
          </button>
          <button
            onClick={onRebuild}
            disabled={isRebuilding}
            className="btn-secondary"
          >
            {isRebuilding ? "Rebuilding…" : "Rebuild"}
          </button>
          <button onClick={onSignOut} className="btn-ghost">
            Sign out
          </button>
        </div>
      </div>

      <div className="session-timer-row">
        <span className={`session-timer ${goalReached ? "goal-reached" : ""}`}>
          {formatTime(displayedSeconds)}
        </span>
        <span className="session-goal-label">
          / {formatTime(dailyGoalSeconds)} goal
        </span>
      </div>

      <div className="progress-bar-track">
        <div
          className={`progress-bar-fill ${goalReached ? "complete" : ""}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {allComplete && (
        <div className="all-complete-banner">
          All suggested items completed for today!
        </div>
      )}
    </header>
  );
}
