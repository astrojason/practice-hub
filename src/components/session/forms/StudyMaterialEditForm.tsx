import { useState } from "react";
import { FolderOpenIcon } from "@heroicons/react/16/solid";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { updateStudyMaterial } from "../../../api/client";
import type { DashboardStudyMaterial, UpdateStudyMaterialPayload } from "../../../api/types";

function inferType(url: string | null): string {
  if (!url) return "url";
  if (url.startsWith("/") || /^[A-Za-z]:\\/.test(url)) return "local_file";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  return "url";
}

interface Props {
  token: string;
  material: DashboardStudyMaterial;
  onSuccess: (id: number, name: string, url: string | null) => void;
  onCancel: () => void;
}

export function StudyMaterialEditForm({ token, material, onSuccess, onCancel }: Props) {
  const [name, setName] = useState(material.name);
  const [url, setUrl] = useState(material.url ?? "");
  const [type, setType] = useState(inferType(material.url));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const payload: UpdateStudyMaterialPayload = {
      name: name.trim(),
      url: url || "",
      type,
      parent_study_material_id: material.parent_study_material_id,
    };
    try {
      await updateStudyMaterial(token, material.id, payload);
      onSuccess(material.id, payload.name, url || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="edit-form" onSubmit={handleSubmit}>
      <div className="edit-form-row">
        <label htmlFor="sm-ef-name">Name</label>
        <input
          id="sm-ef-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="edit-form-row">
        <label htmlFor="sm-ef-type">Type</label>
        <select
          id="sm-ef-type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="url">URL</option>
          <option value="youtube">YouTube</option>
          <option value="local_file">File</option>
        </select>
      </div>
      <div className="edit-form-row">
        <label htmlFor="sm-ef-url">
          {type === "local_file" ? "File path" : "URL"}
        </label>
        <div className="edit-url-row">
          <input
            id="sm-ef-url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={type === "local_file" ? "/path/to/file" : "https://..."}
          />
          {type === "local_file" && (
            <button
              type="button"
              className="edit-resource-browse"
              title="Browse for file"
              onClick={async () => {
                const path = await openFilePicker({ multiple: false, directory: false });
                if (typeof path === "string") setUrl(path);
              }}
            >
              <FolderOpenIcon />
            </button>
          )}
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
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
