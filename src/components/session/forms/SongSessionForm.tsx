import { useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/16/solid";
import { postSongSession } from "../../../api/client";
import { LastSessionInfo } from "../LastSessionInfo";
import type { LastSessionData } from "../LastSessionInfo";
import type { SongSessionPayload } from "../../../api/types";

const FOCUS_OPTIONS = [
  { label: "Control", value: 1 },
  { label: "Clarity", value: 2 },
  { label: "Consistency", value: 3 },
  { label: "Musicality", value: 4 },
  { label: "Playthrough", value: 5 },
];

const RATING_OPTIONS = [
  { label: "Awful", value: 1 },
  { label: "Bad", value: 2 },
  { label: "Neutral", value: 3 },
  { label: "Good", value: 4 },
  { label: "Great", value: 5 },
];

interface Props {
  token: string;
  songId: number;
  songBpm?: number | null;
  songSeconds?: number | null;
  initialSeconds: number;
  initialNotes?: string;
  lastSession?: LastSessionData | null;
  onSubmit: (dailyPracticeTime: number) => void;
  onCancel: () => void;
}

export function SongSessionForm({
  token,
  songId,
  songBpm,
  songSeconds,
  initialSeconds,
  initialNotes = "",
  lastSession,
  onSubmit,
  onCancel,
}: Props) {
  const [focus, setFocus] = useState<string>("5");
  const [rhythm, setRhythm] = useState(false);
  const [lead, setLead] = useState(false);
  const [singing, setSinging] = useState(false);
  const [bpm, setBpm] = useState<string>(songBpm != null ? String(songBpm) : "");
  const [rating, setRating] = useState<string>("3");
  const [fromMemory, setFromMemory] = useState(false);
  const [seconds, setSeconds] = useState(
    initialSeconds > 0 ? String(initialSeconds) : (songSeconds ? String(songSeconds) : "0")
  );
  const [notes, setNotes] = useState(initialNotes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refBpm = useRef<number | null>(songBpm ?? null);

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
      const payload: SongSessionPayload = {
        song_id: songId,
        seconds: Math.max(1, parseInt(seconds) || 1),
        focus: focus ? parseInt(focus) : null,
        bpm: bpm ? parseInt(bpm) : null,
        rating: rating ? parseInt(rating) : null,
        notes: notes.trim() || null,
        from_memory: fromMemory,
        rhythm,
        lead,
        singing,
      };
      const res = await postSongSession(token, payload);
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
          Focus
          <select value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">—</option>
            {FOCUS_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
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

      <div className="form-row">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={rhythm}
            onChange={(e) => setRhythm(e.target.checked)}
          />
          Rhythm
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={lead}
            onChange={(e) => setLead(e.target.checked)}
          />
          Lead
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={singing}
            onChange={(e) => setSinging(e.target.checked)}
          />
          Singing
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={fromMemory}
            onChange={(e) => setFromMemory(e.target.checked)}
          />
          From memory
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
