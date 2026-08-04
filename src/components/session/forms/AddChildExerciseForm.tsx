import { useState } from "react";
import { createExercise } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import type { CreateExercisePayload, DashboardExercise } from "../../../api/types";
import { ResourceListEditor, type ResourceRow } from "./shared/ResourceListEditor";
import { findResourceNameError } from "./shared/findResourceNameError";

interface Props {
  token: string;
  parentExerciseId: number;
  onSuccess: (child: DashboardExercise) => void;
  onCancel: () => void;
}

export function AddChildExerciseForm({ token, parentExerciseId, onSuccess, onCancel }: Props) {
  const [name, setName] = useState("");
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const resourceNameError = findResourceNameError(resources);
    if (resourceNameError) {
      setError(resourceNameError);
      return;
    }
    setSaving(true);
    setError(null);
    const payload: CreateExercisePayload = {
      name: name.trim(),
      parent_exercise_id: parentExerciseId,
      resources: resources
        .filter((r) => r.url)
        .map((r) => ({ name: r.name.trim(), url: r.url, type: r.type })),
    };
    try {
      const created = await createExercise(token, payload);
      onSuccess({ ...created, child_exercises: created.child_exercises ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="edit-form add-child-form add-child-exercise-form" onSubmit={handleSubmit}>
      <div className="edit-form-row">
        <label htmlFor="ace-name">Name</label>
        <input
          id="ace-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </div>
      <ResourceListEditor resources={resources} onChange={setResources} onError={setError} />
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
      <div className="edit-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Adding…" : "Add"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
