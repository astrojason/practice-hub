import { useRef, useState } from "react";
import { postSongSession } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import { LastSessionInfo } from "../LastSessionInfo";
import type { LastSessionData } from "../LastSessionInfo";
import type { SongSessionPayload } from "../../../api/types";
import { RATING_OPTIONS } from "./shared/ratingOptions";
import { useRatingKeyShortcut } from "./shared/useRatingKeyShortcut";
import { BpmField } from "./shared/BpmField";

const FOCUS_OPTIONS = [
  { label: "Control", value: 1 },
  { label: "Clarity", value: 2 },
  { label: "Consistency", value: 3 },
  { label: "Musicality", value: 4 },
  { label: "Playthrough", value: 5 },
];

interface Props {
  token: string;
  songId: number;
  songBpm?: number | null;
  songSeconds?: number | null;
  songHasLead: boolean;
  songHasSinging: boolean;
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
  songHasLead,
  songHasSinging,
  initialSeconds,
  initialNotes = "",
  lastSession,
  onSubmit,
  onCancel,
}: Props) {
  const [focus, setFocus] = useState<string>("5");
  const [bpm, setBpm] = useState<string>(songBpm != null ? String(songBpm) : "");
  // Rhythm is assumed to always be part of a song, so its picker starts on a
  // real value; lead/singing start blank — a rating being set is what marks
  // that aspect as practiced this session, so blank means "not this time".
  const [rhythmRating, setRhythmRating] = useState<string>("3");
  const [leadRating, setLeadRating] = useState<string>("");
  const [singingRating, setSingingRating] = useState<string>("");
  const [fromMemory, setFromMemory] = useState(false);
  const [seconds, setSeconds] = useState(
    initialSeconds > 0 ? String(initialSeconds) : (songSeconds ? String(songSeconds) : "0")
  );
  const [notes, setNotes] = useState(initialNotes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refBpm = useRef<number | null>(songBpm ?? null);

  // Targets Rhythm specifically — it's the one aspect always present and the
  // picker that starts pre-selected; Lead/Singing are set via their own dropdowns.
  useRatingKeyShortcut(setRhythmRating);

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
        notes: notes.trim() || null,
        from_memory: fromMemory,
        rhythm_rating: rhythmRating ? parseInt(rhythmRating) : null,
        lead_rating: songHasLead && leadRating ? parseInt(leadRating) : null,
        singing_rating: songHasSinging && singingRating ? parseInt(singingRating) : null,
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
          Duration (sec)
          <input
            type="number"
            min={1}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </label>
      </div>

      <BpmField value={bpm} onChange={setBpm} referenceBpm={refBpm.current} />

      <div className="form-row">
        <label>
          Rhythm
          <select value={rhythmRating} onChange={(e) => setRhythmRating(e.target.value)}>
            <option value="">—</option>
            {RATING_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {songHasLead && (
          <label>
            Lead
            <select value={leadRating} onChange={(e) => setLeadRating(e.target.value)}>
              <option value="">—</option>
              {RATING_OPTIONS.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {songHasSinging && (
          <label>
            Singing
            <select value={singingRating} onChange={(e) => setSingingRating(e.target.value)}>
              <option value="">—</option>
              {RATING_OPTIONS.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
