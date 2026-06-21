import { useState } from "react";
import { FolderOpenIcon, PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { updateExercise } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import type { DashboardExercise, Resource, UpdateExercisePayload } from "../../../api/types";

interface ResourceRow {
  id: string;
  name: string;
  url: string;
  type: string;
}

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

  function addResource() {
    setResources((prev) => [...prev, { id: Date.now().toString(), name: "", url: "", type: "url" }]);
  }

  function removeResource(id: string) {
    setResources((prev) => prev.filter((r) => r.id !== id));
  }

  function updateResource(id: string, field: keyof ResourceRow, value: string) {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
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
      <div className="edit-form-row">
        <div className="edit-resource-header">
          <span className="edit-label-text">Resources</span>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: "2px 7px", fontSize: 12, height: 24 }}
            onClick={addResource}
          >
            <PlusIcon className="icon-sm" /> Add
          </button>
        </div>
        {resources.length > 0 && (
          <div className="edit-resource-list">
            {resources.map((r) => (
              <div key={r.id} className="edit-resource-row">
                <input
                  type="text"
                  placeholder="Name"
                  value={r.name}
                  onChange={(e) => updateResource(r.id, "name", e.target.value)}
                />
                <input
                  type="text"
                  placeholder={r.type === "local_file" ? "/path/to/file" : r.type === "local_folder" ? "/path/to/folder" : "https://..."}
                  value={r.url}
                  onChange={(e) => updateResource(r.id, "url", e.target.value)}
                />
                <select
                  value={r.type}
                  onChange={(e) => updateResource(r.id, "type", e.target.value)}
                >
                  <option value="url">URL</option>
                  <option value="youtube">YouTube</option>
                  <option value="local_file">File</option>
                  <option value="local_folder">Folder</option>
                </select>
                {(r.type === "local_file" || r.type === "local_folder") && (
                  <button
                    type="button"
                    className="edit-resource-browse"
                    title={r.type === "local_folder" ? "Browse for folder" : "Browse for file"}
                    onClick={async () => {
                      const path = await openFilePicker({ multiple: false, directory: r.type === "local_folder" });
                      if (typeof path === "string") updateResource(r.id, "url", path);
                    }}
                  >
                    <FolderOpenIcon />
                  </button>
                )}
                <button
                  type="button"
                  className="edit-resource-remove"
                  onClick={() => removeResource(r.id)}
                  title="Remove"
                >
                  <XMarkIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
