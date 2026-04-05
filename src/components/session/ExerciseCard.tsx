import { useEffect, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
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
import { RatingTrendChart } from "../reports/RatingTrendChart";
import type { DashboardExercise, ExerciseSession } from "../../api/types";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Returns true if the last 3+ sessions are all Awful or Bad */
function isStruggling(sessions: ExerciseSession[]): boolean {
  const rated = sessions.filter((s) => s.rating != null);
  if (rated.length < 3) return false;
  return rated.slice(0, 3).every((s) => s.rating === "Awful" || s.rating === "Bad");
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
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string) => void;
  isChild?: boolean;
  /** When set, play button starts a sequential child session instead of this item's own timer */
  onStartSequential?: () => void;
  onOpenChat?: () => void;
  isMediaActive?: boolean;
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
  onStartSequential,
  onOpenChat,
  isMediaActive,
}: CardProps) {
  const ue = exercise.meta.user_exercise;
  const tags: string[] = [];
  if (ue?.randomize_sub_exercises) tags.push("randomize");
  if (ue?.use_keys) tags.push("keys");
  if (ue?.use_scales) tags.push("scales");

  const inSession = isTimerActive || isTimerPaused;
  const [modalOpen, setModalOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const mediaWasOpenedRef = useRef(false);

  useEffect(() => {
    if (isFormOpen) setModalOpen(true);
  }, [isFormOpen]);

  useEffect(() => {
    if (!(isMediaActive ?? false) && mediaWasOpenedRef.current) {
      setModalOpen(true);
      mediaWasOpenedRef.current = false;
    }
  }, [isMediaActive]);

  function handleOpenFile(path: string, mediaType: "audio" | "video", itemKey?: string) {
    mediaWasOpenedRef.current = true;
    onOpenFile!(path, mediaType, itemKey);
  }

  function handleStart() {
    if (onStartSequential) {
      onStartSequential();
    } else {
      onStart();
      setModalOpen(true);
    }
  }

  function handleClose() {
    if (isFormOpen) onFormClose();
    setModalOpen(false);
    setShowHistory(false);
  }

  function handleCancel() {
    onCancel();
    setModalOpen(false);
    setNotes("");
    setShowHistory(false);
  }

  function handleFormSubmit(dpt: number) {
    onSessionSubmit(dpt);
    setModalOpen(false);
    setNotes("");
    setShowHistory(false);
  }

  const resources = (exercise.resources ?? []).map((r) => ({ name: r.name, url: r.url, type: r.type }));
  const sessions = (exercise.meta.sessions ?? []) as ExerciseSession[];
  const lastSession = sessions[0] ?? null;
  const struggling = isStruggling(sessions);

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
          {(tags.length > 0 || (onStartSequential && !isChild)) && (
            <span className="item-tags">
              {tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
              {onStartSequential && !isChild && (
                <span className="tag">{exercise.child_exercises.length} items</span>
              )}
            </span>
          )}
        </div>
        <div className="item-actions">
          <button
            className={`btn-ghost btn-chat ${struggling ? "btn-chat--struggling" : ""}`}
            onClick={onOpenChat}
            title="AI chat"
          >
            <ChatBubbleLeftRightIcon className="icon" />
          </button>
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
              <button className="btn-timer" onClick={handleStart} title={onStartSequential ? "Start sequential session" : "Start timer"}>
                <PlayIcon className="icon" />
              </button>
              {!onStartSequential && (
                <button
                  className="btn-timer"
                  onClick={() => { onFormOpen(); setModalOpen(true); }}
                  title="Log session"
                >
                  <PlusIcon className="icon" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <SessionModal
          title={exercise.name}
          resources={resources}
          onClose={handleClose}
          onOpenFile={onOpenFile ? handleOpenFile : undefined}
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
              {sessions.length > 0 && (
                <div className="modal-history">
                  <button
                    className="btn-ghost modal-history-toggle"
                    onClick={() => setShowHistory((v) => !v)}
                  >
                    {showHistory ? "Hide history" : `Rating history (${sessions.length})`}
                  </button>
                  {showHistory && (
                    <RatingTrendChart
                      token={token}
                      entityType="exercise"
                      entityId={exercise.id}
                      sessions={sessions}
                    />
                  )}
                </div>
              )}
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
  onStartSequential?: (parentId: number) => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string) => void;
  onOpenChat?: (id: number) => void;
  isMediaActive?: boolean;
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
  onStartSequential,
  onOpenFile,
  onOpenChat,
  isMediaActive,
}: ExerciseCardProps) {
  const hasChildren = exercise.child_exercises.length > 0;
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
        onStartSequential={hasChildren && onStartSequential ? () => onStartSequential(exercise.id) : undefined}
        onOpenFile={onOpenFile}
        onOpenChat={onOpenChat ? () => onOpenChat(exercise.id) : undefined}
        isMediaActive={isMediaActive}
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
            onOpenFile={onOpenFile ? (path, mt) => onOpenFile(path, mt, `exercise-${child.id}`) : undefined}
            onOpenChat={onOpenChat ? () => onOpenChat(child.id) : undefined}
            isMediaActive={isMediaActive}
            isChild
          />
        );
      })}
    </div>
  );
}
