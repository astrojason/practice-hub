import { useRef, useState } from "react";
import { makeItemKey } from "../lib/itemKey";
import { inferResourceType } from "../components/session/forms/shared/inferResourceType";
import type { DashboardData, DashboardExercise, DashboardStudyMaterial } from "../api/types";
import type { SequentialChild } from "../components/session/SequentialSessionModal";

export interface SequentialSessionState {
  type: "exercise" | "study_material";
  parentId: number;
  parentName: string;
  children: SequentialChild[];
  currentIndex: number;
}

interface Params {
  dashboard: DashboardData | null;
  additionalExercises: DashboardExercise[];
  additionalStudyMaterials: DashboardStudyMaterial[];
  completedIds: Set<string>;
  startTimer: (key: string) => void;
  clearTimer: (key: string) => void;
  cancelSession: (key: string) => void;
  handleSessionSubmit: (dailyPracticeTime: number, itemKey: string) => void;
  handleSkipItems: (keys: string[]) => void;
  markComplete: (key: string) => void;
  onError: (message: string) => void;
}

/** The "run every child of a parent exercise/study-material in order" flow. */
export function useSequentialSession({
  dashboard,
  additionalExercises,
  additionalStudyMaterials,
  completedIds,
  startTimer,
  clearTimer,
  cancelSession,
  handleSessionSubmit,
  handleSkipItems,
  markComplete,
  onError,
}: Params) {
  const [sequentialSession, setSequentialSession] = useState<SequentialSessionState | null>(null);
  // Temporarily hides the sequential modal while media (audio/video/GP) opened
  // from within it is playing, without cancelling the underlying session/timer.
  const [sequentialModalHidden, setSequentialModalHidden] = useState(false);
  const sequentialMediaWasOpenedRef = useRef(false);

  function childKeyFor(type: "exercise" | "study_material", id: number): string {
    return type === "exercise" ? makeItemKey("exercise", id) : makeItemKey("studymaterial", id);
  }

  function handleStartSequential(type: "exercise" | "study_material", parentId: number) {
    let parentName = "";
    let children: SequentialChild[] = [];

    if (type === "exercise") {
      const all = [...(dashboard?.exercises ?? []), ...additionalExercises];
      const ex = all.find((e) => e.id === parentId);
      if (!ex) {
        onError("Couldn't start that sequential session — the exercise group is no longer available. Try refreshing.");
        return;
      }
      if (ex.child_exercises.length === 0) {
        onError(`"${ex.name}" has no sub-exercises to run sequentially.`);
        return;
      }
      parentName = ex.name;
      const incompleteChildren = ex.child_exercises.filter((c) => !completedIds.has(makeItemKey("exercise", c.id)));
      if (incompleteChildren.length === 0) {
        onError(`All exercises in "${ex.name}" are already complete for today.`);
        return;
      }
      children = incompleteChildren.map((child) => ({
        id: child.id,
        name: child.name,
        resources: (child.resources ?? []).map((r) => ({ name: r.name, url: r.url, type: r.type })),
        lastSession: child.meta.sessions?.[0] ?? null,
        inUserExercise: child.meta.user_exercise !== null,
      }));
    } else {
      const all = [...(dashboard?.study_materials ?? []), ...additionalStudyMaterials];
      const sm = all.find((s) => s.id === parentId);
      if (!sm) {
        onError("Couldn't start that sequential session — the study material group is no longer available. Try refreshing.");
        return;
      }
      if ((sm.child_study_materials ?? []).length === 0) {
        onError(`"${sm.name}" has no child items to run sequentially.`);
        return;
      }
      parentName = sm.name;
      const incompleteChildren = (sm.child_study_materials ?? []).filter(
        (c) => !completedIds.has(makeItemKey("studymaterial", c.id))
      );
      if (incompleteChildren.length === 0) {
        onError(`All items in "${sm.name}" are already complete for today.`);
        return;
      }
      children = incompleteChildren.map((child) => ({
        id: child.id,
        name: child.name,
        resources: child.url
          ? [{ name: "Open material", url: child.url, type: inferResourceType(child.url, child.type) }]
          : [],
        lastSession: child.meta.sessions?.[0] ?? null,
      }));
    }

    setSequentialSession({ type, parentId, parentName, children, currentIndex: 0 });
    setSequentialModalHidden(false);
    sequentialMediaWasOpenedRef.current = false;
    startTimer(childKeyFor(type, children[0].id));
  }

  function handleSequentialChildSubmit(dailyPracticeTime: number) {
    if (!sequentialSession) return;
    const { type, parentId, children, currentIndex } = sequentialSession;
    const childKey = childKeyFor(type, children[currentIndex].id);

    handleSessionSubmit(dailyPracticeTime, childKey);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= children.length) {
      // All children complete — mark parent as complete
      markComplete(childKeyFor(type, parentId));
      setSequentialSession(null);
    } else {
      setSequentialSession((prev) => prev ? { ...prev, currentIndex: nextIndex } : null);
      startTimer(childKeyFor(type, children[nextIndex].id));
    }
  }

  function handleSequentialChildSkip() {
    if (!sequentialSession) return;
    const { type, children, currentIndex } = sequentialSession;
    const childKey = childKeyFor(type, children[currentIndex].id);

    clearTimer(childKey);
    handleSkipItems([childKey]);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= children.length) {
      setSequentialSession(null);
    } else {
      setSequentialSession((prev) => prev ? { ...prev, currentIndex: nextIndex } : null);
      startTimer(childKeyFor(type, children[nextIndex].id));
    }
  }

  function handleCancelSequential() {
    if (!sequentialSession) return;
    const { type, children, currentIndex } = sequentialSession;
    cancelSession(childKeyFor(type, children[currentIndex].id));
    setSequentialSession(null);
  }

  return {
    sequentialSession,
    sequentialModalHidden,
    setSequentialModalHidden,
    sequentialMediaWasOpenedRef,
    handleStartSequential,
    handleSequentialChildSubmit,
    handleSequentialChildSkip,
    handleCancelSequential,
  };
}
