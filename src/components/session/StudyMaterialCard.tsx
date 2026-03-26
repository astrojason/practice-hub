import { StudyMaterialSessionForm } from "./forms/StudyMaterialSessionForm";
import type { DashboardStudyMaterial } from "../../api/types";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface Props {
  token: string;
  material: DashboardStudyMaterial;
  isCompletedToday: boolean;
  isTimerActive: boolean;
  isTimerPaused: boolean;
  timerElapsed: number;
  isFormOpen: boolean;
  onStart: () => void;
  onPause: () => void;
  onStopAndSave: () => void;
  onCancel: () => void;
  onFormOpen: () => void;
  onFormClose: () => void;
  onSessionSubmit: (dailyPracticeTime: number) => void;
}

export function StudyMaterialCard({
  token,
  material,
  isCompletedToday,
  isTimerActive,
  isTimerPaused,
  timerElapsed,
  isFormOpen,
  onStart,
  onPause,
  onStopAndSave,
  onCancel,
  onFormOpen,
  onFormClose,
  onSessionSubmit,
}: Props) {
  const inSession = isTimerActive || isTimerPaused;

  return (
    <div
      className={`item-card ${isCompletedToday ? "completed" : ""} ${isTimerActive ? "active" : ""}`}
    >
      <div className="item-card-row">
        <span className="item-status">{isCompletedToday ? "✓" : "○"}</span>
        <div className="item-info">
          <span className="item-name">{material.name}</span>
          {material.url && (
            <a
              href={material.url}
              target="_blank"
              rel="noopener noreferrer"
              className="item-link"
            >
              Open
            </a>
          )}
        </div>
        <div className="item-actions">
          {inSession && (
            <span className="item-elapsed">{formatElapsed(timerElapsed)}</span>
          )}
          {!inSession && (
            <>
              <button className="btn-timer" onClick={onStart}>▶</button>
              <button
                className="btn-secondary"
                onClick={isFormOpen ? onFormClose : onFormOpen}
              >
                {isFormOpen ? "Cancel" : "Log"}
              </button>
            </>
          )}
          {inSession && (
            <>
              {isTimerActive ? (
                <button className="btn-timer" onClick={onPause}>⏸</button>
              ) : (
                <button className="btn-timer" onClick={onStart}>▶</button>
              )}
              <button className="btn-primary" onClick={onStopAndSave}>
                Stop & Save
              </button>
              <button className="btn-danger" onClick={onCancel}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {isFormOpen && (
        <StudyMaterialSessionForm
          token={token}
          studyMaterialId={material.id}
          initialSeconds={timerElapsed}
          onSubmit={onSessionSubmit}
          onCancel={onFormClose}
        />
      )}
    </div>
  );
}
