import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import { TUTORIALS } from "../help/tutorials";

interface Props {
  onClose: () => void;
}

export function HelpModal({ onClose }: Props) {
  const [selectedId, setSelectedId] = useState(TUTORIALS[0]?.id ?? null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected = TUTORIALS.find((t) => t.id === selectedId) ?? null;

  return createPortal(
    <div className="help-modal-overlay" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="help-modal-header">
          <h3 className="help-modal-title">Help & Tutorials</h3>
          <button className="help-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="help-modal-body">
          <nav className="help-modal-sidebar">
            {TUTORIALS.map((t) => (
              <button
                key={t.id}
                className={`help-modal-list-item${t.id === selectedId ? " active" : ""}`}
                onClick={() => setSelectedId(t.id)}
              >
                {t.title}
              </button>
            ))}
          </nav>
          <div className="help-modal-content">
            {selected ? (
              <Markdown>{selected.content}</Markdown>
            ) : (
              <p className="help-modal-empty">No tutorials available yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
