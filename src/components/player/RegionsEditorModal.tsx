import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Region } from "./useRegions";

export interface RegionEdit {
  id: string;
  name: string;
  start: number;
  end: number;
}

interface Props {
  regions: Region[];
  formatTime: (s: number) => string;
  /** Returns seconds, or null when the text isn't a valid time. */
  parseTime: (text: string) => number | null;
  onSave: (edits: RegionEdit[]) => void;
  onClose: () => void;
}

interface Draft { id: string; name: string; start: string; end: string }

/** Every region of the resource in one place, for editing names and start/end spots together. */
export function RegionsEditorModal({ regions, formatTime, parseTime, onSave, onClose }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    regions.map(r => ({ id: r.id, name: r.name ?? "", start: formatTime(r.start), end: formatTime(r.end) }))
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = (id: string, field: "name" | "start" | "end", value: string) =>
    setDrafts(ds => ds.map(d => d.id === id ? { ...d, [field]: value } : d));

  const save = () => {
    const edits: RegionEdit[] = [];
    for (const [i, d] of drafts.entries()) {
      const label = d.name.trim() || `Region ${i + 1}`;
      const start = parseTime(d.start);
      const end = parseTime(d.end);
      if (start === null || end === null) {
        setError(`"${label}": start and end must be times like 1:23.45 or 83.5.`);
        return;
      }
      if (end <= start) {
        setError(`"${label}": end must be after start.`);
        return;
      }
      edits.push({ id: d.id, name: d.name.trim(), start, end });
    }
    onSave(edits);
  };

  return createPortal(
    <div className="error-modal-overlay" onClick={onClose}>
      <div className="error-modal regions-modal" data-testid="regions-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="error-modal-header">
          <h3 className="error-modal-title">Edit regions</h3>
          <button className="error-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="regions-modal__body">
          <div className="regions-modal__row regions-modal__head">
            <span>Name</span><span>Start</span><span>End</span>
          </div>
          {drafts.map(d => (
            <div key={d.id} className="regions-modal__row" data-regions-modal-row>
              <input data-field="name" value={d.name} onChange={e => patch(d.id, "name", e.target.value)} />
              <input data-field="start" value={d.start} onChange={e => patch(d.id, "start", e.target.value)} />
              <input data-field="end" value={d.end} onChange={e => patch(d.id, "end", e.target.value)} />
            </div>
          ))}
        </div>
        {error && <p className="regions-modal__error">{error}</p>}
        <div className="error-modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" id="saveRegionsModalBtn" onClick={save}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
