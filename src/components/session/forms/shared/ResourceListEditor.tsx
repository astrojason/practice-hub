import { FolderOpenIcon, PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";

export interface ResourceRow {
  id: string;
  name: string;
  url: string;
  type: string;
}

function resourceUrlPlaceholder(type: string): string {
  if (type === "local_file" || type === "guitar_pro") return "/path/to/file";
  if (type === "local_folder") return "/path/to/folder";
  return "https://...";
}

export function resourceUrlLabel(type: string): string {
  if (type === "local_file" || type === "guitar_pro") return "File path";
  if (type === "local_folder") return "Folder path";
  return "URL";
}

function isLocalResourceType(type: string): boolean {
  return type === "local_file" || type === "local_folder" || type === "guitar_pro";
}

async function browseForResourcePath(
  type: string,
  onPath: (path: string) => void,
  onError: (message: string) => void
) {
  try {
    const path = await openFilePicker({
      multiple: false,
      directory: type === "local_folder",
      filters: type === "guitar_pro"
        ? [{ name: "Guitar Pro", extensions: ["gp", "gp3", "gp4", "gp5", "gpx"] }]
        : undefined,
    });
    if (typeof path === "string") onPath(path);
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

// ─── Multi-resource list (Exercise, Song) ──────────────────────────────────────

interface ListProps {
  resources: ResourceRow[];
  onChange: (resources: ResourceRow[]) => void;
  onError: (message: string) => void;
}

export function ResourceListEditor({ resources, onChange, onError }: ListProps) {
  function addResource() {
    onChange([...resources, { id: Date.now().toString(), name: "", url: "", type: "url" }]);
  }

  function removeResource(id: string) {
    onChange(resources.filter((r) => r.id !== id));
  }

  function updateResource(id: string, field: keyof ResourceRow, value: string) {
    onChange(resources.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  return (
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
                placeholder={resourceUrlPlaceholder(r.type)}
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
              {isLocalResourceType(r.type) && (
                <button
                  type="button"
                  className="edit-resource-browse"
                  title={r.type === "local_folder" ? "Browse for folder" : "Browse for file"}
                  onClick={() => browseForResourcePath(r.type, (path) => updateResource(r.id, "url", path), onError)}
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
  );
}

// ─── Single resource field (Study Material) ────────────────────────────────────

interface SingleProps {
  id: string;
  url: string;
  type: string;
  onUrlChange: (url: string) => void;
  onError: (message: string) => void;
}

export function SingleResourceField({ id, url, type, onUrlChange, onError }: SingleProps) {
  return (
    <div className="edit-url-row">
      <input
        id={id}
        type="text"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder={resourceUrlPlaceholder(type)}
      />
      {isLocalResourceType(type) && (
        <button
          type="button"
          className="edit-resource-browse"
          title={type === "local_folder" ? "Browse for folder" : "Browse for file"}
          onClick={() => browseForResourcePath(type, onUrlChange, onError)}
        >
          <FolderOpenIcon />
        </button>
      )}
    </div>
  );
}
