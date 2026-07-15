import { useState } from "react";
import { FolderOpenIcon, PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { createExercise } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import type { CreateExercisePayload, DashboardExercise } from "../../../api/types";

interface ResourceRow {
  id: string;
  name: string;
  url: string;
  type: string;
}

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

  function findResourceNameError(): string | null {
    const named = resources.filter((r) => r.url).map((r) => r.name.trim());
    if (named.some((n) => !n)) return "Every resource needs a name.";
    const seen = new Set<string>();
    for (const n of named) {
      if (seen.has(n.toLowerCase())) return `Resource name "${n}" is used more than once.`;
      seen.add(n.toLowerCase());
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const resourceNameError = findResourceNameError();
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
                  placeholder={r.type === "local_file" || r.type === "guitar_pro" ? "/path/to/file" : r.type === "local_folder" ? "/path/to/folder" : "https://..."}
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
                  <option value="guitar_pro">Guitar Pro</option>
                </select>
                {(r.type === "local_file" || r.type === "local_folder" || r.type === "guitar_pro") && (
                  <button
                    type="button"
                    className="edit-resource-browse"
                    title={r.type === "local_folder" ? "Browse for folder" : "Browse for file"}
                    onClick={async () => {
                      try {
                        const path = await openFilePicker({
                          multiple: false,
                          directory: r.type === "local_folder",
                          filters: r.type === "guitar_pro"
                            ? [{ name: "Guitar Pro", extensions: ["gp", "gp3", "gp4", "gp5", "gpx"] }]
                            : undefined,
                        });
                        if (typeof path === "string") updateResource(r.id, "url", path);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
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
          {saving ? "Adding…" : "Add"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
