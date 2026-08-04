import { useState } from "react";
import { updateExercise } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import type { DashboardExercise, Resource, UpdateExercisePayload } from "../../../api/types";
import { ResourceListEditor, type ResourceRow } from "./shared/ResourceListEditor";
import { findResourceNameError } from "./shared/findResourceNameError";

interface Props {
  token: string;
  exercise: DashboardExercise;
  onSuccess: (id: number, name: string, resources: Resource[] | null) => void;
  onCancel: () => void;
}

export function ExerciseEditForm({ token, exercise, onSuccess, onCancel }: Props) {
  const [name, setName] = useState(exercise.name);
  const [resources, setResources] = useState<ResourceRow[]>(
    (exercise.resources ?? []).map((r: Resource, i: number) => ({
      id: String(i),
      name: r.name,
      url: r.url,
      type: r.type ?? "url",
    }))
  );
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
    const payload: UpdateExercisePayload = {
      name: name.trim(),
      resources: resources
        .filter((r) => r.url)
        .map((r) => ({ name: r.name, url: r.url, type: r.type })),
    };
    try {
      await updateExercise(token, exercise.id, payload);
      onSuccess(exercise.id, payload.name, payload.resources as Resource[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="edit-form" onSubmit={handleSubmit}>
      <div className="edit-form-row">
        <label htmlFor="ee-name">Name</label>
        <input
          id="ee-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <ResourceListEditor resources={resources} onChange={setResources} onError={setError} />
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
      <div className="edit-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
