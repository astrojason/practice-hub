import { useState } from "react";
import { postOpenSession } from "../../../api/client";
import type { OpenSessionPayload } from "../../../api/types";

const RATING_OPTIONS = [
  { label: "Awful", value: 1 },
  { label: "Bad", value: 2 },
  { label: "Neutral", value: 3 },
  { label: "Good", value: 4 },
  { label: "Great", value: 5 },
];

interface Props {
  token: string;
  onSubmit: (dailyPracticeTime: number) => void;
  onCancel: () => void;
}

export function OpenSessionForm({ token, onSubmit, onCancel }: Props) {
  const [rating, setRating] = useState<string>("");
  const [seconds, setSeconds] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: OpenSessionPayload = {
        seconds: Math.max(1, parseInt(seconds) || 1),
        rating: rating ? parseInt(rating) : null,
        notes: notes.trim() || null,
      };
      const res = await postOpenSession(token, payload);
      onSubmit(res.daily_practice_time);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form className="session-form open-session-form" onSubmit={handleSubmit}>
      <h3>Log Open Session</h3>
      <div className="form-row">
        <label>
          Duration (sec)
          <input
            type="number"
            min={1}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            placeholder="e.g. 300"
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
          placeholder="Optional"
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Saving…" : "Log Session"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}
