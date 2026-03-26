import { useState } from "react";
import { postExerciseSession } from "../../../api/client";
import type { ExerciseSessionPayload } from "../../../api/types";

const RATING_OPTIONS = [
  { label: "Awful", value: 1 },
  { label: "Bad", value: 2 },
  { label: "Neutral", value: 3 },
  { label: "Good", value: 4 },
  { label: "Great", value: 5 },
];

interface Props {
  token: string;
  exerciseId: number;
  initialSeconds: number;
  onSubmit: (dailyPracticeTime: number) => void;
  onCancel: () => void;
}

export function ExerciseSessionForm({
  token,
  exerciseId,
  initialSeconds,
  onSubmit,
  onCancel,
}: Props) {
  const [bpm, setBpm] = useState<string>("");
  const [rating, setRating] = useState<string>("");
  const [seconds, setSeconds] = useState(String(initialSeconds));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: ExerciseSessionPayload = {
        exercise_id: exerciseId,
        seconds: Math.max(1, parseInt(seconds) || 1),
        bpm: bpm ? parseInt(bpm) : null,
        rating: rating ? parseInt(rating) : null,
        notes: notes.trim() || null,
      };
      const res = await postExerciseSession(token, payload);
      onSubmit(res.daily_practice_time);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form className="session-form" onSubmit={handleSubmit}>
      <div className="form-row">
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

        <label>
          BPM
          <input
            type="number"
            min={1}
            max={400}
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
            placeholder="—"
          />
        </label>

        <label>
          Duration (sec)
          <input
            type="number"
            min={1}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
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
