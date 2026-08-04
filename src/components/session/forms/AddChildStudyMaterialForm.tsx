import { useState } from "react";
import { createStudyMaterial } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import type { CreateStudyMaterialPayload, DashboardStudyMaterial } from "../../../api/types";
import { SingleResourceField, resourceUrlLabel } from "./shared/ResourceListEditor";

interface Props {
  token: string;
  parentStudyMaterialId: number;
  onSuccess: (child: DashboardStudyMaterial) => void;
  onCancel: () => void;
}

export function AddChildStudyMaterialForm({ token, parentStudyMaterialId, onSuccess, onCancel }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("url");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const payload: CreateStudyMaterialPayload = {
      name: name.trim(),
      url: url || "",
      type,
      parent_study_material_id: parentStudyMaterialId,
    };
    try {
      const created = await createStudyMaterial(token, payload);
      onSuccess({ ...created, child_study_materials: created.child_study_materials ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="edit-form add-child-form add-child-study-material-form" onSubmit={handleSubmit}>
      <div className="edit-form-row">
        <label htmlFor="acsm-name">Name</label>
        <input
          id="acsm-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </div>
      <div className="edit-form-row">
        <label htmlFor="acsm-type">Type</label>
        <select
          id="acsm-type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="url">URL</option>
          <option value="youtube">YouTube</option>
          <option value="local_file">File</option>
          <option value="local_folder">Folder</option>
          <option value="guitar_pro">Guitar Pro</option>
        </select>
      </div>
      <div className="edit-form-row">
        <label htmlFor="acsm-url">{resourceUrlLabel(type)}</label>
        <SingleResourceField id="acsm-url" url={url} type={type} onUrlChange={setUrl} onError={setError} />
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
