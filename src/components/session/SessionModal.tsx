import { useEffect } from "react";
import { ArrowTopRightOnSquareIcon, FolderOpenIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Resource } from "../../api/types";

// Infer media type from file extension so the player panel knows what to render.
function mediaTypeFromPath(path: string): "audio" | "video" {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["mp4", "mov", "webm", "m4v", "ogv"].includes(ext) ? "video" : "audio";
}

interface Props {
  title: string;
  subtitle?: string;
  resources?: Resource[];
  onClose: () => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video") => void;
  children: React.ReactNode;
}

export function SessionModal({ title, subtitle, resources, onClose, onOpenFile, children }: Props) {
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
                if (r.type === "local_file") {
                  // Open in the in-app player
                  return (
                    <button
                      key={r.url}
                      className="modal-resource-link modal-resource-link--local"
                      onClick={() => { onOpenFile?.(r.url, mediaTypeFromPath(r.url)); onClose(); }}
                    >
                      <FolderOpenIcon style={{ width: 11, height: 11 }} />
                      {r.name}
                    </button>
                  );
                }
                // All other types (url, youtube, guitar_pro, unknown) → system browser
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
