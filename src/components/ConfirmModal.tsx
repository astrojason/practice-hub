import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="error-modal-overlay" onClick={onCancel}>
      <div className="error-modal confirm-modal" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="error-modal-header">
          <h3 className="error-modal-title">{title}</h3>
          <button className="error-modal-close" onClick={onCancel} aria-label="Cancel">✕</button>
        </div>
        <p className="error-modal-message">{message}</p>
        <div className="error-modal-footer">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
