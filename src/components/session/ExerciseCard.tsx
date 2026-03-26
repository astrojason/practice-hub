import { ExerciseSessionForm } from "./forms/ExerciseSessionForm";
import type { DashboardExercise } from "../../api/types";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface CardProps {
  token: string;
  exercise: DashboardExercise;
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
  isChild?: boolean;
}

function ExerciseSingleCard({
  token,
  exercise,
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
  isChild,
}: CardProps) {
  const ue = exercise.meta.user_exercise;
  const tags: string[] = [];
  if (ue?.randomize_sub_exercises) tags.push("randomize");
  if (ue?.use_keys) tags.push("keys");
  if (ue?.use_scales) tags.push("scales");

  const inSession = isTimerActive || isTimerPaused;

  return (
    <div
      className={`item-card ${isChild ? "child-card" : ""} ${isCompletedToday ? "completed" : ""} ${isTimerActive ? "active" : ""}`}
    >
      <div className="item-card-row">
        <span className="item-status">{isCompletedToday ? "✓" : "○"}</span>
        <div className="item-info">
          <span className="item-name">{exercise.name}</span>
          {tags.length > 0 && (
            <span className="item-tags">
              {tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </span>
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
        <ExerciseSessionForm
          token={token}
          exerciseId={exercise.id}
          initialSeconds={timerElapsed}
          onSubmit={onSessionSubmit}
          onCancel={onFormClose}
        />
      )}
    </div>
  );
}

// ExerciseCard renders the parent card and optionally its children below it.
// The parent passes state lookup functions so each card gets its own state.
interface ExerciseCardProps {
  token: string;
  exercise: DashboardExercise;
  getState: (id: number) => {
    isCompletedToday: boolean;
    isTimerActive: boolean;
    isTimerPaused: boolean;
    timerElapsed: number;
    isFormOpen: boolean;
  };
  onStart: (id: number) => void;
  onPause: (id: number) => void;
  onStopAndSave: (id: number) => void;
  onCancel: (id: number) => void;
  onFormOpen: (id: number) => void;
  onFormClose: (id: number) => void;
  onSessionSubmit: (id: number, dailyPracticeTime: number) => void;
}

export function ExerciseCard({
  token,
  exercise,
  getState,
  onStart,
  onPause,
  onStopAndSave,
  onCancel,
  onFormOpen,
  onFormClose,
  onSessionSubmit,
}: ExerciseCardProps) {
  const state = getState(exercise.id);
  return (
    <div className="exercise-group">
      <ExerciseSingleCard
        token={token}
        exercise={exercise}
        isCompletedToday={state.isCompletedToday}
        isTimerActive={state.isTimerActive}
        isTimerPaused={state.isTimerPaused}
        timerElapsed={state.timerElapsed}
        isFormOpen={state.isFormOpen}
        onStart={() => onStart(exercise.id)}
        onPause={() => onPause(exercise.id)}
        onStopAndSave={() => onStopAndSave(exercise.id)}
        onCancel={() => onCancel(exercise.id)}
        onFormOpen={() => onFormOpen(exercise.id)}
        onFormClose={() => onFormClose(exercise.id)}
        onSessionSubmit={(dpt) => onSessionSubmit(exercise.id, dpt)}
      />
      {exercise.child_exercises.map((child) => {
        const childState = getState(child.id);
        return (
          <ExerciseSingleCard
            key={child.id}
            token={token}
            exercise={child}
            isCompletedToday={childState.isCompletedToday}
            isTimerActive={childState.isTimerActive}
            isTimerPaused={childState.isTimerPaused}
            timerElapsed={childState.timerElapsed}
            isFormOpen={childState.isFormOpen}
            onStart={() => onStart(child.id)}
            onPause={() => onPause(child.id)}
            onStopAndSave={() => onStopAndSave(child.id)}
            onCancel={() => onCancel(child.id)}
            onFormOpen={() => onFormOpen(child.id)}
            onFormClose={() => onFormClose(child.id)}
            onSessionSubmit={(dpt) => onSessionSubmit(child.id, dpt)}
            isChild
          />
        );
      })}
    </div>
  );
}
