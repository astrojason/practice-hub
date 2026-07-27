import {
  ArrowPathIcon,
  ArrowRightStartOnRectangleIcon,
  ChartBarIcon,
  CheckCircleIcon,
  MagnifyingGlassPlusIcon,
  MusicalNoteIcon,
  PlusIcon,
  QuestionMarkCircleIcon,
  RectangleStackIcon,
} from "@heroicons/react/16/solid";

interface Props {
  displayedSeconds: number;
  dailyGoalSeconds: number;
  goalReached: boolean;
  allComplete: boolean;
  isRebuilding: boolean;
  openSessionActive: boolean;
  openSessionElapsed: number;
  version: string;
  onRebuild: () => void;
  onOpenSession: () => void;
  onAdd: () => void;
  onQuickAdd: () => void;
  onMetronome: () => void;
  onSignOut: () => void;
  onReports: () => void;
  onGpLibrary: () => void;
  onCalendar: () => void;
  onBrowse: () => void;
  onHelp: () => void;
  onChangelog: () => void;
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
  version,
  onRebuild,
  onOpenSession,
  onAdd,
  onQuickAdd,
  onMetronome,
  onSignOut,
  onReports,
  onGpLibrary,
  onCalendar,
  onBrowse,
  onHelp,
  onChangelog,
}: Props) {
  const progressPct = Math.min(
    100,
    Math.round((displayedSeconds / dailyGoalSeconds) * 100)
  );

  return (
    <header className="session-header">
      <div className="session-header-top">
        <h1 className="session-title">
          Practice Hub{' '}
          <button
            onClick={onChangelog}
            className="btn-ghost"
            title="View changelog"
            style={{ fontSize: '0.7em', fontWeight: 'normal', padding: '0.1em 0.4em', verticalAlign: 'middle' }}
          >
            v{version}
          </button>
        </h1>
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
          <button onClick={onAdd} className="btn-secondary">
            <PlusIcon className="icon-sm" /> Add
          </button>
          <button onClick={onQuickAdd} className="btn-secondary">
            <MagnifyingGlassPlusIcon className="icon-sm" /> Quick add
          </button>
          <button onClick={onReports} className="btn-ghost" title="Practice time report">
            <ChartBarIcon className="icon-sm" /> Reports
          </button>
          <button onClick={onGpLibrary} className="btn-ghost" title="Guitar Pro library scanner">
            <MusicalNoteIcon className="icon-sm" /> GP Library
          </button>
          <button onClick={onCalendar} className="btn-ghost" title="Practice calendar">
            Calendar
          </button>
          <button onClick={onBrowse} className="btn-ghost" title="Browse catalog">
            <RectangleStackIcon className="icon-sm" /> Browse
          </button>
          <button onClick={onHelp} className="btn-ghost" title="Help & tutorials">
            <QuestionMarkCircleIcon className="icon-sm" /> Help
          </button>
          <button onClick={onMetronome} className="btn-ghost" title="Open metronome">
            ♩ Metronome
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
