import { useState } from "react";
import {
  NoSymbolIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "@heroicons/react/16/solid";
import { postOpenSession } from "../../../api/client";
import { SessionModal } from "../SessionModal";
import type { OpenSessionPayload } from "../../../api/types";

const RATING_OPTIONS = [
  { label: "Awful", value: 1 },
  { label: "Bad", value: 2 },
  { label: "Neutral", value: 3 },
  { label: "Good", value: 4 },
  { label: "Great", value: 5 },
];

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface Props {
  token: string;
  elapsed: number;       // live elapsed seconds, managed by parent
  isActive: boolean;     // is the timer currently running
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;  // cancel session entirely (clears timer + closes modal)
  onClose: () => void;   // close modal only (keeps timer running)
  onSubmit: (dailyPracticeTime: number) => void;
}

export function OpenSessionForm({
  token,
  elapsed,
  isActive,
  onPause,
  onResume,
  onCancel,
  onClose,
  onSubmit,
}: Props) {
  type Phase = "running" | "form";
  const [phase, setPhase] = useState<Phase>("running");
  const [formSeconds, setFormSeconds] = useState("");
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStopAndSave() {
    onPause();
    setFormSeconds(String(elapsed));
    setPhase("form");
  }

  function handleBack() {
    setPhase("running");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: OpenSessionPayload = {
        seconds: Math.max(1, parseInt(formSeconds) || 1),
        rating: rating ? parseInt(rating) : null,
        notes: notes.trim(),
      };
      const res = await postOpenSession(token, payload);
      onSubmit(res.daily_practice_time);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <SessionModal title="Open Session" onClose={onClose}>
      {phase === "running" ? (
        <div className="modal-session-body">
          <div className="modal-elapsed-display">{formatElapsed(elapsed)}</div>

          <label className="form-full modal-notes-label">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What are you working on?"
            />
          </label>

          <div className="modal-session-controls">
            {isActive ? (
              <button className="btn-secondary" onClick={onPause}>
                <PauseIcon className="icon" /> Pause
              </button>
            ) : (
              <button className="btn-secondary" onClick={onResume}>
                <PlayIcon className="icon" /> Resume
              </button>
            )}
            <button className="btn-primary" onClick={handleStopAndSave}>
              <StopIcon className="icon" /> Stop &amp; Save
            </button>
            <button className="btn-ghost" onClick={onCancel}>
              <NoSymbolIcon className="icon" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <form className="session-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>
              Duration (sec)
              <input
                type="number"
                min={1}
                value={formSeconds}
                onChange={(e) => setFormSeconds(e.target.value)}
                required
              />
            </label>

            <label>
              Rating
              <select value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="">—</option>
                {RATING_OPTIONS.map((o) => (
                  <option key={o.value} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="form-full">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              required
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="form-actions">
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "Saving…" : "Log Session"}
            </button>
            <button type="button" onClick={handleBack} className="btn-ghost">
              Back
            </button>
          </div>
        </form>
      )}
    </SessionModal>
  );
}
