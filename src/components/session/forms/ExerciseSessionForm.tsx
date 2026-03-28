import { useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/16/solid";
import { postExerciseSession } from "../../../api/client";
import { LastSessionInfo } from "../LastSessionInfo";
import type { LastSessionData } from "../LastSessionInfo";
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
  initialNotes?: string;
  lastSession?: LastSessionData | null;
  onSubmit: (dailyPracticeTime: number) => void;
  onCancel: () => void;
}

export function ExerciseSessionForm({
  token,
  exerciseId,
  initialSeconds,
  initialNotes = "",
  lastSession,
  onSubmit,
  onCancel,
}: Props) {
  const [bpm, setBpm] = useState<string>("");
  const [rating, setRating] = useState<string>("3");
  const [seconds, setSeconds] = useState(String(initialSeconds));
  const [notes, setNotes] = useState(initialNotes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refBpm = useRef<number | null>(bpm ? Number(bpm) : null);

  function adjustBpm(direction: 1 | -1) {
    const current = Number(bpm) || 120;
    const next = Math.max(1, Math.min(400, Math.round(current * (1 + direction * 0.05))));
    setBpm(String(next));
  }

  const bpmPct = refBpm.current && bpm
    ? Math.round(Number(bpm) / refBpm.current * 100)
    : null;

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

      <div className="bpm-field">
        <label className="bpm-field-label">BPM</label>
        <input
          type="number"
          min={1}
          max={400}
          value={bpm}
          onChange={(e) => setBpm(e.target.value)}
          placeholder="—"
          className="bpm-number"
        />
        {bpmPct != null && (
          <span className="bpm-pct">{bpmPct}%</span>
        )}
        <button type="button" className="bpm-arrow" onClick={() => adjustBpm(-1)}>
          <ChevronLeftIcon className="icon-sm" />
        </button>
        <input
          type="range"
          min={20}
          max={240}
          value={bpm ? Math.min(240, Math.max(20, Number(bpm))) : 120}
          onChange={(e) => setBpm(e.target.value)}
          className="bpm-slider"
        />
        <button type="button" className="bpm-arrow" onClick={() => adjustBpm(1)}>
          <ChevronRightIcon className="icon-sm" />
        </button>
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
