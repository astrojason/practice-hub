import { useState } from "react";
import { makeItemKey } from "../../lib/itemKey";
import { ItemSessionCard } from "./ItemSessionCard";
import { ExerciseSessionForm } from "./forms/ExerciseSessionForm";
import { ExerciseEditForm } from "./forms/ExerciseEditForm";
import { AddChildExerciseForm } from "./forms/AddChildExerciseForm";
import type { DashboardExercise, ExerciseSession, Resource } from "../../api/types";

interface CardProps {
  token: string;
  exercise: DashboardExercise;
  isCompletedToday: boolean;
  isSkippedToday: boolean;
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
  onSkip: () => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string, resources?: Resource[]) => void;
  onGpView?: (path: string) => void;
  isChild?: boolean;
  /** When set, play button starts a sequential child session instead of this item's own timer */
  onStartSequential?: () => void;
  onOpenChat?: () => void;
  isMediaActive?: boolean;
  /** Collapse toggle for parent cards with children */
  childrenCollapsed?: boolean;
  onToggleChildren?: () => void;
  onEntityEdited?: (id: number, name: string, resources: Resource[] | null) => void;
  /** Only set for the top-level (non-child) card — enables the "Add child" button. */
  onAddChild?: (child: DashboardExercise) => void;
}

function ExerciseSingleCard({
  token,
  exercise,
  isCompletedToday,
  isSkippedToday,
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
  onSkip,
  onOpenFile,
  onGpView,
  isChild,
  onStartSequential,
  onOpenChat,
  isMediaActive,
  childrenCollapsed,
  onToggleChildren,
  onEntityEdited,
  onAddChild,
}: CardProps) {
  const ue = exercise.meta.user_exercise;
  const tags: string[] = [];
  if (ue?.randomize_sub_exercises) tags.push("randomize");
  if (ue?.use_keys) tags.push("keys");
  if (ue?.use_scales) tags.push("scales");

  const resources = (exercise.resources ?? []).map((r) => ({ name: r.name, url: r.url, type: r.type }));
  const sessions = (exercise.meta.sessions ?? []) as ExerciseSession[];
  // Practicing a sub-exercise counts as practicing the group — a parent
  // with no sessions of its own shouldn't show stale just because the user
  // always practices it via a child. Only children the user has actually
  // added (meta.user_exercise set) count — a session logged against a child
  // that isn't part of the user's active list shouldn't rescue the group.
  // Children keep their own sessions only.
  const usageSessions = isChild
    ? sessions
    : [
        ...sessions,
        ...exercise.child_exercises
          .filter((c) => c.meta.user_exercise != null)
          .flatMap((c) => c.meta.sessions ?? []),
      ].sort((a, b) => b.created_timestamp - a.created_timestamp);

  return (
    <ItemSessionCard
      token={token}
      name={exercise.name}
      extraTags={tags}
      sequentialItemCount={onStartSequential ? exercise.child_exercises.length : undefined}
      modalMeta={tags.length > 0 ? (
        <div className="modal-meta">
          {tags.map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </div>
      ) : undefined}
      resources={resources}
      sessions={sessions}
      usageSessions={usageSessions}
      entityType="exercise"
      entityId={exercise.id}
      itemCreatedTimestamp={exercise.created_timestamp}
      isChild={isChild}
      isCompletedToday={isCompletedToday}
      isSkippedToday={isSkippedToday}
      isTimerActive={isTimerActive}
      isTimerPaused={isTimerPaused}
      timerElapsed={timerElapsed}
      isFormOpen={isFormOpen}
      onStart={onStart}
      onPause={onPause}
      onStopAndSave={onStopAndSave}
      onCancel={onCancel}
      onFormOpen={onFormOpen}
      onFormClose={onFormClose}
      onSessionSubmit={onSessionSubmit}
      onSkip={onSkip}
      onOpenFile={onOpenFile}
      onGpView={onGpView}
      onStartSequential={onStartSequential}
      onOpenChat={onOpenChat}
      isMediaActive={isMediaActive}
      childrenCollapsed={childrenCollapsed}
      onToggleChildren={onToggleChildren}
      editTitle={`Edit: ${exercise.name}`}
      renderSessionForm={({ initialNotes, timerElapsed, lastSession, onSubmit, onCancel }) => (
        <ExerciseSessionForm
          token={token}
          exerciseId={exercise.id}
          inUserExercise={exercise.meta.user_exercise !== null}
          initialSeconds={timerElapsed}
          initialNotes={initialNotes}
          lastSession={lastSession}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
      renderEditForm={({ onSuccess, onCancel }) => (
        <ExerciseEditForm
          token={token}
          exercise={exercise}
          onSuccess={(id, name, resources) => {
            onSuccess();
            onEntityEdited?.(id, name, resources);
          }}
          onCancel={onCancel}
        />
      )}
      renderAddChildForm={onAddChild ? ({ onSuccess, onCancel }) => (
        <AddChildExerciseForm
          token={token}
          parentExerciseId={exercise.id}
          onSuccess={(child) => {
            onSuccess();
            onAddChild(child);
          }}
          onCancel={onCancel}
        />
      ) : undefined}
    />
  );
}

interface ExerciseCardProps {
  token: string;
  exercise: DashboardExercise;
  getState: (id: number) => {
    isCompletedToday: boolean;
    isSkippedToday: boolean;
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
  onSkip: (id: number) => void;
  onStartSequential?: (parentId: number) => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string, resources?: Resource[]) => void;
  onGpView?: (path: string) => void;
  onOpenChat?: (id: number) => void;
  isMediaActive?: boolean;
  onEntityEdited?: (id: number, name: string, resources: Resource[] | null) => void;
  onChildAdded?: (parentId: number, child: DashboardExercise) => void;
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
  onSkip,
  onStartSequential,
  onOpenFile,
  onGpView,
  onOpenChat,
  isMediaActive,
  onEntityEdited,
  onChildAdded,
}: ExerciseCardProps) {
  const hasChildren = exercise.child_exercises.length > 0;
  const [childrenCollapsed, setChildrenCollapsed] = useState(true);
  const state = getState(exercise.id);
  return (
    <div className="exercise-group">
      <ExerciseSingleCard
        token={token}
        exercise={exercise}
        isCompletedToday={state.isCompletedToday}
        isSkippedToday={state.isSkippedToday}
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
        onSkip={() => onSkip(exercise.id)}
        onStartSequential={hasChildren && onStartSequential ? () => onStartSequential(exercise.id) : undefined}
        onOpenFile={onOpenFile}
        onGpView={onGpView}
        onOpenChat={onOpenChat ? () => onOpenChat(exercise.id) : undefined}
        isMediaActive={isMediaActive}
        childrenCollapsed={hasChildren ? childrenCollapsed : undefined}
        onToggleChildren={hasChildren ? () => setChildrenCollapsed((v) => !v) : undefined}
        onEntityEdited={onEntityEdited}
        onAddChild={onChildAdded ? (child) => {
          onChildAdded(exercise.id, child);
          setChildrenCollapsed(false);
        } : undefined}
      />
      {!childrenCollapsed && exercise.child_exercises.map((child) => {
        const childState = getState(child.id);
        return (
          <ExerciseSingleCard
            key={child.id}
            token={token}
            exercise={child}
            isCompletedToday={childState.isCompletedToday}
            isSkippedToday={childState.isSkippedToday}
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
            onSkip={() => onSkip(child.id)}
            onOpenFile={onOpenFile ? (path, mt, _itemKey, resources) => onOpenFile(path, mt, makeItemKey("exercise", child.id), resources) : undefined}
            onGpView={onGpView}
            onOpenChat={onOpenChat ? () => onOpenChat(child.id) : undefined}
            isMediaActive={isMediaActive}
            isChild
            onEntityEdited={onEntityEdited}
          />
        );
      })}
    </div>
  );
}
