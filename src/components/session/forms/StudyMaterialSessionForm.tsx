import { useState } from "react";
import { postStudyMaterialSession } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import { LastSessionInfo } from "../LastSessionInfo";
import type { LastSessionData } from "../LastSessionInfo";
import type { StudyMaterialSessionPayload } from "../../../api/types";
import { RATING_OPTIONS } from "./shared/ratingOptions";
import { useRatingKeyShortcut } from "./shared/useRatingKeyShortcut";

interface Props {
  token: string;
  studyMaterialId: number;
  initialSeconds: number;
  initialNotes?: string;
  lastSession?: LastSessionData | null;
  onSubmit: (dailyPracticeTime: number) => void;
  onCancel: () => void;
}

export function StudyMaterialSessionForm({
  token,
  studyMaterialId,
  initialSeconds,
  initialNotes = "",
  lastSession,
  onSubmit,
  onCancel,
}: Props) {
  const [rating, setRating] = useState<string>("3");
  const [seconds, setSeconds] = useState(String(initialSeconds));
  const [notes, setNotes] = useState(initialNotes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useRatingKeyShortcut(setRating);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: StudyMaterialSessionPayload = {
        study_material_id: studyMaterialId,
        seconds: Math.max(1, parseInt(seconds) || 1),
        rating: rating ? parseInt(rating) : null,
        notes: notes.trim() || null,
      };
      const res = await postStudyMaterialSession(token, payload);
      onSubmit(res.daily_practice_time);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form className="session-form" onSubmit={handleSubmit}>
      {lastSession && <LastSessionInfo session={lastSession} />}
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

      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}

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
