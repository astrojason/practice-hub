import { useState } from "react";
import { BookmarkIcon, BookmarkSlashIcon, ChevronDownIcon, ChevronRightIcon, PencilSquareIcon, PlusIcon } from "@heroicons/react/16/solid";
import { SessionModal } from "../session/SessionModal";
import { ExerciseEditForm } from "../session/forms/ExerciseEditForm";
import { AddChildExerciseForm } from "../session/forms/AddChildExerciseForm";
import { ErrorModal } from "../ErrorModal";
import { toggleUserExercise } from "../../api/client";
import type { DashboardExercise } from "../../api/types";

interface Props {
  token: string;
  exercise: DashboardExercise;
  isChild?: boolean;
}

export function BrowseExerciseRow({ token, exercise, isChild }: Props) {
  const [current, setCurrent] = useState(exercise);
  const [children, setChildren] = useState<DashboardExercise[]>(exercise.child_exercises);
  const [collapsed, setCollapsed] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const hasChildren = children.length > 0;
  const inList = current.meta.user_exercise != null;

  async function handleToggle() {
    if (toggling) return;
    setToggling(true);
    setToggleError(null);
    try {
      const response = await toggleUserExercise(token, current.id);
      const updatedMeta =
        response.id === current.id
          ? response.meta
          : response.child_exercises.find((c) => c.id === current.id)?.meta ?? { user_exercise: null, sessions: [] };
      setCurrent((prev) => ({ ...prev, meta: updatedMeta }));
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="browse-group">
      <div className={`browse-row ${isChild ? "browse-row--child" : ""}`}>
        <div className="browse-row-info">
          <span className="browse-row-name">{current.name}</span>
        </div>
        <div className="browse-row-actions">
          {hasChildren && (
            <button
              className="btn-ghost"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronRightIcon className="icon-sm" /> : <ChevronDownIcon className="icon-sm" />}
            </button>
          )}
          <button
            className="btn-ghost"
            onClick={handleToggle}
            title={inList ? "Remove from my exercises" : "Add to my exercises"}
          >
            {inList ? <BookmarkIcon className="icon" /> : <BookmarkSlashIcon className="icon" />}
          </button>
          <button className="btn-ghost" onClick={() => setAddChildOpen((v) => !v)} title="Add child">
            <PlusIcon className="icon" />
          </button>
          <button className="btn-ghost" onClick={() => setEditOpen(true)} title="Edit">
            <PencilSquareIcon className="icon" />
          </button>
        </div>
      </div>

      {addChildOpen && (
        <div className="add-child-form-wrap">
          <AddChildExerciseForm
            token={token}
            parentExerciseId={current.id}
            onSuccess={(child) => {
              setChildren((prev) => [...prev, child]);
              setCollapsed(false);
              setAddChildOpen(false);
            }}
            onCancel={() => setAddChildOpen(false)}
          />
        </div>
      )}

      {editOpen && (
        <SessionModal title={`Edit: ${current.name}`} onClose={() => setEditOpen(false)}>
          <ExerciseEditForm
            token={token}
            exercise={current}
            onSuccess={(_id, name, resources) => {
              setCurrent((prev) => ({ ...prev, name, resources }));
              setEditOpen(false);
            }}
            onCancel={() => setEditOpen(false)}
          />
        </SessionModal>
      )}

      {!collapsed &&
        children.map((child) => (
          <BrowseExerciseRow key={child.id} token={token} exercise={child} isChild />
        ))}

      {toggleError && <ErrorModal error={toggleError} onDismiss={() => setToggleError(null)} />}
    </div>
  );
}
