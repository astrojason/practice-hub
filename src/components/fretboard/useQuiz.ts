import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../../lib/fretboard/audio";
import { appendRecord, bestStreak, clearHistory, loadHistory, type QuizRecord } from "../../lib/fretboard/history";
import { QUIZ_KINDS, Rng, itemName, kindIndex, makeQuestion, type Question, type QuizKind } from "../../lib/fretboard/quiz";
import { Weakness, type Pace } from "../../lib/fretboard/weakness";
import { logTrainerActivity } from "../../lib/trainerSession";

interface Options {
  tuning: number[];
  key: number;
  scaleIdx: number;
  pace: Pace;
  scaleName: string;
  keyName: string;
  onError: (message: string) => void;
  onHighlight: (code: string | null) => void;
  /** The app is about to make sound for this many milliseconds (so the microphone can pause). */
  onSound?: (ms: number) => void;
}

/** Everything a running quiz needs: the question, answers, timing, history and weak spots. */
export function useQuiz({ tuning, key, scaleIdx, pace, scaleName, keyName, onError, onHighlight, onSound }: Options) {
  const [kind, setKindState] = useState<QuizKind>("note");
  const [maxFret, setMaxFretState] = useState(22);
  const [focusWeak, setFocusWeak] = useState(false);
  const [running, setRunning] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  /** "Find the note": where on the neck the answer was clicked. */
  const [pickSpot, setPickSpot] = useState<[number, number] | null>(null);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [session, setSession] = useState<QuizRecord[]>([]);
  const [lastSession, setLastSession] = useState<QuizRecord[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [loaded] = useState(() => loadHistory());
  const [history, setHistory] = useState<QuizRecord[]>(loaded.records);
  const sessionId = useRef(0);
  const rng = useRef(new Rng(Date.now()));
  const loadError = useRef(loaded.error);

  useEffect(() => {
    if (loadError.current) {
      onError(loadError.current);
      loadError.current = null;
    }
  }, [onError]);

  const weak = useMemo(() => new Weakness(history, pace), [history, pace]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  const questionWeight = useCallback(
    (q: Question): number => {
      const answer = itemName(q.choices[q.answer] ?? "");
      let score = 0;
      const sc = (st: Parameters<Weakness["score"]>[0] | undefined) => (st ? weak.score(st) : 0);
      switch (q.kind) {
        case "note":
          if (q.notes[0]) {
            const [s, f] = q.notes[0];
            score += sc(weak.note.get((tuning[s] + f) % 12)) + sc(weak.spot.get(`${s}:${f}`));
          }
          break;
        case "degree":
          score += sc(weak.degree.get(`${key}:${answer}`));
          if (q.notes[0]) score += sc(weak.spot.get(`${q.notes[0][0]}:${q.notes[0][1]}`));
          break;
        case "interval":
        case "earinterval":
          score += sc(weak.interval.get(answer));
          break;
        default:
          break;
      }
      return score;
    },
    [weak, tuning, key],
  );

  /** Play the question: the notes one after another, or together for a chord. */
  const hear = useCallback(
    (q: Question, revealed: boolean) => {
      try {
        const gap = q.together ? 0.03 : 0.55;
        onSound?.((q.notes.length * gap + 2.5) * 1000);
        engine.play({
          events: q.notes.map(([s, f], i) => ({
            time: i * gap,
            kind: { type: "note" as const, midi: tuning[s] + f, string: s, velocity: 0.8, ...(revealed || !QUIZ_KINDS[kindIndex(q.kind)].byEar ? { highlight: `${s}:${f}` } : {}) },
          })),
          length: q.notes.length * gap + 0.3,
          loop: false,
          onHighlight,
        });
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    },
    [tuning, onHighlight, onError, onSound],
  );

  const next = useCallback(
    (k: QuizKind = kind, mf: number = maxFret, run: boolean = running) => {
      if (!run) {
        setQuestion(null);
        setPicked(null);
        return;
      }
      let q = makeQuestion(k, rng.current, tuning, key, scaleIdx, mf);
      if (focusWeak) {
        // Try a few questions and keep the one about what you find hardest (with a little chance mixed in).
        let bestW = questionWeight(q) + rng.current.below(100) * 0.002;
        for (let i = 0; i < 7; i++) {
          const c = makeQuestion(k, rng.current, tuning, key, scaleIdx, mf);
          const w = questionWeight(c) + rng.current.below(100) * 0.002;
          if (w > bestW) {
            bestW = w;
            q = c;
          }
        }
      }
      setQuestion(q);
      setPicked(null);
      setPickSpot(null);
      setShownAt(Date.now());
      setNow(Date.now());
      if (QUIZ_KINDS[kindIndex(k)].byEar) hear(q, false);
    },
    [kind, maxFret, running, tuning, key, scaleIdx, focusWeak, questionWeight, hear],
  );

  const start = useCallback(
    (k: QuizKind = kind) => {
      setKindState(k);
      setRunning(true);
      sessionId.current = Math.floor(Date.now() / 1000);
      setSession([]);
      setScore(0);
      setTotal(0);
      setStreak(0);
      const info = QUIZ_KINDS[kindIndex(k)];
      logTrainerActivity(`Fretboard Trainer — Quiz: ${info.name}${k === "degree" ? ` in ${keyName} ${scaleName}` : ""}`);
      next(k, maxFret, true);
    },
    [kind, maxFret, next, keyName, scaleName],
  );

  const stop = useCallback(() => {
    engine.stop();
    setRunning(false);
    setQuestion(null);
    setPicked(null);
    setLastSession((cur) => (session.length ? session : cur));
  }, [session]);

  const answer = useCallback(
    (choice: number, atMs?: number | null, spot?: [number, number]) => {
      if (!question || picked !== null) return;
      const correct = choice === question.answer;
      // A spoken answer is timed to when speaking began.
      const ms = Math.max(0, Math.round((atMs ?? Date.now()) - shownAt));
      const rec: QuizRecord = {
        when: Math.floor(Date.now() / 1000),
        session: sessionId.current,
        kind: kindIndex(question.kind),
        item: itemName(question.choices[question.answer] ?? ""),
        correct,
        ms,
        key,
        spot: spot ?? (QUIZ_KINDS[kindIndex(question.kind)].byEar ? null : (question.notes[0] ?? null)),
      };
      try {
        setHistory(appendRecord(history, rec));
      } catch (err) {
        onError(`Your answer time couldn't be saved for the report: ${err instanceof Error ? err.message : String(err)}`);
        setHistory([...history, rec]);
      }
      setSession((s) => [...s, rec]);
      setPicked(choice);
      if (spot) setPickSpot(spot);
      setTotal((t) => t + 1);
      if (correct) {
        setScore((s) => s + 1);
        setStreak((s) => {
          setBest((b) => Math.max(b, s + 1));
          return s + 1;
        });
      } else setStreak(0);
      if (spot) {
        // Let them hear what they picked.
        try {
          engine.pluck(tuning[spot[0]] + spot[1], spot[0]);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        }
      } else hear(question, true);
    },
    [question, picked, shownAt, key, history, onError, hear, tuning],
  );

  const setKind = useCallback(
    (k: QuizKind) => {
      setKindState(k);
      next(k, maxFret, running);
    },
    [next, maxFret, running],
  );

  const setMaxFret = useCallback(
    (mf: number) => {
      setMaxFretState(mf);
      next(kind, mf, running);
    },
    [next, kind, running],
  );

  const resetScore = useCallback(() => {
    setScore(0);
    setTotal(0);
    setStreak(0);
    setBest(0);
  }, []);

  const clear = useCallback(() => {
    try {
      clearHistory();
      setHistory([]);
      setSession([]);
      setLastSession([]);
    } catch (err) {
      onError(`The quiz history couldn't be cleared: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [onError]);

  return {
    pickSpot, pickNote: (s: number, f: number) => {
      if (!question || question.kind !== "findnote" || picked !== null) return;
      answer((tuning[s] + f) % 12, null, [s, f]);
    },
    kind, setKind, maxFret, setMaxFret, focusWeak, setFocusWeak, running, question, picked, score, total, streak, best,
    session, lastSession, history, weak, secs: running ? (picked !== null ? (session[session.length - 1]?.ms ?? 0) / 1000 : (now - shownAt) / 1000) : 0,
    start, stop, answer, next: () => next(), hear: () => question && hear(question, picked !== null), resetScore, clear,
    bestEver: bestStreak(history),
  };
}

export type Quiz = ReturnType<typeof useQuiz>;
