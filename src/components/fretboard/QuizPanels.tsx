import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ConfirmModal } from "../ConfirmModal";
import { byItem, stringPicks, summarize, type QuizRecord } from "../../lib/fretboard/history";
import { QUIZ_KINDS, type QuizKind } from "../../lib/fretboard/quiz";
import { BOTH_NAMES, KEYS, bothNames, plainName } from "../../lib/fretboard/theory";
import { RECENT, TO_CLEAR, statInfo } from "../../lib/fretboard/weakness";
import type { Pace } from "../../lib/fretboard/weakness";
import type { Quiz } from "./useQuiz";
import type { Voice } from "./useVoice";

const ANSWER_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "q", "w"];
export const answerKeyIndex = (key: string) => ANSWER_KEYS.indexOf(key.toLowerCase());

const s1 = (ms: number) => (ms / 1000).toFixed(1);

/** The prompt bar and the answer buttons. */
export function QuizMain({ quiz, scaleLabel, voice, voiceOn, tuning, onStop }: { quiz: Quiz; scaleLabel: string; voice: Voice; voiceOn: boolean; tuning: number[]; onStop: () => void }) {
  const info = QUIZ_KINDS.find((k) => k.id === quiz.kind)!;
  const q = quiz.question;
  const last = quiz.lastSession;
  const sum = summarize(last);
  const slow = byItem(last)[0];

  return (
    <div className="fb-quiz">
      <div className="fb-quiz-prompt">
        {quiz.running ? (
          <button className="btn-secondary fb-danger" onClick={onStop}>Stop</button>
        ) : (
          <button className="btn-primary" onClick={() => quiz.start()} title="Start a timed session; every answer's time is saved for the report">▶ Start</button>
        )}
        <strong className="fb-quiz-prompt__kind">{info.name}</strong>
        <span className="fb-dim">{info.help}</span>
        {quiz.running && (
          <span className="fb-quiz-timer" aria-label="Time">
            {quiz.secs.toFixed(1)} s
          </span>
        )}
      </div>

      {voiceOn && quiz.running && <VoiceRow voice={voice} />}

      {!quiz.running && (
        <div className="fb-quiz-intro-wrap">
          {last.length === 0 ? (
            <p className="fb-quiz-intro">Press Start when you're ready. Each answer is timed, and your times are kept for the report.</p>
          ) : (
            <div className="fb-quiz-summary">
              <strong>Last session</strong>
              <p>
                {sum.right} of {sum.answered} right ({Math.round((sum.right * 100) / Math.max(1, sum.answered))}%) · average {s1(sum.avgMs)} s per answer · fastest right answer {s1(sum.fastestMs)} s
              </p>
              {slow && <p className="fb-dim">Slowest: {slow.item} ({s1(slow.avgMs)} s on average)</p>}
            </div>
          )}
        </div>
      )}

      {quiz.running && q && q.kind === "findnote" && q.targetPc !== undefined && (
        <div className="fb-find">
          <p className="fb-find-prompt" data-pc={q.targetPc}>
            Find <strong>{BOTH_NAMES[q.targetPc]}</strong> on the fretboard
          </p>
          {quiz.picked !== null && quiz.pickSpot && (
            <div className="fb-quiz-feedback" role="status">
              <strong className={quiz.picked === q.answer ? "fb-good" : "fb-bad"}>{quiz.picked === q.answer ? "Correct!" : "Not quite."}</strong>
              <span>
                {quiz.picked === q.answer
                  ? `String ${6 - quiz.pickSpot[0]}, fret ${quiz.pickSpot[1]} is ${bothNames(q.targetPc)}.`
                  : `That was string ${6 - quiz.pickSpot[0]}, fret ${quiz.pickSpot[1]}: ${bothNames((tuning[quiz.pickSpot[0]] + quiz.pickSpot[1]) % 12)}. ${bothNames(q.targetPc)} is shown on the neck.`}
              </span>
              <button className="btn-primary" onClick={quiz.next} title="Enter or Space">Next question ▶</button>
            </div>
          )}
          {quiz.picked === null && <span className="fb-dim">Click the fret where you think it is.</span>}
        </div>
      )}
      {quiz.running && q && q.kind !== "findnote" && (
        <>
          <div className="fb-quiz-controls">
            <button className="btn-secondary" onClick={quiz.hear}>🔊 Hear it</button>
            {quiz.picked !== null ? (
              <div className="fb-quiz-feedback" role="status">
                <strong className={quiz.picked === q.answer ? "fb-good" : "fb-bad"}>{quiz.picked === q.answer ? "Correct!" : "Not quite."}</strong>
                <span>{q.explain}</span>
                <button className="btn-primary" onClick={quiz.next} title="Enter or Space">Next question ▶</button>
              </div>
            ) : (
              <span className="fb-dim">Pick your answer (or press its key: 1–9, 0, Q, W):</span>
            )}
          </div>
          <div className={`fb-quiz-choices ${q.choices.length === 12 ? "fb-quiz-choices--12" : ""}`}>
            {q.choices.map((c, i) => {
              const state = quiz.picked === null ? "" : i === q.answer ? "fb-quiz-choice--right" : quiz.picked === i ? "fb-quiz-choice--wrong" : "";
              return (
                <button key={i} className={`fb-quiz-choice ${state}`} onClick={() => quiz.answer(i)} title={`Key ${ANSWER_KEYS[i] ?? ""}`}>
                  <span className="fb-quiz-key">{(ANSWER_KEYS[i] ?? "").toUpperCase() === "0" ? "0" : (ANSWER_KEYS[i] ?? "").toUpperCase()}</span>
                  {c}
                </button>
              );
            })}
          </div>
        </>
      )}
      {quiz.kind === "degree" && <p className="fb-dim">Degrees are asked in {scaleLabel} — change the key and scale at the top.</p>}
    </div>
  );
}

/** What the microphone is doing: listening, what it heard, or why it stopped. */
function VoiceRow({ voice }: { voice: Voice }) {
  if (voice.error) {
    return (
      <div className="fb-voice-error" role="alert">
        <p>{voice.error}</p>
        <button className="btn-secondary" onClick={voice.retry}>Try again</button>
      </div>
    );
  }
  return (
    <div className="fb-voice-row">
      <span className="fb-voice-status" title={voice.onDevice === null ? "" : voice.onDevice ? "Recognised on this Mac" : "Recognised through Apple's service"}>
        {voice.status === "listening" ? "🎤 Listening — say your answer, “next” or “again”" : "🎤 Starting the microphone…"}
        {voice.dropouts > 0 && ` · ${voice.dropouts} audio dropout${voice.dropouts === 1 ? "" : "s"}${voice.dropouts >= 5 ? " (if this keeps happening, close other apps that use the microphone)" : ""}`}
      </span>
      <span className="fb-voice-meter" aria-hidden="true">
        <span className="fb-voice-meter__bar" style={{ width: `${Math.min(100, voice.level * 400)}%` }} />
      </span>
      {voice.heard !== null && <span className="fb-voice-heard fb-dim">Heard: “{voice.heard}”</span>}
    </div>
  );
}

interface SideProps {
  quiz: Quiz;
  voiceOn: boolean;
  onVoice: (on: boolean) => void;
  tuning: number[];
  pace: Pace;
  onReport: () => void;
  onConfirmReset: () => void;
  scaleLabel: string;
}

/** The side panel: kinds, frets, options, score, and what is saved. */
export function QuizSide({ quiz, voiceOn, onVoice, tuning, onReport, onConfirmReset, scaleLabel }: SideProps) {
  const sessions = new Set(quiz.history.map((r) => r.session)).size;
  const sum = summarize(quiz.session);
  const pct = quiz.total ? quiz.score / quiz.total : 0;
  return (
    <div className="fb-quiz-side">
      <h3 className="fb-quiz-side__title">Quiz</h3>
      <p className="fb-dim">Pick a kind of question:</p>
      <div className="fb-quiz-kinds">
        {QUIZ_KINDS.map((k) => (
          <button key={k.id} className={`fb-quiz-kind ${quiz.kind === k.id ? "active" : ""}`} onClick={() => quiz.setKind(k.id as QuizKind)}>
            {k.name}
          </button>
        ))}
      </div>
      <div className="fb-chip-row">
        <span className="fb-settings__label">Frets</span>
        {[
          [5, "0–5"],
          [12, "0–12"],
          [22, "Whole neck"],
        ].map(([n, label]) => (
          <label key={n} className="fb-playbar__check">
            <input type="radio" name="quiz-frets" checked={quiz.maxFret === n} onChange={() => quiz.setMaxFret(n as number)} /> {label}
          </label>
        ))}
      </div>
      <label className="fb-playbar__check" title="Ask more about the notes, degrees and intervals your history says you find hard">
        <input type="checkbox" checked={quiz.focusWeak} onChange={(e) => quiz.setFocusWeak(e.target.checked)} /> Focus on my weak spots
      </label>
      {quiz.kind === "findnote" && (
        <div className="fb-pick-strings" aria-label="Strings picked this session">
          <strong>Strings you picked</strong>
          {stringPicks(quiz.session).map((e) => (
            <div key={e.string} className="fb-pick-string" data-picks={e.picks}>
              <span className="fb-pick-string__name">{plainName(tuning[e.string])} · string {6 - e.string}</span>
              <span className="fb-pick-string__bar"><span style={{ width: `${Math.min(100, e.picks * 20)}%` }} /></span>
              <span className="fb-pick-string__count">{e.picks}{e.picks > 0 ? ` (${Math.round((e.right * 100) / e.picks)}% right)` : ""}</span>
            </div>
          ))}
        </div>
      )}
      {quiz.kind === "note" && (
        <label className="fb-playbar__check" title="Say the note's name instead of clicking: “C sharp”, “B flat”. Say “next” to move on, “hear it” to hear it again and “stop” to finish; the next question follows three seconds after each answer. Only for Name the note. Uses macOS speech recognition; macOS asks for permission the first time.">
          <input type="checkbox" checked={voiceOn} onChange={(e) => onVoice(e.target.checked)} /> Answer out loud (microphone)
        </label>
      )}
      {quiz.kind === "degree" && <p className="fb-dim">Degrees are asked in {scaleLabel} — change the key and scale at the top.</p>}

      <dl className="fb-quiz-stats">
        <dt>Score</dt>
        <dd className="fb-quiz-score">{quiz.score} / {quiz.total}</dd>
        <dt>Accuracy</dt>
        <dd>{Math.round(pct * 100)}%</dd>
        <dt>Streak</dt>
        <dd>{quiz.streak}</dd>
        <dt>Best streak (this session)</dt>
        <dd>{quiz.best}</dd>
        {quiz.session.length > 0 && (
          <>
            <dt>Average time</dt>
            <dd>{s1(sum.avgMs)} s</dd>
            <dt>Fastest right</dt>
            <dd>{s1(sum.fastestMs)} s</dd>
          </>
        )}
      </dl>
      <div className="fretboard-actions">
        <button className="btn-secondary" onClick={onReport}>Open the report</button>
        <button className="btn-ghost" onClick={onConfirmReset}>Reset score…</button>
      </div>
      <div className="fb-weak-card fb-quiz-saved">
        <strong>Saved between sessions</strong>
        <p>
          {quiz.history.length} answers from {sessions} session{sessions === 1 ? "" : "s"} are kept on this computer and come back when you reopen the app. Best streak ever: {quiz.bestEver}.
        </p>
      </div>
    </div>
  );
}

/** The quiz report: totals, sessions over time, and what takes longest or is missed most. */
export function QuizReport({ history, tuning, onClear, onClose }: { history: QuizRecord[]; tuning: number[]; onClear: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !confirm) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);

  const recs = history.filter((r) => kind === null || r.kind === kind);
  const sum = summarize(recs);
  const sessions = [...new Set(recs.map((r) => r.session))].sort((a, b) => a - b);
  const chart = sessions.slice(-20).map((sid) => {
    const rs = recs.filter((r) => r.session === sid);
    const s = summarize(rs);
    return { date: new Date(sid * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }), avg: +(s.avgMs / 1000).toFixed(1), right: Math.round((s.right * 100) / Math.max(1, s.answered)) };
  });
  const items = byItem(recs);
  const missed = items.filter((e) => e.misses > 0).sort((a, b) => b.misses / b.tries - a.misses / a.tries || b.misses - a.misses);

  return createPortal(
    <div className="error-modal-overlay" onClick={onClose}>
      <div className="error-modal fb-settings fb-report" role="dialog" aria-modal="true" aria-label="Quiz report" onClick={(e) => e.stopPropagation()}>
        <div className="error-modal-header">
          <h3 className="error-modal-title" style={{ color: "var(--text)" }}>Quiz report</h3>
          <button className="error-modal-close" onClick={onClose} aria-label="Close report">✕</button>
        </div>
        <label>
          Show
          <select aria-label="Report kind" value={kind ?? ""} onChange={(e) => setKind(e.target.value === "" ? null : parseInt(e.target.value))}>
            <option value="">All quizzes</option>
            {QUIZ_KINDS.map((k, i) => (
              <option key={k.id} value={i}>{k.name}</option>
            ))}
          </select>
        </label>
        {recs.length === 0 ? (
          <p className="fb-dim">No answers saved yet. Press Start in the Quiz and answer a few questions.</p>
        ) : (
          <>
            <div className="fb-report__totals">
              {[
                ["Answered", String(sum.answered)],
                ["Right", `${Math.round((sum.right * 100) / sum.answered)}%`],
                ["Average time", `${s1(sum.avgMs)} s`],
                ["Fastest right", `${s1(sum.fastestMs)} s`],
                ["Sessions", String(sessions.length)],
              ].map(([l, v]) => (
                <div key={l}>
                  <span className="fb-dim">{l}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <p className="fb-dim">Recent sessions — bars: average time (lower is faster) · line: % right</p>
            <div className="fb-speed-chart">
              <ResponsiveContainer width="100%" height={150}>
                <ComposedChart data={chart}>
                  <CartesianGrid stroke="var(--border-dim)" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} />
                  <YAxis yAxisId="t" stroke="var(--muted)" fontSize={10} width={30} />
                  <YAxis yAxisId="p" orientation="right" domain={[0, 100]} stroke="var(--muted)" fontSize={10} width={30} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
                  <Bar yAxisId="t" dataKey="avg" fill="var(--accent)" name="Average time (s)" isAnimationActive={false} />
                  <Line yAxisId="p" dataKey="right" stroke="var(--green)" dot={{ r: 3 }} name="% right" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="fb-report__tables">
              <div>
                <strong>Slowest to answer</strong>
                <table className="fb-speed-log">
                  <thead><tr><th>Answer</th><th>Avg time</th><th>Tries</th></tr></thead>
                  <tbody>
                    {items.slice(0, 10).map((e) => (
                      <tr key={e.item}><td>{e.item}</td><td>{s1(e.avgMs)} s</td><td>{e.tries}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <strong>Missed most often</strong>
                <table className="fb-speed-log">
                  <thead><tr><th>Answer</th><th>Missed</th><th>Tries</th></tr></thead>
                  <tbody>
                    {missed.length === 0 && <tr><td colSpan={3} className="fb-dim">Nothing missed yet</td></tr>}
                    {missed.slice(0, 10).map((e) => (
                      <tr key={e.item}><td>{e.item}</td><td>{e.misses} ({Math.round((e.misses * 100) / e.tries)}%)</td><td>{e.tries}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {recs.some((r) => r.kind === 5) && (
              <div className="fb-report__strings">
                <strong>Strings you pick (Find the note)</strong>
                <table className="fb-speed-log">
                  <thead><tr><th>String</th><th>Picks</th><th>Right</th></tr></thead>
                  <tbody>
                    {stringPicks(recs).map((e) => (
                      <tr key={e.string}>
                        <td>{plainName(tuning[e.string])} (string {6 - e.string})</td>
                        <td>{e.picks}</td>
                        <td>{e.picks ? `${Math.round((e.right * 100) / e.picks)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {kind === null && (
              <div>
                <strong>By quiz</strong>
                <table className="fb-speed-log">
                  <tbody>
                    {QUIZ_KINDS.map((k, i) => {
                      const rs = recs.filter((r) => r.kind === i);
                      if (!rs.length) return null;
                      const s = summarize(rs);
                      return (
                        <tr key={k.id}>
                          <td>{k.name}</td>
                          <td>{s.answered} answered</td>
                          <td>{Math.round((s.right * 100) / s.answered)}% right</td>
                          <td>{s1(s.avgMs)} s average</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="fretboard-actions">
              <button className="btn-ghost" onClick={() => setConfirm(true)}>Clear history…</button>
            </div>
          </>
        )}
      </div>
      {confirm && (
        <ConfirmModal
          title="Clear the quiz history?"
          message={`Delete all ${history.length} saved answers? Your reports and weak spots start again from nothing. This can't be undone.`}
          confirmLabel="Clear"
          onConfirm={() => {
            setConfirm(false);
            onClear();
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>,
    document.body,
  );
}

/** The side card on the other pages: what the quiz says you find hard here. */
export function WeakCard({
  quiz,
  keyIdx,
  scaleLabel,
  onQuiz,
  pace,
}: {
  quiz: Quiz;
  keyIdx: number;
  scaleLabel: string;
  onQuiz: (degree: boolean) => void;
  pace: Pace;
}) {
  const w = quiz.weak;
  const items: { what: string; st: Parameters<typeof w.describe>[1]; score: number }[] = [];
  for (const [k, st] of w.degree) {
    const [keyPc, label] = k.split(":");
    if (parseInt(keyPc) === keyIdx && w.isWeak(st)) items.push({ what: `The ${label} in ${KEYS[keyIdx]} (only in ${KEYS[keyIdx]})`, st, score: w.score(st) });
  }
  for (const [pc, st] of w.note) {
    if (w.isWeak(st)) items.push({ what: `Naming ${bothNames(pc)} (every ${bothNames(pc)}, any key)`, st, score: w.score(st) });
  }
  for (const [name, st] of w.interval) {
    if (w.isWeak(st)) items.push({ what: `The ${name.toLowerCase()} interval`, st, score: w.score(st) });
  }
  items.sort((a, b) => b.score - a.score);
  const shown = items.slice(0, 6);
  const spots = [...w.spot.values()].filter((st) => w.isWeak(st)).length;
  const degreeWeak = [...w.degree.entries()].some(([k, st]) => parseInt(k.split(":")[0]) === keyIdx && w.isWeak(st));
  const paceText =
    pace.type === "average"
      ? "your usual pace — your typical time for that kind of question over your last 5 sessions, plus 30% (speed isn't judged until you've answered 10 of that kind)"
      : `${(pace.ms / 1000).toFixed(1)} s or faster (the pace you set)`;
  void statInfo;
  return (
    <section className="fb-weak-card">
      <h3><span className="fb-weak-dot">!</span> Your weak spots</h3>
      {quiz.history.length === 0 ? (
        <p>Take a quiz and the app will point out the notes and degrees you find hard, here and on the neck.</p>
      ) : (
        <>
          {shown.length === 0 && spots === 0 && <p>Nothing stands out in {scaleLabel} from your quiz answers so far.</p>}
          <ul>
            {shown.map((i) => (
              <li key={i.what}>{w.describe(i.what, i.st)}</li>
            ))}
            {spots > 0 && <li>{spots} spot{spots === 1 ? "" : "s"} on the neck — marked with !</li>}
          </ul>
          <p className="fb-dim">Notes you find hard are marked with ! on the neck; hover one to see why.</p>
          <p className="fb-dim">
            A weak spot comes from your last {RECENT} tries and clears after {TO_CLEAR} right answers in a row at {paceText}. Degrees count per key; note names count everywhere. Change the pace in Settings.
          </p>
          {(shown.length > 0 || spots > 0) && (
            <button className="btn-secondary" onClick={() => onQuiz(degreeWeak)}>Quiz me on these</button>
          )}
        </>
      )}
    </section>
  );
}
