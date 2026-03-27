import { useEffect } from "react";
import { ArrowTopRightOnSquareIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { openUrl } from "@tauri-apps/plugin-opener";

interface Resource {
  name: string;
  url: string;
}

interface Props {
  title: string;
  subtitle?: string;
  resources?: Resource[];
  onClose: () => void;
  children: React.ReactNode;
}

export function SessionModal({ title, subtitle, resources, onClose, children }: Props) {
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
              {resources.map((r) => (
                <button
                  key={r.url}
                  className="modal-resource-link"
                  onClick={() => openUrl(r.url)}
                >
                  <ArrowTopRightOnSquareIcon style={{ width: 11, height: 11 }} />
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
