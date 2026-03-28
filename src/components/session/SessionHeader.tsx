import {
  ArrowPathIcon,
  ArrowRightStartOnRectangleIcon,
  CheckCircleIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
} from "@heroicons/react/16/solid";

interface Props {
  displayedSeconds: number;
  dailyGoalSeconds: number;
  goalReached: boolean;
  allComplete: boolean;
  isRebuilding: boolean;
  openSessionActive: boolean;
  openSessionElapsed: number;
  onRebuild: () => void;
  onOpenSession: () => void;
  onQuickAdd: () => void;
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
  openSessionActive,
  openSessionElapsed,
  onRebuild,
  onOpenSession,
  onQuickAdd,
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
        <div className="session-timer-row">
          <span className={`session-timer ${goalReached ? "goal-reached" : ""}`}>
            {formatTime(displayedSeconds)}
          </span>
          <span className="session-goal-label">
            / {formatTime(dailyGoalSeconds)}
          </span>
        </div>
        <div className="session-header-actions">
          <button onClick={onOpenSession} className={`btn-secondary${openSessionActive ? " btn-open-session-active" : ""}`}>
            <PlusIcon className="icon-sm" />
            {openSessionActive ? formatTime(openSessionElapsed) : "Open Session"}
          </button>
          <button onClick={onQuickAdd} className="btn-secondary">
            <MagnifyingGlassPlusIcon className="icon-sm" /> Quick add
          </button>
          <button onClick={onRebuild} disabled={isRebuilding} className="btn-ghost">
            <ArrowPathIcon className="icon-sm" />
            {isRebuilding ? "Rebuilding…" : "Rebuild"}
          </button>
          <button onClick={onSignOut} className="btn-ghost">
            <ArrowRightStartOnRectangleIcon className="icon-sm" />
            Sign out
          </button>
        </div>
      </div>

      <div className="progress-bar-track">
        <div
          className={`progress-bar-fill ${goalReached ? "complete" : ""}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {allComplete && (
        <div className="all-complete-banner">
          <CheckCircleIcon className="icon-sm" />
          All done for today
        </div>
      )}
    </header>
  );
}
