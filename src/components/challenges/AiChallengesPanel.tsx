import { useEffect, useState } from "react";
import { generateAiChallenges, getAiChallenges, updateAiChallenge } from "../../api/client";
import type { AiChallenge, AiChallengeAction, AiChallengePeriod } from "../../api/types";
import { ErrorModal } from "../ErrorModal";
import { ItemGroup } from "../session/ItemGroup";

const PERIOD_LABELS: Record<AiChallengePeriod, string> = {
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
};

const PERIODS: AiChallengePeriod[] = ["daily", "weekly", "monthly"];
/** While challenges are still being written, look again this often (tests shorten it). */
const pollMs = () => (window as unknown as { __challengePollMs?: number }).__challengePollMs ?? 5 * 60 * 1000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  token: string;
  /** Changes whenever a session is logged, so measured progress is refetched. */
  refreshKey: number;
  /** Starts a practice session (timer) for the challenge's song/exercise/study material. */
  onStartSession: (challenge: AiChallenge) => void;
}

/** The AI-written daily, weekly and monthly challenges, shown as a group at the bottom of today's list. */
export function AiChallengesPanel({ token, refreshKey, onStartSession }: Props) {
  const [challenges, setChallenges] = useState<AiChallenge[]>([]);
  const [pending, setPending] = useState<AiChallengePeriod[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiChallenges(token)
      .then((res) => {
        if (cancelled) return;
        setChallenges(res.current ?? []);
        setPending(res.pending_periods ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(`Couldn't load AI challenges: ${message(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey, reload]);

  // The nightly run writes the day's challenges a few minutes after midnight, and one
  // opened in that gap (or before it ran) has none yet: look again until they arrive.
  const waiting = pending.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setReload((n) => n + 1), pollMs());
    return () => clearInterval(timer);
  }, [waiting]);

  const generate = () => {
    setGenerating(true);
    setGenerated(null);
    generateAiChallenges(token)
      .then((res) => {
        setGenerated(res.message);
        setReload((n) => n + 1);
      })
      .catch((err) => setError(`Couldn't write the challenges: ${message(err)}`))
      .finally(() => setGenerating(false));
  };

  const act = (challenge: AiChallenge, action: AiChallengeAction) => {
    setBusyId(challenge.id);
    updateAiChallenge(token, challenge.id, action)
      .then(({ challenge: updated }) =>
        setChallenges((list) => list.map((c) => (c.id === updated.id ? updated : c)))
      )
      .catch((err) => setError(`Couldn't update the challenge: ${message(err)}`))
      .finally(() => setBusyId(null));
  };

  return (
    <>
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
      {(challenges.length > 0 || pending.length > 0) && (
        <ItemGroup
          title="AI Challenges"
          completedCount={challenges.filter((c) => c.completed).length}
          totalCount={challenges.length + pending.length}
        >
          <div className="ai-challenges" aria-label="AI challenges">
          {pending.length > 0 && (
            <div className="ai-challenges-generate">
              <button className="btn-secondary" disabled={generating} onClick={generate}>
                {generating ? "Generating…" : "Generate now"}
              </button>
            </div>
          )}
          {generated && <div className="ai-challenge-progress">{generated}</div>}
          <div className="ai-challenges-list">
            {PERIODS.filter((p) => pending.includes(p)).map((p) => (
              <div key={`${p}-pending`} data-pending={p} className="ai-challenge">
                <div className="ai-challenge-top">
                  <span className="ai-challenge-period">{PERIOD_LABELS[p]}</span>
                </div>
                <div className="ai-challenge-description">Your {p} challenge is being written…</div>
              </div>
            ))}
            {challenges.map((c) => {
              const percent = Math.min(100, Math.round((c.current / Math.max(1, c.target)) * 100));
              return (
                <div
                  key={c.id}
                  data-challenge-id={c.id}
                  className={`ai-challenge${c.completed ? " ai-challenge-done" : ""}`}
                >
                  <div className="ai-challenge-top">
                    <span className="ai-challenge-period">{PERIOD_LABELS[c.period]}</span>
                    {c.completed && <span className="ai-challenge-done-label">Done</span>}
                  </div>
                  <div className="ai-challenge-name">{c.title}</div>
                  {c.description && <div className="ai-challenge-description">{c.description}</div>}
                  {c.item_type && c.item_id != null && (
                    <button className="btn-secondary" onClick={() => onStartSession(c)}>
                      Start session
                    </button>
                  )}
                  {c.measurable ? (
                    <>
                      <div
                        className="ai-challenge-bar"
                        role="progressbar"
                        aria-valuenow={c.current}
                        aria-valuemin={0}
                        aria-valuemax={c.target}
                      >
                        <div className="ai-challenge-bar-fill" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="ai-challenge-progress">
                        {c.current} / {c.target} {c.unit}
                      </div>
                    </>
                  ) : (
                    <button
                      className="btn-secondary"
                      disabled={busyId === c.id}
                      onClick={() => act(c, c.completed ? "reopen" : "complete")}
                    >
                      {c.completed ? "Undo" : "Mark done"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          </div>
        </ItemGroup>
      )}
    </>
  );
}
