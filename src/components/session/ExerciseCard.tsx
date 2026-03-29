import { useEffect, useState } from "react";
import {
  CheckIcon,
  NoSymbolIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
} from "@heroicons/react/16/solid";
import { ExerciseSessionForm } from "./forms/ExerciseSessionForm";
import { SessionModal } from "./SessionModal";
import { LastSessionInfo } from "./LastSessionInfo";
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
  onOpenFile?: (path: string, mediaType: "audio" | "video") => void;
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
  onOpenFile,
  isChild,
}: CardProps) {
  const ue = exercise.meta.user_exercise;
  const tags: string[] = [];
  if (ue?.randomize_sub_exercises) tags.push("randomize");
  if (ue?.use_keys) tags.push("keys");
  if (ue?.use_scales) tags.push("scales");

  const inSession = isTimerActive || isTimerPaused;
  const [modalOpen, setModalOpen] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (isFormOpen) setModalOpen(true);
  }, [isFormOpen]);

  function handleStart() {
    onStart();
    setModalOpen(true);
  }

  function handleClose() {
    if (isFormOpen) onFormClose();
    setModalOpen(false);
  }

  function handleCancel() {
    onCancel();
    setModalOpen(false);
    setNotes("");
  }

  function handleFormSubmit(dpt: number) {
    onSessionSubmit(dpt);
    setModalOpen(false);
    setNotes("");
  }

  const resources = (exercise.resources ?? []).map((r) => ({ name: r.name, url: r.url, type: r.type }));
  const lastSession = exercise.meta.sessions?.[0] ?? null;

  return (
    <div
      className={`item-card ${isChild ? "child-card" : ""} ${isCompletedToday ? "completed" : ""} ${isTimerActive ? "active" : ""}`}
    >
      <div className="item-card-row">
        <span className="item-status">
          {isCompletedToday ? <CheckIcon className="icon-sm" /> : "○"}
        </span>
        <div className="item-info">
          <span className="item-name">{exercise.name}</span>
          {tags.length > 0 && (
            <span className="item-tags">
              {tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
            </span>
          )}
        </div>
        <div className="item-actions">
          {inSession ? (
            <button
              className="item-elapsed"
              onClick={() => setModalOpen(true)}
              title="Open session"
            >
              {formatElapsed(timerElapsed)}
            </button>
          ) : (
            <>
              <button className="btn-timer" onClick={handleStart} title="Start timer">
                <PlayIcon className="icon" />
              </button>
              <button
                className="btn-timer"
                onClick={() => { onFormOpen(); setModalOpen(true); }}
                title="Log session"
              >
                <PlusIcon className="icon" />
              </button>
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <SessionModal
          title={exercise.name}
          resources={resources}
          onClose={handleClose}
          onOpenFile={onOpenFile}
        >
          {isFormOpen ? (
            <ExerciseSessionForm
              token={token}
              exerciseId={exercise.id}
              initialSeconds={timerElapsed}
              initialNotes={notes}
              lastSession={lastSession}
              onSubmit={handleFormSubmit}
              onCancel={handleClose}
            />
          ) : (
            <div className="modal-session-body">
              <div className="modal-elapsed-display">{formatElapsed(timerElapsed)}</div>
              {tags.length > 0 && (
                <div className="modal-meta">
                  {tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}
              {lastSession && (
                <LastSessionInfo session={lastSession} />
              )}
              <label className="form-full modal-notes-label">
                Notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Notes for this session…"
                />
              </label>
              <div className="modal-session-controls">
                {isTimerActive ? (
                  <button className="btn-secondary" onClick={onPause}>
                    <PauseIcon className="icon" /> Pause
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={onStart}>
                    <PlayIcon className="icon" /> Resume
                  </button>
                )}
                <button className="btn-primary" onClick={onStopAndSave}>
                  <StopIcon className="icon" /> Stop &amp; Save
                </button>
                <button className="btn-ghost" onClick={handleCancel}>
                  <NoSymbolIcon className="icon" /> Cancel
                </button>
              </div>
            </div>
          )}
        </SessionModal>
      )}
    </div>
  );
}

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
  onOpenFile?: (path: string, mediaType: "audio" | "video") => void;
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
  onOpenFile,
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
        onOpenFile={onOpenFile}
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
            onOpenFile={onOpenFile}
            isChild
          />
        );
      })}
    </div>
  );
}
