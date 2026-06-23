import { useEffect, useState } from "react";
import { ArrowTopRightOnSquareIcon, FolderOpenIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Resource } from "../../api/types";

// Infer file type from extension — GP files open in the GP viewer, others in the media player.
function fileTypeFromPath(path: string): "audio" | "video" | "guitar_pro" {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["gp", "gp3", "gp4", "gp5", "gpx"].includes(ext)) return "guitar_pro";
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
  return "audio";
}

interface FolderEntry {
  path: string;
  filename: string;
}

interface LocalFolderResourceProps {
  name: string;
  folderPath: string;
  onOpenFile?: (path: string, mediaType: "audio" | "video") => void;
  onGpView?: (path: string) => void;
}

function LocalFolderResource({ name, folderPath, onOpenFile, onGpView }: LocalFolderResourceProps) {
  const [files, setFiles] = useState<FolderEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || files !== null) return;
    invoke<string>("list_local_folder", { path: folderPath })
      .then((json) => setFiles(JSON.parse(json) as FolderEntry[]))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [expanded, files, folderPath]);

  return (
    <div className="modal-resource-folder">
      <button
        className="modal-resource-link modal-resource-link--folder-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        <FolderOpenIcon style={{ width: 11, height: 11 }} />
        {name}
        <span className="modal-resource-folder-arrow">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="modal-resource-folder-files">
          {error && <span className="modal-resource-folder-error">{error}</span>}
          {!error && files === null && <span className="modal-resource-folder-loading">Loading…</span>}
          {!error && files !== null && files.length === 0 && (
            <span className="modal-resource-folder-empty">No media files found</span>
          )}
          {!error && files !== null && files.map((f) => {
            const ft = fileTypeFromPath(f.path);
            return (
              <button
                key={f.path}
                className="modal-resource-link modal-resource-link--local modal-resource-folder-file"
                onClick={() => ft === "guitar_pro" ? onGpView?.(f.path) : onOpenFile?.(f.path, ft)}
              >
                {f.filename}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function findAudioPath(resources: Resource[] | undefined): string | undefined {
  return resources?.find((r) =>
    (r.type === "local_file" || !r.type) && fileTypeFromPath(r.url) === "audio"
  )?.url;
}

interface Props {
  title: string;
  subtitle?: string;
  resources?: Resource[];
  onClose: () => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string) => void;
  onGpView?: (path: string, audioPath?: string) => void;
  children: React.ReactNode;
}

export function SessionModal({ title, subtitle, resources, onClose, onOpenFile, onGpView, children }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 className="modal-title">{title}</h2>
            {subtitle && <span className="modal-subtitle">{subtitle}</span>}
          </div>
          <button className="btn-ghost modal-close" onClick={onClose} title="Close">
            <XMarkIcon />
          </button>
        </div>

        {resources && resources.length > 0 && (
          <div className="modal-resources">
            <span className="modal-section-label">Resources</span>
            <div className="modal-resource-links">
              {resources.map((r) => {
                if (r.type === "local_folder") {
                  return (
                    <LocalFolderResource
                      key={r.url}
                      name={r.name}
                      folderPath={r.url}
                      onOpenFile={onOpenFile ? (path, mt) => { onOpenFile(path, mt); onClose(); } : undefined}
                      onGpView={onGpView ? (path) => { onGpView(path); onClose(); } : undefined}
                    />
                  );
                }
                if (r.type === "local_file") {
                  const ft = fileTypeFromPath(r.url);
                  return (
                    <button
                      key={r.url}
                      className="modal-resource-link modal-resource-link--local"
                      onClick={() => {
                        if (ft === "guitar_pro") {
                          onGpView?.(r.url, findAudioPath(resources));
                        } else {
                          onOpenFile?.(r.url, ft);
                        }
                        onClose();
                      }}
                    >
                      <FolderOpenIcon style={{ width: 11, height: 11 }} />
                      {r.name}
                    </button>
                  );
                }
                if (r.type === "guitar_pro") {
                  return (
                    <button
                      key={r.url}
                      className="modal-resource-link modal-resource-link--local"
                      onClick={() => { onGpView?.(r.url, findAudioPath(resources)); onClose(); }}
                    >
                      <FolderOpenIcon style={{ width: 11, height: 11 }} />
                      {r.name}
                    </button>
                  );
                }
                // All other types (url, youtube, unknown) → system browser
                return (
                  <button
                    key={r.url}
                    className="modal-resource-link"
                    onClick={() => openUrl(r.url)}
                  >
                    <ArrowTopRightOnSquareIcon style={{ width: 11, height: 11 }} />
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
