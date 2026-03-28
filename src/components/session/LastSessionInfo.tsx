import Markdown from "react-markdown";
import type { StudyFocus, StudyRating } from "../../api/types";

export interface LastSessionData {
  rating: StudyRating | null;
  notes: string | null;
  focus?: StudyFocus | null;  // songs only
  bpm?: number | null;        // songs + exercises
  created_timestamp: number;  // Unix seconds
}

function formatDate(timestamp: number): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
  const date = new Date(timestamp);
  const today = new Date();
  if (fmt(date) === fmt(today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (fmt(date) === fmt(yesterday)) return "Yesterday";
  const diffDays = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface Props {
  session: LastSessionData;
}

export function LastSessionInfo({ session }: Props) {
  const { rating, notes, focus, bpm, created_timestamp } = session;

  type Chip = { label: string; value: string };
  const chips: Chip[] = [];
  if (rating) chips.push({ label: "Rating", value: rating });
  if (focus)  chips.push({ label: "Focus",  value: focus });
  if (bpm)    chips.push({ label: "BPM",    value: String(bpm) });

  return (
    <div className="last-session">
      <span className="last-session-label">Last · {formatDate(created_timestamp)}</span>
      {chips.length > 0 && (
        <div className="last-session-chips">
          {chips.map((c) => (
            <span key={c.label} className="last-session-chip">
              <span className="last-session-chip-label">{c.label}</span>
              {c.value}
            </span>
          ))}
        </div>
      )}
      {notes && (
        <div className="last-session-notes">
          <Markdown>{notes}</Markdown>
        </div>
      )}
    </div>
  );
}
