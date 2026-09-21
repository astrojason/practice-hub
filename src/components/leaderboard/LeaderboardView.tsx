import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/16/solid";
import { getLeaderboard, getLeaderboardProfile, updateLeaderboardProfile } from "../../api/client";
import { ErrorModal } from "../ErrorModal";
import type { LeaderboardPeriod, LeaderboardProfile, LeaderboardResponse } from "../../api/types";

const TABS: { period: LeaderboardPeriod; label: string }[] = [
  { period: "daily", label: "Daily" },
  { period: "weekly", label: "Weekly" },
  { period: "monthly", label: "Monthly" },
  { period: "all_time", label: "All time" },
];

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

interface Props {
  token: string;
  onBack: () => void;
}

export function LeaderboardView({ token, onBack }: Props) {
  const [profile, setProfile] = useState<LeaderboardProfile | null>(null);
  const [period, setPeriod] = useState<LeaderboardPeriod>("daily");
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  useEffect(() => {
    getLeaderboardProfile(token)
      .then((p) => {
        setProfile(p);
        setNameInput(p.display_name ?? "");
      })
      .catch((err) => setError(message(err)));
  }, [token]);

  const optedIn = profile?.opted_in === true;
  useEffect(() => {
    if (!optedIn) return;
    setBoard(null);
    let cancelled = false;
    getLeaderboard(token, period)
      .then((res) => {
        if (!cancelled) setBoard(res);
      })
      .catch((err) => {
        if (!cancelled) setError(message(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, period, optedIn]);

  async function saveProfile(payload: { opted_in: boolean; display_name?: string }) {
    setSaving(true);
    try {
      setProfile(await updateLeaderboardProfile(token, payload));
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  const meInEntries = board?.entries.some((e) => e.is_me) ?? false;

  return (
    <div className="lb-view">
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
      <div className="lb-header">
        <button onClick={onBack} className="btn-ghost">
          <ArrowLeftIcon className="icon-sm" /> Back
        </button>
        <h2>Leaderboard</h2>
        {optedIn && (
          <button
            className="btn-ghost lb-leave"
            disabled={saving}
            onClick={() => saveProfile({ opted_in: false })}
          >
            Leave leaderboard
          </button>
        )}
      </div>

      {profile === null && !error && <p className="lb-empty">Loading…</p>}

      {profile !== null && !optedIn && (
        <form
          className="lb-join"
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile({ opted_in: true, display_name: nameInput.trim() });
          }}
        >
          <p>
            Compete on practice time. Only your display name and time practiced are shown to others, and only once
            you join.
          </p>
          <label htmlFor="lb-name">Display name</label>
          <input
            id="lb-name"
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            minLength={2}
            maxLength={24}
            required
          />
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Joining…" : "Join leaderboard"}
          </button>
        </form>
      )}

      {optedIn && (
        <>
          <div className="lb-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.period}
                role="tab"
                aria-selected={period === t.period}
                className={`lb-tab${period === t.period ? " lb-tab--active" : ""}`}
                onClick={() => setPeriod(t.period)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {period === "all_time" && board?.window_start != null && (
            <p className="lb-note">
              Everyone is ranked on practice since you joined (
              {new Date(board.window_start * 1000).toLocaleDateString("en-CA")}), so longer-standing members
              don&apos;t get a head start.
            </p>
          )}

          {board === null && !error && <p className="lb-empty">Loading…</p>}
          {board !== null && board.entries.length === 0 && (
            <p className="lb-empty">Nobody has practiced in this window yet. Log a session to take the lead.</p>
          )}
          {board !== null && board.entries.length > 0 && (
            <ol className="lb-list">
              {board.entries.map((e) => (
                <li key={`${e.rank}-${e.display_name}`} className={`lb-row${e.is_me ? " lb-row--me" : ""}`}>
                  <span className="lb-rank">{e.rank}</span>
                  <span className="lb-name">{e.display_name}</span>
                  <span className="lb-time">{formatDuration(e.seconds)}</span>
                </li>
              ))}
            </ol>
          )}
          {board?.me && !meInEntries && (
            <p className="lb-me-summary">
              {board.me.rank != null ? `You're #${board.me.rank}` : "You haven't practiced in this window"} ·{" "}
              {formatDuration(board.me.seconds)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
