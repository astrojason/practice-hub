import { useEffect, useState } from "react";
import { getAiChallenges, updateAiChallenge } from "../../api/client";
import type { AiChallenge, AiChallengeAction, AiChallengePeriod } from "../../api/types";
import { ErrorModal } from "../ErrorModal";

const PERIOD_LABELS: Record<AiChallengePeriod, string> = {
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  token: string;
  /** Changes whenever a session is logged, so measured progress is refetched. */
  refreshKey: number;
}

/** The AI-written daily, weekly and monthly challenges, shown above today's list. */
export function AiChallengesPanel({ token, refreshKey }: Props) {
  const [challenges, setChallenges] = useState<AiChallenge[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiChallenges(token)
      .then((res) => {
        if (!cancelled) setChallenges(res.current ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(`Couldn't load AI challenges: ${message(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

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
      {challenges.length > 0 && (
        <section className="ai-challenges" aria-label="AI challenges">
          <h2 className="ai-challenges-title">AI Challenges</h2>
          <div className="ai-challenges-list">
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
        </section>
      )}
    </>
  );
}
