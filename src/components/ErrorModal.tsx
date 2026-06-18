import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  error: string;
  onDismiss: () => void;
}

export function ErrorModal({ error, onDismiss }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <div className="error-modal-overlay" onClick={onDismiss}>
      <div className="error-modal" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="error-modal-header">
          <h3 className="error-modal-title">Error</h3>
          <button className="error-modal-close" onClick={onDismiss} aria-label="Dismiss">✕</button>
        </div>
        <p className="error-modal-message">{error}</p>
        <div className="error-modal-footer">
          <button className="btn-primary" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
