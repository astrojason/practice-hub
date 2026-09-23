import { useState } from "react";
import { makeItemKey } from "../../lib/itemKey";
import { mergeSessionsById } from "../../lib/itemUsage";
import { ItemSessionCard } from "./ItemSessionCard";
import { ExerciseSessionForm } from "./forms/ExerciseSessionForm";
import { ExerciseEditForm } from "./forms/ExerciseEditForm";
import { AddChildExerciseForm } from "./forms/AddChildExerciseForm";
import { ErrorModal } from "../ErrorModal";
import { toggleUserExercise } from "../../api/client";
import type { DashboardExercise, ExerciseSession, Resource, StudyMaterialSession, UserExerciseMeta } from "../../api/types";

/** The toggle response is always the full group (parent + children) — find this
 * item's own updated membership whether it's the top-level exercise or a child. */
function findUserExerciseMeta(response: DashboardExercise, targetId: number): UserExerciseMeta | null {
  if (response.id === targetId) return response.meta.user_exercise;
  const child = response.child_exercises.find((c) => c.id === targetId);
  return child ? child.meta.user_exercise : null;
}

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
  onSessionSubmit: (dailyPracticeTime: number, newSession?: ExerciseSession | StudyMaterialSession) => void;
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
  /** Called after a successful add/remove-from-my-exercises toggle, with this item's new membership. */
  onToggled?: (id: number, userExercise: UserExerciseMeta | null) => void;
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
  onToggled,
}: CardProps) {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function handleToggleUserList() {
    if (toggling) return;
    setToggling(true);
    setToggleError(null);
    try {
      const response = await toggleUserExercise(token, exercise.id);
      onToggled?.(exercise.id, findUserExerciseMeta(response, exercise.id));
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  }

  const ue = exercise.meta.user_exercise;
  const tags: string[] = [];
  if (ue?.randomize_sub_exercises) tags.push("randomize");
  if (ue?.use_keys) tags.push("keys");
  if (ue?.use_scales) tags.push("scales");

  const resources = (exercise.resources ?? []).map((r) => ({ name: r.name, url: r.url, type: r.type, bpm: r.bpm }));
  const sessions = (exercise.meta.sessions ?? []) as ExerciseSession[];
  // Practicing a sub-exercise counts as practicing the group — a parent
  // with no sessions of its own shouldn't show stale just because the user
  // always practices it via a child. All child items count, whether or not
  // the user has added them to their own exercise list — including a child
  // that's since been swapped out of the active list, via
  // catalogChildSessions (the full catalog course's history, distinct from
  // child_exercises which stays limited to the currently-active children
  // actually rendered below). Falls back to today's active children only
  // until that full-history fetch resolves. Children keep their own
  // sessions only.
  const usageSessions = isChild
    ? sessions
    : mergeSessionsById(
        sessions,
        exercise.catalogChildSessions ?? exercise.child_exercises.flatMap((c) => c.meta.sessions ?? []),
        exercise.child_exercises.flatMap((c) => c.meta.sessions ?? [])
      );

  return (
    <>
      {toggleError && <ErrorModal error={toggleError} onDismiss={() => setToggleError(null)} />}
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
        isInUserList={exercise.meta.user_exercise != null}
        onToggleUserList={onToggled ? handleToggleUserList : undefined}
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
    </>
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
  onSessionSubmit: (id: number, dailyPracticeTime: number, newSession?: ExerciseSession | StudyMaterialSession) => void;
  onSkip: (id: number) => void;
  onStartSequential?: (parentId: number) => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string, resources?: Resource[]) => void;
  onGpView?: (path: string) => void;
  onOpenChat?: (id: number) => void;
  isMediaActive?: boolean;
  onEntityEdited?: (id: number, name: string, resources: Resource[] | null) => void;
  onChildAdded?: (parentId: number, child: DashboardExercise) => void;
  onToggled?: (id: number, userExercise: UserExerciseMeta | null) => void;
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
  onToggled,
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
        onSessionSubmit={(dpt, newSession) => onSessionSubmit(exercise.id, dpt, newSession)}
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
        onToggled={onToggled}
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
            onSessionSubmit={(dpt, newSession) => onSessionSubmit(child.id, dpt, newSession)}
            onSkip={() => onSkip(child.id)}
            onOpenFile={onOpenFile ? (path, mt, _itemKey, resources) => onOpenFile(path, mt, makeItemKey("exercise", child.id), resources) : undefined}
            onGpView={onGpView}
            onOpenChat={onOpenChat ? () => onOpenChat(child.id) : undefined}
            isMediaActive={isMediaActive}
            isChild
            onEntityEdited={onEntityEdited}
            onToggled={onToggled}
          />
        );
      })}
    </div>
  );
}
