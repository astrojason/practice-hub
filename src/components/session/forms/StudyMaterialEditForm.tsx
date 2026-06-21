import { useState } from "react";
import { FolderOpenIcon } from "@heroicons/react/16/solid";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { updateStudyMaterial } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import type { DashboardStudyMaterial, UpdateStudyMaterialPayload } from "../../../api/types";

function inferType(url: string | null, storedType?: string): string {
  if (storedType) return storedType;
  if (!url) return "url";
  if (url.startsWith("/") || /^[A-Za-z]:\\/.test(url)) return "local_file";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  return "url";
}

interface Props {
  token: string;
  material: DashboardStudyMaterial;
  onSuccess: (id: number, name: string, url: string | null, type: string) => void;
  onCancel: () => void;
}

export function StudyMaterialEditForm({ token, material, onSuccess, onCancel }: Props) {
  const [name, setName] = useState(material.name);
  const [url, setUrl] = useState(material.url ?? "");
  const [type, setType] = useState(inferType(material.url ?? "", material.type));
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
      onSuccess(material.id, payload.name, url || null, type);
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
          <option value="local_folder">Folder</option>
        </select>
      </div>
      <div className="edit-form-row">
        <label htmlFor="sm-ef-url">
          {type === "local_file" ? "File path" : type === "local_folder" ? "Folder path" : "URL"}
        </label>
        <div className="edit-url-row">
          <input
            id="sm-ef-url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={type === "local_file" ? "/path/to/file" : type === "local_folder" ? "/path/to/folder" : "https://..."}
          />
          {(type === "local_file" || type === "local_folder") && (
            <button
              type="button"
              className="edit-resource-browse"
              title={type === "local_folder" ? "Browse for folder" : "Browse for file"}
              onClick={async () => {
                const path = await openFilePicker({ multiple: false, directory: type === "local_folder" });
                if (typeof path === "string") setUrl(path);
              }}
            >
              <FolderOpenIcon />
            </button>
          )}
        </div>
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
