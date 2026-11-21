import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/16/solid";
import { ConfirmModal } from "../ConfirmModal";
import { ErrorModal } from "../ErrorModal";
import { QuizMain, QuizReport, QuizSide, WeakCard, answerKeyIndex } from "./QuizPanels";
import { useQuiz } from "./useQuiz";
import { useVoice } from "./useVoice";
import { BlendLegend, DegreeCircle, DegreeStrip, StepsLine, TonalityRow, ToneChips } from "./Aids";
import { spokenAnswerFor, spokenCommand, spokenDegreeName, spokenNoteName } from "../../lib/fretboard/spoken";
import { speak } from "../../lib/fretboard/voice";
import { QUIZ_KINDS } from "../../lib/fretboard/quiz";
import { ChordBox } from "./ChordBox";
import { FretSettingsModal } from "./FretSettingsModal";
import { Neck } from "./Neck";
import { PlayBar } from "./PlayBar";
import { PracticePanel } from "./PracticePanel";
import { SpeedPanel, type SpeedRun } from "./SpeedPanel";
import { ProgressionPanel } from "./ProgressionPanel";
import { useSoundFont } from "./useSoundFont";
import { engine } from "../../lib/fretboard/audio";
import { buildChordSequence, buildSequence, orderSteps, type Step } from "../../lib/fretboard/playback";
import { buildPlan, practiceEvents, singleRun, type Plan } from "../../lib/fretboard/practice";
import { EXERCISES, appendSpeedLog, loadSpeedLog, mmss, phases as speedPhases, totalSecs, type SpeedLog } from "../../lib/fretboard/speed";
import { buildProgression, chordRoot, progVoicings, suitedProgression, type ProgChord } from "../../lib/fretboard/progression";
import { colourNotes, scaleInfo } from "../../lib/fretboard/scaleInfo";
import { useFretSettings } from "../../lib/fretboard/settings";
import {
  CHORDS,
  KEYS,
  SCALES,
  INSTRUMENT_TYPES,
  instrumentType,
  arpeggioPositions,
  chordVoicings,
  diatonicChords,
  differenceFromNatural,
  intervalName,
  intervalShort,
  plainName,
  roman,
  scalePositions,
  spell,
  tonality,
  voicingMinFret,
  voicingNotes,
  type Voicing,
} from "../../lib/fretboard/theory";
import { useProgression } from "../../lib/fretboard/useProgression";
import { computeView, type Page } from "../../lib/fretboard/view";
import { isTrainerSessionStarted, logTrainerActivity, setTrainerBusy, startTrainerSession, touchTrainer } from "../../lib/trainerSession";
import { byItem, stringPicks, summarize } from "../../lib/fretboard/history";

const PAGES: { id: Page; label: string }[] = [
  { id: "scales", label: "Scales" },
  { id: "arpeggios", label: "Arpeggios" },
  { id: "chords", label: "Chords" },
  { id: "progressions", label: "Progressions" },
  { id: "practice", label: "Practice" },
  { id: "speed", label: "Speed" },
  { id: "quiz", label: "Quiz" },
];

function groupBy<T extends { group: string }>(list: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const arr = map.get(item.group) ?? [];
    arr.push(item);
    map.set(item.group, arr);
  }
  return [...map.entries()];
}

const SCALE_GROUPS = groupBy(SCALES);
const CHORD_GROUPS = groupBy(CHORDS);

interface Props {
  onBack: () => void;
  onHelp: () => void;
  /** Go back to the session view and open the Open Session form to log what was practised. */
  onSaveSession: (leave?: boolean) => void;
}

export function FretboardView({ onBack, onHelp, onSaveSession }: Props) {
  const [page, setPage] = useState<Page>("scales");
  const [key, setKey] = useState(0);
  const [scaleIdx, setScaleIdx] = useState(0);
  const [chordIdx, setChordIdx] = useState(0);
  const [posIdx, setPosIdx] = useState(0);
  const [focus, setFocus] = useState(false);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playingNote, setPlayingNote] = useState<string | null>(null);
  const [markerIdx, setMarkerIdx] = useState<number | null>(null);
  const [selectedChord, setSelectedChord] = useState<number | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [practiceMarker, setPracticeMarker] = useState<number | null>(null);
  const [announceIdx, setAnnounceIdx] = useState<number | null>(null);
  const [burstPass, setBurstPass] = useState(false);
  const markerBase = useRef(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [speedRun, setSpeedRun] = useState<SpeedRun | null>(null);
  const [speedNow, setSpeedNow] = useState(() => Date.now());
  const [speedLogs, setSpeedLogs] = useState<SpeedLog[]>(() => loadSpeedLog().logs);
  const [speedNotice, setSpeedNotice] = useState<string | null>(null);
  const speedRunRef = useRef<SpeedRun | null>(null);
  const bpmOverride = useRef<number | null>(null);
  const loopsSinceRaise = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, update, error: settingsError, clearError } = useFretSettings();
  const prog = useProgression();
  const showError = useCallback((m: string) => setError(m), []);
  const font = useSoundFont(settings, update, showError);

  const instType = instrumentType(settings.stringed);
  const tuning = (instType.tunings[settings.tuning] ?? instType.tunings[0]).strings;
  // CAGED and the chord relay are built for a standard six-string guitar.
  const standardGuitar = settings.stringed === "guitar6" && settings.tuning === 0;
  const labelMode = settings.labels;
  const scale = SCALES[scaleIdx];
  const chord = CHORDS[chordIdx];
  const pauseVoice = useRef<(ms: number) => void>(() => {});
  const quiz = useQuiz({
    tuning, key, scaleIdx, pace: settings.pace, scaleName: scale.name, keyName: KEYS[key], onError: showError, onHighlight: setPlayingNote,
    onSound: (ms) => pauseVoice.current(ms),
  });
  // Spoken quiz answers: "next" and "again" are commands; anything else is matched to the answers.
  const voice = useVoice({
    want: settings.voice && page === "quiz" && quiz.running && quiz.kind === "note",
    kind: quiz.kind,
    input: settings.micName,
    onHeard: (guesses, onsetAt) => {
      const stopQuiz = () => stopQuizRef.current();
      const cmd = spokenCommand(guesses);
      if (cmd === "stop") stopQuiz();
      else if (cmd === "next") {
        if (quiz.picked !== null) quiz.next();
      } else if (cmd === "again") quiz.hear();
      else if (quiz.question && quiz.picked === null) {
        const i = spokenAnswerFor(quiz.kind, quiz.question.choices, guesses, quiz.question.answer);
        if (i !== null) quiz.answer(i, onsetAt);
      }
    },
  });
  pauseVoice.current = voice.pauseFor;
  // Stopping a quiz logs its results in the Open Session notes and opens the save form.
  function stopQuiz() {
    const answered = quiz.session.length > 0;
    if (answered) {
      // The results go into the Open Session's notes.
      const sum = summarize(quiz.session);
      const kindName = QUIZ_KINDS.find((k) => k.id === quiz.kind)?.name ?? "Quiz";
      const slow = byItem(quiz.session)[0];
      const strings = quiz.kind === "findnote" ? stringPicks(quiz.session, tuning.length).filter((e) => e.picks > 0) : [];
      logTrainerActivity(
        `Theory Training — Quiz result: ${kindName}: ${sum.right} of ${sum.answered} right (${Math.round((sum.right * 100) / sum.answered)}%), average ${(sum.avgMs / 1000).toFixed(1)} s, fastest right ${(sum.fastestMs / 1000).toFixed(1)} s` +
          (slow ? `; slowest: ${slow.item} (${(slow.avgMs / 1000).toFixed(1)} s)` : "") +
          (strings.length ? `; strings picked: ${strings.map((e) => `${plainName(tuning[e.string])} ${e.picks}`).join(", ")}` : ""),
      );
    }
    quiz.stop();
    onSaveSession();
  }
  // Tell the session view when the trainer is busy on its own, or being used, so its timer knows.
  useEffect(() => {
    setTrainerBusy(playing || quiz.running || speedRun !== null);
  }, [playing, quiz.running, speedRun]);
  useEffect(() => {
    const touch = () => touchTrainer();
    window.addEventListener("pointerdown", touch, { capture: true });
    window.addEventListener("keydown", touch, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", touch, { capture: true });
      window.removeEventListener("keydown", touch, { capture: true });
      setTrainerBusy(false);
    };
  }, []);
  const stopQuizRef = useRef(stopQuiz);
  stopQuizRef.current = stopQuiz;
  // When answering out loud, the next question follows three seconds after each answer, until "stop" is heard.
  useEffect(() => {
    if (!(settings.voice && page === "quiz" && quiz.running && quiz.kind === "note" && quiz.picked !== null)) return;
    const id = window.setTimeout(() => quiz.next(), 3000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.voice, page, quiz.running, quiz.picked, quiz.question]);
  const scaleLike = page === "scales" || page === "progressions" || page === "practice" || page === "speed";

  const scalePos = useMemo(() => scalePositions(tuning, key, scale.tones), [tuning, key, scale]);
  const arpPos = useMemo(() => arpeggioPositions(tuning, key, chord.tones), [tuning, key, chord]);
  const voicings = useMemo(() => chordVoicings(tuning, key, chord.tones), [tuning, key, chord]);

  // The choices the Position/Shape select offers on the current page.
  const choices: string[] = useMemo(() => {
    if (scaleLike) return [...scalePos.map((p) => p.title), "Whole neck"];
    if (page === "arpeggios") return [...arpPos.map((p) => p.title), "Whole neck"];
    return voicings.map((v, i) => {
      const fr = voicingNotes(v).map((n) => n[1]);
      return `Shape ${i + 1} — bass on string ${tuning.length - v.bassString}, frets ${Math.min(...fr)}–${Math.max(...fr)}`;
    });
  }, [page, scaleLike, scalePos, arpPos, voicings]);
  const idx = Math.min(posIdx, Math.max(choices.length - 1, 0));

  // The progression under this page: the one on the Progressions page, or on the
  // Scales page one that suits the scale.
  const overlay = page !== "progressions" && page !== "practice" && page !== "speed" && settings.playOver;
  const progMode = page === "progressions" || overlay;
  const suited = useMemo(() => suitedProgression(scaleIdx), [scaleIdx]);
  const activeProg: ProgChord[] = page === "scales" && overlay && settings.suitScale ? suited : prog.chords;

  // The practice routine's steps for the current settings.
  const progItems = useMemo(() => {
    const voicingsNow = progVoicings({ tuning, key, chords: prog.chords, nearFret: 3 });
    return prog.chords.map((c, i) => ({
      root: chordRoot(key, c),
      chord: c.chord,
      beats: c.beats || settings.beatsPerChord,
      name: plainName(chordRoot(key, c)) + CHORDS[c.chord].symbol,
      voicing: voicingNotes(voicingsNow[i] ?? { frets: [], bassString: 0, score: 0 }),
    }));
  }, [tuning, key, prog.chords, settings.beatsPerChord]);
  const items = useMemo(() => progItems.map((p) => ({ ...p, voicing: p.voicing.length ? p.voicing : null })), [progItems]);
  const plan: Plan = useMemo(() => {
    if (page === "practice") return buildPlan(settings.practice, settings.notesPerBeat, tuning, standardGuitar, key, scale, idx, items);
    if (page !== "speed") return { steps: [], message: null };
    // The speed trainer's run: the chosen position, arpeggio, sequence or the progression's arpeggios.
    const pb = settings.notesPerBeat;
    const ex = settings.speed.exercise;
    if (ex === "scale") {
      return singleRun(tuning, `${KEYS[key]} ${scale.name} · position ${idx + 1}`, key, scale.tones, scalePos[idx]?.notes ?? [], pb);
    }
    if (ex === "arpeggio") {
      const ai = Math.min(idx, Math.max(arpPos.length - 1, 0));
      return singleRun(tuning, `${KEYS[key]}${chord.symbol} arpeggio · position ${ai + 1}`, key, chord.tones, arpPos[ai]?.notes ?? [], pb);
    }
    const routine = ex === "sequence" ? "sequences" : "changes";
    return buildPlan({ ...settings.practice, routine, changesScale: false, backing: true }, pb, tuning, standardGuitar, key, scale, idx, items);
  }, [page, settings.practice, settings.speed.exercise, settings.notesPerBeat, tuning, standardGuitar, key, scale, idx, items, scalePos, arpPos, chord]);
  const planned = page === "practice" || page === "speed";
  const stepIdx = planned ? (playing ? practiceMarker : page === "practice" ? selectedStep : null) : null;
  const practiceStep = stepIdx !== null ? plan.steps[stepIdx] : undefined;

  const curIdx = progMode ? (playing ? markerIdx : page === "progressions" ? selectedChord : null) : null;
  const chordNow = curIdx !== null ? activeProg[curIdx] : undefined;

  // The quiz question on the neck: the question's notes, with ? until answered (ear questions stay hidden).
  const quizQ = quiz.question;
  const quizByEar = quizQ ? QUIZ_KINDS.find((k) => k.id === quizQ.kind)?.byEar : false;
  const quizNotes = useMemo(() => {
    if (page !== "quiz" || !quizQ || !quiz.running) return undefined;
    if (quiz.picked !== null) return { notes: quizQ.notes, text: quizQ.reveal };
    if (quizByEar) return undefined;
    const pre = quizQ.kind === "interval" ? ["R", "?"] : quizQ.notes.map(() => "?");
    return { notes: quizQ.notes, text: pre };
  }, [page, quizQ, quiz.running, quiz.picked, quizByEar]);
  const quizFind = useMemo(
    () => (page === "quiz" && quizQ?.kind === "findnote" && quiz.running && quizQ.targetPc !== undefined ? { maxFret: quiz.maxFret, targetPc: quizQ.targetPc, pick: quiz.pickSpot } : undefined),
    [page, quizQ, quiz.running, quiz.maxFret, quiz.pickSpot],
  );
  const weakMarks = settings.showWeak && page !== "quiz" && quiz.history.length > 0 ? quiz.weak : null;

  const view = useMemo(
    () =>
      computeView({
        page, key, scaleIdx, chordIdx, idx, tuning, scalePos, arpPos, voicings, chordNow,
        overlay: overlay && playing, follow: settings.follow, focus: settings.focus, quizFind,
        hiddenDegrees: settings.hiddenDegrees, hiddenStrings: settings.hiddenStrings, ghosts: settings.ghosts,
        showPrev: settings.showPrev, showNext: settings.showNext, connect: settings.connect, connectStrings: settings.connectStrings,
        blendScale: settings.blendScale, blendRoot: settings.blendRoot, practiceStep, quizNotes, weak: weakMarks,
      }),
    [page, key, scaleIdx, chordIdx, idx, tuning, scalePos, arpPos, voicings, chordNow, overlay, playing, settings.follow, settings.focus, settings.hiddenDegrees, settings.hiddenStrings, settings.ghosts, settings.showPrev, settings.showNext, settings.connect, settings.connectStrings, settings.blendScale, settings.blendRoot, practiceStep, quizNotes, quizFind, weakMarks],
  );
  const voicing: Voicing | undefined = view.voicing;

  const colour = useMemo(() => colourNotes(scale.name, scale.tones), [scale]);
  const info = scaleInfo(scale.name);
  const diff = useMemo(() => differenceFromNatural(scale.tones), [scale]);
  const [keySevenths, setKeySevenths] = useState(false);
  const keyChords = useMemo(() => diatonicChords(scale.tones, keySevenths), [scale, keySevenths]);

  const title =
    page === "quiz" ? (QUIZ_KINDS.find((k) => k.id === quiz.kind)?.name ?? "Quiz") : planned && practiceStep ? practiceStep.title : scaleLike ? `${KEYS[key]} ${scale.name}` : page === "arpeggios" ? `${KEYS[key]} ${chord.name} arpeggio` : `${KEYS[key]} ${chord.name}`;
  const posShort = (choices[idx] ?? "").split(" — ")[0];
  const pageLabel = PAGES.find((p) => p.id === page)?.label;

  function hear(action: () => void, detail?: string) {
    try {
      action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    logTrainerActivity(`Theory Training — ${pageLabel}: ${title}, ${posShort}${detail ? ` (${detail})` : ""}`);
  }

  function labelFor(m: { label: string; semis: number }): string {
    switch (labelMode) {
      case "degree": return m.label;
      case "note": return spell(view.root, m.semis, m.label);
      case "both": return `${m.label} ${spell(view.root, m.semis, m.label)}`;
      case "interval": return intervalShort(m.label);
      default: return "";
    }
  }

  function strumVoicing(v: Voicing) {
    engine.strumNow(voicingNotes(v).map(([s, f]) => ({ midi: tuning[s] + f, string: s })));
  }

  function playKeyChord(degreeIdx: number, chordI: number) {
    const c = CHORDS[chordI];
    const root = (key + scale.tones[degreeIdx].semis) % 12;
    const v = chordVoicings(tuning, root, c.tones)[0];
    if (!v) throw new Error(`No playable shape found for ${c.name}.`);
    strumVoicing(v);
  }

  function hearProgChord(i: number) {
    const c = prog.chords[i];
    if (!c) return;
    const v = progVoicings({ tuning, key, chords: [c], nearFret: 3 })[0];
    if (!v) {
      setError(`No playable shape found for ${plainName(chordRoot(key, c))}${CHORDS[c.chord].symbol}.`);
      return;
    }
    hear(() => strumVoicing(v), `chord ${plainName(chordRoot(key, c))}${CHORDS[c.chord].symbol}`);
  }

  function openChord(degreeIdx: number, chordI: number) {
    setKey((key + scale.tones[degreeIdx].semis) % 12);
    setChordIdx(chordI);
    setPosIdx(0);
    setPage("chords");
  }

  function goPage(p: Page) {
    if (p === page) return;
    if (speedRunRef.current) finishSpeed(false, false);
    if (quiz.running) quiz.stop();
    if (playing) stopPlayback();
    setPage(p);
    setPosIdx(0);
    // Changing what is being studied ends the session: the Open Session save form opens.
    onSaveSession();
  }

  // Leaving Theory Training ends the session too.
  function leave() {
    if (!isTrainerSessionStarted()) {
      onBack();
      return;
    }
    if (speedRunRef.current) finishSpeed(false, false);
    if (quiz.running) quiz.stop();
    if (playing) stopPlayback();
    onSaveSession(true);
  }

  function stepsOf(notes: [number, number][]): Step[] {
    return notes.map(([s, f]) => ({ midi: tuning[s] + f, string: s, fret: f }));
  }

  // The fret the hand is around, so progression shapes stay close to it.
  function anchorFret(): number {
    if (page === "chords" && voicings[idx]) return voicingMinFret(voicings[idx]);
    const notes = scaleLike ? scalePos[idx]?.notes : arpPos[idx]?.notes;
    return notes?.length ? Math.min(...notes.map((n) => n[1])) : 3;
  }

  // The tempo to play at: a speed-trainer round sets its own.
  const curBpm = () => bpmOverride.current ?? settings.bpm;

  // What Play should sound for the current page and selection.
  function buildCurrent(countInBars: number) {
    if (progMode) {
      if (activeProg.length === 0) throw new Error("The progression has no chords. Choose a preset or add some chords first.");
      const voicingsNow = progVoicings({ tuning, key, chords: activeProg, nearFret: anchorFret() });
      return buildProgression(
        {
          tuning, key, chords: activeProg, defaultBeats: settings.beatsPerChord, bpm: curBpm(), notesPerBeat: settings.notesPerBeat,
          comp: settings.comp, drums: settings.drums, click: settings.click, countInBars,
        },
        voicingsNow,
      );
    }
    if (planned) {
      if (plan.steps.length === 0) throw new Error(plan.message ?? "Nothing to practise with these settings.");
      // A speed round always clicks every beat.
      const pset = page === "speed" ? { ...settings.practice, clicks: "all" as const, routine: settings.speed.exercise === "sequence" ? ("sequences" as const) : settings.speed.exercise === "changes" ? ("changes" as const) : ("ladder" as const) } : settings.practice;
      return withCountIn(practiceEvents(plan, pset, settings.notesPerBeat, tuning, 60 / curBpm()), countInBars);
    }
    if (page === "chords") {
      if (!voicing) throw new Error("There is no chord shape to play.");
      return buildChordSequence({ notes: stepsOf(voicingNotes(voicing)), bpm: curBpm(), notesPerBeat: settings.notesPerBeat, countInBars, click: settings.click });
    }
    const notes = page === "scales" || page === "arpeggios" ? view.runNotes : scalePos[idx]?.notes;
    if (!notes?.length) throw new Error("There are no notes to play in this position.");
    return buildSequence({ steps: orderSteps(stepsOf(notes), settings.direction), bpm: curBpm(), notesPerBeat: settings.notesPerBeat, countInBars, click: settings.click });
  }

  // Put count-in clicks in front of a built sequence; the count-in plays once, then playback loops from after it.
  function withCountIn(built: { events: import("../../lib/fretboard/audio").SeqEvent[]; length: number }, bars: number) {
    const beat = 60 / curBpm();
    const lead = bars * 4 * beat;
    const events = [
      ...Array.from({ length: bars * 4 }, (_, i) => ({ time: i * beat, kind: { type: "click" as const, accent: i % 4 === 0 } })),
      ...built.events.map((e) => ({ ...e, time: e.time + lead })),
    ];
    return { events, length: built.length + lead, loopFrom: lead };
  }

  // The scale's root chord held softly under scale runs: root, 5th and the scale's own 3rd.
  function droneNotes(): number[] | null {
    const droneOk =
      page === "scales" ||
      (page === "practice" && ["ladder", "sequences"].includes(settings.practice.routine)) ||
      (page === "speed" && settings.speed.exercise === "scale");
    if (!droneOk || !settings.drone || progMode) return null;
    const root = 36 + key;
    const third = scale.tones.find((t) => t.label === "3" || t.label === "b3");
    return [root, root + 7, ...(third ? [root + third.semis] : [])];
  }

  const stopPlayback = useCallback(() => {
    engine.stop();
    engine.drone(null);
    setPlaying(false);
    setMarkerIdx(null);
    setPracticeMarker(null);
    setAnnounceIdx(null);
    setBurstPass(false);
  }, []);

  function startPlayback(countInBars: number, log = true) {
    if (log) {
      markerBase.current = 0;
      loopsSinceRaise.current = 0;
      startTrainerSession();
    }
    try {
      const built = buildCurrent(countInBars);
      setPlaying(true);
      engine.drone(droneNotes());
      engine.play({
        events: built.events,
        length: built.length,
        loopFrom: built.loopFrom,
        loop: settings.loop || page === "speed",
        onHighlight: setPlayingNote,
        onMarker: (code) => {
          if (code.startsWith("p:")) {
            setPracticeMarker(parseInt(code.slice(2)) + markerBase.current);
            setBurstPass(false);
          } else if (code.startsWith("a:")) setAnnounceIdx(parseInt(code.slice(2)) + markerBase.current);
          else if (code.startsWith("b:")) setBurstPass(true);
          else if (code.startsWith("n:")) setBurstPass(false);
          else setMarkerIdx(parseInt(code));
        },
        onLoop: () => {
          // The speed trainer: raise the tempo every few loops, up to the limit.
          const cur = settingsRef.current;
          const pr = cur.practice;
          if (page !== "practice" || !pr.speedUp) return;
          loopsSinceRaise.current += 1;
          if (loopsSinceRaise.current >= pr.speedEvery && cur.bpm < pr.speedMax) {
            loopsSinceRaise.current = 0;
            update({ bpm: Math.min(pr.speedMax, cur.bpm + pr.speedStep) });
          }
        },
        onEnd: () => {
          engine.drone(null);
          setPlaying(false);
          setMarkerIdx(null);
          setPracticeMarker(null);
          setAnnounceIdx(null);
          setBurstPass(false);
        },
      });
    } catch (err) {
      engine.stop();
      setPlaying(false);
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (log) {
      const over = progMode ? ` over ${prog.name || "a progression"}` : "";
      logTrainerActivity(`Theory Training — ${pageLabel}: ${title}, ${posShort} at ${settings.bpm} bpm${over}`);
    }
  }

  function togglePlayback() {
    if (page === "speed") {
      if (speedRunRef.current) finishSpeed(false);
      else startSpeed();
      return;
    }
    if (engine.playing) {
      // Stop ends the session: the Open Session save form opens.
      stopPlayback();
      onSaveSession();
    } else startPlayback(settings.countIn);
  }

  // ── Speed trainer sessions ──
  function speedDetail(): string {
    const ex = settings.speed.exercise;
    if (ex === "scale") return `${KEYS[key]} ${scale.name} · position ${idx + 1}`;
    if (ex === "arpeggio") return `${KEYS[key]}${chord.symbol} arpeggio · position ${idx + 1}`;
    if (ex === "sequence") return `${KEYS[key]} ${scale.name} ${settings.practice.pattern} · position ${idx + 1}`;
    return `${prog.name || "your progression"} in ${KEYS[key]}`;
  }

  function startSpeed() {
    startTrainerSession();
    if (plan.steps.length === 0) {
      setError(plan.message ?? "Nothing to play with these settings.");
      return;
    }
    const setup = settings.speed;
    const detail = settings.practice.burst > 0 ? `${speedDetail()} · bursts of ${settings.practice.burst}` : speedDetail();
    const run: SpeedRun = {
      phases: speedPhases(setup),
      startedAt: Date.now(),
      phase: -1,
      topBpm: setup.startBpm,
      startBpm: setup.startBpm,
      exercise: setup.exercise,
      detail,
      when: Math.floor(Date.now() / 1000),
    };
    speedRunRef.current = run;
    setSpeedRun(run);
    setSpeedNotice(null);
    setSpeedNow(run.startedAt);
    const name = EXERCISES.find((e) => e.id === setup.exercise)?.name;
    logTrainerActivity(`Theory Training — Speed trainer: ${name}, ${detail}, ${setup.startBpm} to ${setup.targetBpm} bpm over ${setup.minutes} min`);
    tickSpeed();
  }

  // Move the session along: start each round at its tempo, rest between rounds, finish at the end.
  function tickSpeed() {
    const run = speedRunRef.current;
    if (!run) return;
    const now = Date.now();
    setSpeedNow(now);
    const elapsed = (now - run.startedAt) / 1000;
    if (elapsed >= totalSecs(run.phases)) {
      finishSpeed(true);
      return;
    }
    let t = 0;
    let idx = 0;
    for (let i = 0; i < run.phases.length; i++) {
      if (elapsed < t + run.phases[i].secs) {
        idx = i;
        break;
      }
      t += run.phases[i].secs;
    }
    if (idx === run.phase) return;
    const first = run.phase === -1;
    run.phase = idx;
    const ph = run.phases[idx];
    if (ph.kind === "work") {
      run.topBpm = Math.max(run.topBpm, ph.bpm);
      bpmOverride.current = ph.bpm;
      update({ bpm: ph.bpm });
      startPlayback(first ? settings.countIn : Math.min(settings.countIn, 1), false);
    } else {
      stopPlayback();
    }
    setSpeedRun({ ...run });
  }

  // End the session (finished or stopped early) and log it.
  function finishSpeed(finished: boolean, prompt = true) {
    const run = speedRunRef.current;
    if (!run) return;
    speedRunRef.current = null;
    bpmOverride.current = null;
    setSpeedRun(null);
    stopPlayback();
    const total = totalSecs(run.phases);
    const secs = Math.round(Math.min(total, Math.max(0, (Date.now() - run.startedAt) / 1000)));
    const name = EXERCISES.find((e) => e.id === run.exercise)?.name ?? "";
    const log: SpeedLog = { when: run.when, exercise: name, detail: run.detail, startBpm: Math.round(run.startBpm), topBpm: Math.round(run.topBpm), secs, finished };
    try {
      setSpeedLogs(appendSpeedLog(log));
    } catch (err) {
      setError(`This speed session couldn't be saved: ${err instanceof Error ? err.message : String(err)}`);
    }
    setSpeedNotice(`Session saved: ${name} — ${log.startBpm} to ${log.topBpm} bpm in ${mmss(secs)}`);
    logTrainerActivity(`Theory Training — Speed session result: ${name}, ${log.startBpm} to ${log.topBpm} bpm in ${mmss(secs)}${finished ? "" : " (stopped early)"}`);
    if (prompt) onSaveSession();
  }
  const finishSpeedRef = useRef(finishSpeed);
  finishSpeedRef.current = finishSpeed;
  const tickSpeedRef = useRef(tickSpeed);
  tickSpeedRef.current = tickSpeed;
  const running = speedRun !== null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => tickSpeedRef.current(), 200);
    return () => window.clearInterval(id);
  }, [running]);
  useEffect(() => () => finishSpeedRef.current(false, false), []);

  // Click a step: show it and play it once.
  function previewStep(i: number) {
    const st = plan.steps[i];
    if (!st) return;
    stopPlayback();
    setSelectedStep(i);
    try {
      const built = practiceEvents({ steps: [st], message: null }, { ...settings.practice, burst: 0, clicks: "off" }, settings.notesPerBeat, tuning, 60 / settings.bpm);
      markerBase.current = i;
      setPlaying(true);
      engine.play({
        events: built.events,
        length: built.length,
        loop: false,
        onHighlight: setPlayingNote,
        onMarker: (code) => {
          if (code.startsWith("p:")) setPracticeMarker(parseInt(code.slice(2)) + i);
        },
        onEnd: () => {
          setPlaying(false);
          setPracticeMarker(null);
        },
      });
    } catch (err) {
      engine.stop();
      setPlaying(false);
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    logTrainerActivity(`Theory Training — Practice: ${settings.practice.routine === "metronome" ? "Time keeping" : st.title}`);
  }

  // Follow changes while playing: restart on the new notes or tempo without another count-in.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const playingRef = useRef(false);
  playingRef.current = playing;
  const restartKey = [
    page, key, scaleIdx, chordIdx, idx, settings.bpm, settings.notesPerBeat, settings.direction, settings.loop, settings.click, settings.drone,
    settings.comp, settings.drums, settings.beatsPerChord, settings.playOver, settings.suitScale, JSON.stringify(activeProg), JSON.stringify(settings.practice), settings.tuning, settings.stringed,
  ].join("|");
  const lastKey = useRef(restartKey);
  useEffect(() => {
    if (lastKey.current === restartKey) return;
    lastKey.current = restartKey;
    if (playingRef.current && !speedRunRef.current) startPlayback(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartKey]);

  useEffect(() => {
    engine.onProblem = (m) => setError(m);
    return () => {
      engine.onProblem = null;
      engine.stop();
      engine.drone(null);
    };
  }, []);

  // Space plays and stops; Left/Right step through positions or shapes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.type === "keydown" && e.key === "F1") {
        e.preventDefault();
        onHelp();
        return;
      }
      if (page === "quiz") {
        if (e.type !== "keydown" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        if (quiz.running && quiz.question) {
          if (quiz.picked !== null) {
            if (e.key === "Enter" || e.code === "Space") {
              e.preventDefault();
              quiz.next();
            }
          } else {
            const n = answerKeyIndex(e.key);
            if (quiz.question.kind !== "findnote" && n >= 0 && n < quiz.question.choices.length) quiz.answer(n);
          }
        }
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (e.type === "keydown" && !e.repeat) togglePlayback();
      } else if (e.type === "keydown" && (e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) setFocus((f) => !f);
      else if (e.type === "keydown" && e.key === "Escape" && focus) setFocus(false);
      else if (e.type === "keydown" && e.key === "ArrowRight") setPosIdx(Math.min(idx + 1, choices.length - 1));
      else if (e.type === "keydown" && e.key === "ArrowLeft") setPosIdx(Math.max(idx - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const theme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  function stepPosition(delta: number) {
    setPosIdx(Math.max(0, Math.min(idx + delta, choices.length - 1)));
  }

  // What the current note is called, when call-outs are on.
  const callout = useMemo(() => {
    const mode = settings.practice.callouts;
    if (page !== "practice" || mode === "off" || !playing || !playingNote) return "";
    const m = view.marks.find((x) => `${x.string}:${x.fret}` === playingNote);
    if (!m) return "";
    if (mode === "note") return spell(view.root, m.semis, m.label);
    if (mode === "interval") return intervalName(m.label) || m.label;
    return m.label === "1" ? "Root" : m.label;
  }, [page, settings.practice.callouts, playing, playingNote, view.marks, view.root]);
  const announceKey = announceIdx !== null ? plan.steps[announceIdx] : undefined;

  // Say the call-outs and the next key aloud when asked to.
  const speakOn = page === "practice" && settings.practice.speak;
  const sayIt = useCallback(
    (text: string) => {
      try {
        speak(text, settingsRef.current.voiceRate, settingsRef.current.voiceName);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        update({ practice: { ...settingsRef.current.practice, speak: false } });
      }
    },
    [update],
  );
  useEffect(() => {
    if (!speakOn || !callout || !playingNote) return;
    const m = view.marks.find((x) => `${x.string}:${x.fret}` === playingNote);
    if (!m) return;
    const mode = settings.practice.callouts;
    sayIt(mode === "note" ? spokenNoteName(spell(view.root, m.semis, m.label)) : mode === "interval" ? callout : spokenDegreeName(m.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingNote]);
  useEffect(() => {
    if (!speakOn || !announceKey || settings.practice.routine !== "circle") return;
    sayIt(`${spokenNoteName(KEYS[announceKey.root])} ${tonality(scale.tones) === "Minor" ? "minor" : "major"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announceIdx]);

  // The chord sounding now, as half steps above the neck's root; and the note that just played.
  const chordSemisNow = view.nowChord ? CHORDS[view.nowChord.chord].tones.map((t) => (((view.nowChord!.root + t.semis - view.root) % 12) + 12) % 12) : [];
  const litSemis = (() => {
    if (!playingNote) return null;
    const [s, f] = playingNote.split(":").map(Number);
    return ((((tuning[s] + f - view.root) % 12) + 12) % 12) as number;
  })();

  /** Play a note by its half steps above a root, in a comfortable octave. */
  function hearSemis(root: number, semis: number) {
    const midi = 48 + (((root + semis) % 12) + 12) % 12 + (semis >= 12 ? 12 : 0);
    for (let s = 5; s >= 0; s--) {
      const f = midi - tuning[s];
      if (f >= 0 && f <= 12) {
        engine.pluck(midi, s);
        return;
      }
    }
    throw new Error("That note is outside the range of the neck in this tuning.");
  }

  // A notice that isn't an error (the sound output changed and was reconnected).
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => {
      const wasPlaying = engine.playing || speedRunRef.current !== null;
      if (speedRunRef.current) finishSpeed(false, false);
      stopPlayback();
      void engine
        .reset()
        .then(() => {
          font.reload();
          setNotice(`The sound output changed, so the trainer reconnected.${wasPlaying ? " Press Play to carry on." : ""}`);
        })
        .catch((err) => setError(`The sound output changed but could not be reconnected: ${err instanceof Error ? err.message : String(err)}`));
    };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A SoundFont dropped on the window is added to the list.
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    const sf = files.find((f) => /\.sf2$/i.test(f.name));
    if (!sf) {
      setError(`Only .sf2 SoundFont files can be added by dropping them on the window (you dropped ${files[0].name}).`);
      return;
    }
    void font.add(sf);
  }
  const chordNotes = chord.tones.map((t) => ({
    note: spell(key, t.semis, t.label),
    label: t.label,
    interval: intervalName(t.label),
  }));

  return (
    <div className="fretboard-view" data-testid="fretboard-view" data-theme={theme} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {notice && (
        <p className="fb-notice" role="status">
          {notice} <button className="btn-ghost" onClick={() => setNotice(null)}>OK</button>
        </p>
      )}
      {focus && (
        <div className="fb-focusbar" role="toolbar" aria-label="Focus mode">
          <button className="btn-secondary" onClick={() => setFocus(false)}>Leave focus (Esc)</button>
          <button className={playing ? "btn-secondary" : "btn-primary"} onClick={togglePlayback}>{playing ? "Stop" : "Play"}</button>
          <label className="fb-playbar__bpm">
            <input type="number" min={30} max={300} aria-label="Focus tempo (bpm)" value={settings.bpm} onChange={(e) => update({ bpm: Math.max(30, Math.min(300, parseInt(e.target.value) || settings.bpm)) })} />
            bpm
          </label>
          {page !== "progressions" && (
            <>
              <button className="btn-ghost" onClick={() => stepPosition(-1)} aria-label="Previous position">◀</button>
              <button className="btn-ghost" onClick={() => stepPosition(1)} aria-label="Next position">▶</button>
            </>
          )}
          {page === "progressions" && (
            <label className="fb-playbar__field">
              Follow the chords
              <select aria-label="Focus follow" value={settings.follow} onChange={(e) => update({ follow: e.target.value as typeof settings.follow })}>
                <option value="off">Off</option>
                <option value="chordscale">Scale</option>
                <option value="arpeggio">Arpeggio</option>
              </select>
            </label>
          )}
          <span className="fb-focusbar__label">FOCUS MODE</span>
        </div>
      )}
      {!focus && (
      <header className="browse-header">
        <button className="btn-ghost" onClick={leave} title="Back to session">
          <ArrowLeftIcon className="icon-sm" /> Back
        </button>
        <h1 className="browse-title">Theory Training</h1>
        <button className="btn-ghost" onClick={onHelp} title="Every feature and how to use it (F1)">
          Help
        </button>
        <button className="btn-secondary fb-focus-btn" onClick={() => setFocus(true)} title="Hide everything but the neck and play controls (F)">
          Focus
        </button>
      </header>
      )}

      {!focus && (
      <div className="browse-tabs">
        {PAGES.map((p) => (
          <button key={p.id} className={`browse-tab fb-tab ${page === p.id ? "active" : ""}`} onClick={() => goPage(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      )}

      <div className="fretboard-body">
        <div className="fretboard-main">
          {!focus && (
          <>
          <label className="fb-instrument">
            Instrument
            <select
              aria-label="Instrument"
              value={settings.stringed}
              onChange={(e) => {
                if (playing) stopPlayback();
                update({ stringed: e.target.value, tuning: 0, hiddenStrings: [], connectStrings: [] });
                setPosIdx(0);
              }}
            >
              {INSTRUMENT_TYPES.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </label>
          <div className="fretboard-keys" role="group" aria-label="Key">
            {KEYS.map((k, i) => (
              <button key={k} className={`fb-key ${i === key ? "active" : ""}`} onClick={() => { setKey(i); setPosIdx(0); }}>
                {k}
              </button>
            ))}
          </div>
          </>
          )}

          {!focus && (
          <div className="fretboard-controls">
            {scaleLike || page === "quiz" ? (
              <label>
                Scale
                <select aria-label="Scale" value={scaleIdx} onChange={(e) => { setScaleIdx(parseInt(e.target.value)); setPosIdx(0); }}>
                  {SCALE_GROUPS.map(([group, list]) => (
                    <optgroup key={group} label={group}>
                      {list.map((s) => (
                        <option key={s.name} value={SCALES.indexOf(s)}>{s.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Chord type
                <select aria-label="Chord type" value={chordIdx} onChange={(e) => { setChordIdx(parseInt(e.target.value)); setPosIdx(0); }}>
                  {CHORD_GROUPS.map(([group, list]) => (
                    <optgroup key={group} label={group}>
                      {list.map((c) => (
                        <option key={c.name} value={CHORDS.indexOf(c)}>{c.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            {page !== "quiz" && (<>
            <div className="fb-neck-nav">
              <button className="btn-ghost" onClick={() => stepPosition(-1)} aria-label="Previous position" title="Previous position (Left arrow)">◀</button>
              <label>
                {page === "chords" ? "Shape" : "Position"}
                <select aria-label={page === "chords" ? "Shape" : "Position"} value={idx} onChange={(e) => setPosIdx(parseInt(e.target.value))}>
                  {choices.map((c, i) => (
                    <option key={i} value={i}>{c}</option>
                  ))}
                </select>
              </label>
              <button className="btn-ghost" onClick={() => stepPosition(1)} aria-label="Next position" title="Next position (Right arrow)">▶</button>
            </div>
            <label>
              Labels
              <select aria-label="Labels" value={labelMode} onChange={(e) => update({ labels: e.target.value as typeof settings.labels })}>
                <option value="degree">Degree (1, b3, 5)</option>
                <option value="note">Note name</option>
                <option value="both">Degree and note</option>
                <option value="interval">Interval (R, m3, P5)</option>
                <option value="none">None</option>
              </select>
            </label>
            </>)}
            {page === "chords" && voicing && (
              <div className="fretboard-actions">
                <button className="btn-secondary" onClick={() => hear(() => strumVoicing(voicing))}>Strum</button>
                <button className="btn-primary" onClick={togglePlayback}>{playing ? "Stop" : "Play"}</button>
              </div>
            )}
          </div>
          )}

          {!focus && page !== "chords" && (
            <div className="fretboard-controls fb-neck-controls">
              <span className="fb-settings__label" title="Show the whole position below and/or above this one, a little faded">Also show</span>
              <button className={`fb-chip fb-chip--prev ${settings.showPrev ? "fb-chip--on" : ""}`} aria-label="Show previous position" aria-pressed={settings.showPrev} onClick={() => update({ showPrev: !settings.showPrev })}>
                ◀ Previous
              </button>
              <button className={`fb-chip fb-chip--next ${settings.showNext ? "fb-chip--on" : ""}`} aria-label="Show next position" aria-pressed={settings.showNext} onClick={() => update({ showNext: !settings.showNext })}>
                Next ▶
              </button>
              {page === "scales" && (
                <>
                  <label>
                    Connect to
                    <select aria-label="Connect to" value={settings.connect === idx + 1 ? 0 : settings.connect} onChange={(e) => update({ connect: parseInt(e.target.value) })}>
                      <option value={0}>Nothing</option>
                      {scalePos.map((_, i) => (i === idx ? null : <option key={i} value={i + 1}>Position {i + 1}</option>))}
                    </select>
                  </label>
                  {settings.connect > 0 && settings.connect !== idx + 1 && (
                    <div className="fb-chip-row" role="group" aria-label="Connect along">
                      {tuning.map((open, s) => {
                        const on = settings.connectStrings.includes(s);
                        return (
                          <button
                            key={s}
                            className={`fb-chip ${on ? "fb-chip--on" : ""}`}
                            aria-label={`Connect along string ${s + 1}`}
                            aria-pressed={on}
                            onClick={() => update({ connectStrings: on ? settings.connectStrings.filter((x) => x !== s) : [...settings.connectStrings, s] })}
                          >
                            {plainName(open)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <label>
                    Blend with
                    <select aria-label="Blend with" value={settings.blendScale} onChange={(e) => update({ blendScale: parseInt(e.target.value) })}>
                      <option value={-1}>None</option>
                      {SCALE_GROUPS.map(([group, list]) => (
                        <optgroup key={group} label={group}>
                          {list.map((sc) => (
                            <option key={sc.name} value={SCALES.indexOf(sc)}>{sc.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  {settings.blendScale >= 0 && (
                    <label>
                      Blend root
                      <select aria-label="Blend root" value={settings.blendRoot} onChange={(e) => update({ blendRoot: parseInt(e.target.value) })}>
                        {KEYS.map((_, semis) => (
                          <option key={semis} value={semis}>{plainName(key + semis)}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          {!focus && page === "speed" && (
            <SpeedPanel
              setup={settings.speed}
              onSetup={(patch) => update({ speed: { ...settings.speed, ...patch } })}
              burst={settings.practice.burst}
              onBurst={(n) => update({ practice: { ...settings.practice, burst: n } })}
              burstMix={settings.practice.burstMix}
              onBurstMix={(m) => update({ practice: { ...settings.practice, burstMix: m } })}
              chordIdx={chordIdx}
              onChord={setChordIdx}
              pattern={settings.practice.pattern}
              onPattern={(p) => update({ practice: { ...settings.practice, pattern: p } })}
              detail={speedDetail()}
              run={speedRun}
              nowMs={speedNow}
              logs={speedLogs}
              onStart={startSpeed}
              onStop={() => finishSpeed(false)}
              notice={speedNotice}
            />
          )}

          {!focus && page === "practice" && (
            <PracticePanel
              set={settings.practice}
              onChange={(patch) => update({ practice: { ...settings.practice, ...patch } })}
              plan={plan}
              selected={selectedStep}
              playingStep={playing ? practiceMarker : null}
              onStep={previewStep}
              standardTuning={standardGuitar}
            />
          )}

          {!focus && page === "progressions" && (
            <ProgressionPanel
              prog={prog}
              keyIdx={key}
              scaleIdx={scaleIdx}
              onScale={(i) => { setScaleIdx(i); setPosIdx(0); }}
              settings={settings}
              update={update}
              selected={selectedChord}
              onSelect={setSelectedChord}
              playingIndex={playing ? markerIdx : null}
              onHear={hearProgChord}
            />
          )}

          <h2 className="fretboard-title">
            {title}
            {planned && playing && settings.practice.burst > 1 && (
              <span className={`fb-pass-badge ${burstPass ? "fb-pass-badge--burst" : ""}`}>{burstPass ? "SPEED BURSTS" : "Normal speed"}</span>
            )}
          </h2>
          {page === "quiz" && <QuizMain quiz={quiz} scaleLabel={`${KEYS[key]} ${scale.name}`} voice={voice} voiceOn={settings.voice && quiz.kind === "note"} tuning={tuning} onStop={stopQuiz} />}
          {page !== "quiz" && scaleLike && <TonalityRow tonality={tonality(scale.tones)} parent={diff.parent} changes={diff.changes} />}
          {page !== "quiz" && !scaleLike && (
            <p className="fretboard-tonality">
              {KEYS[key]}
              {chord.symbol} — {chord.group}
            </p>
          )}
          <p className="fb-prog-now">{view.nowLine ?? ""}</p>
          {page === "practice" && settings.practice.callouts !== "off" && <p className="fb-callout" aria-live="polite">{callout}</p>}
          {page === "practice" && settings.practice.routine === "circle" && playing && (
            <p className="fb-announce">{announceKey ? `Next key: ${KEYS[announceKey.root]}` : ""}</p>
          )}

          <Neck
            marks={view.marks}
            title={title}
            tuning={tuning}
            labelFor={labelFor}
            colourLabels={view.plainScale ? colour.labels : []}
            playing={playingNote}
            scheme={settings.scheme}
            highOnTop={settings.highOnTop}
            zoomWindow={settings.zoom ? view.window : null}
            dimOpacity={settings.dim}
            onNote={(m) => {
              if (page === "quiz") {
                if (m.pickable) quiz.pickNote(m.string, m.fret);
                return;
              }
              hear(() => engine.pluck(m.midi, m.string));
            }}
          />

          {!focus && page !== "quiz" && view.tones.length > 0 && (
            <DegreeStrip
              tones={view.tones}
              root={view.root}
              scheme={settings.scheme}
              changes={scaleLike && view.plainScale ? diff.changes : []}
              chordSemis={chordSemisNow}
              litSemis={litSemis}
              blendSrc={view.blendSrc}
              onHear={(i) => hear(() => hearSemis(view.root, i))}
            />
          )}

          {focus && page === "progressions" && (
            <div className="fb-chord-cards" aria-label="Progression">
              {activeProg.map((c, i) => (
                <span key={i} className={`fb-chord-card ${playing && markerIdx === i ? "fb-chord-card--playing" : ""}`}>
                  <span className="fb-chord-card__name">{plainName(chordRoot(key, c)) + CHORDS[c.chord].symbol}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {!focus && (
        <aside className="fretboard-side">
          {page === "quiz" && (
            <QuizSide quiz={quiz} tuning={tuning} voiceOn={settings.voice} onVoice={(on) => update({ voice: on })} pace={settings.pace} onReport={() => setReportOpen(true)} onConfirmReset={() => setConfirmReset(true)} scaleLabel={`${KEYS[key]} ${scale.name}`} />
          )}
          {page !== "quiz" && settings.showWeak && (
            <WeakCard
              quiz={quiz}
              keyIdx={key}
              scaleLabel={`${KEYS[key]} ${scale.name}`}
              pace={settings.pace}
              onQuiz={(degree) => {
                if (speedRunRef.current) finishSpeed(false, false);
                if (playing) stopPlayback();
                setPage("quiz");
                quiz.setFocusWeak(true);
                quiz.start(degree ? "degree" : "note");
              }}
            />
          )}
          {page !== "quiz" && view.nowChord && (
            <section className="fb-now-panel">
              <span className="fb-now-panel__label">NOW</span>
              <div className="fb-now-panel__name">
                <strong>{view.nowChord.name}</strong>
                <span className="fb-now-panel__roman">{view.nowChord.roman}</span>
              </div>
              <p className="fb-dim">Chord tones (coloured by their role in the chord):</p>
              <ToneChips tones={CHORDS[view.nowChord.chord].tones} root={view.nowChord.root} scheme={settings.scheme} onHear={(semis) => hear(() => hearSemis(view.nowChord!.root, semis))} />
              {view.nowChord.voicing && (
                <ChordBox
                  voicing={view.nowChord.voicing}
                  tones={CHORDS[view.nowChord.chord].tones}
                  root={view.nowChord.root}
                  tuning={tuning}
                  scheme={settings.scheme}
                  onClick={() => hear(() => strumVoicing(view.nowChord!.voicing as Voicing))}
                />
              )}
              <p><strong>Over the scale: {`${KEYS[key]} ${scale.name}`}</strong></p>
            </section>
          )}
          {page !== "quiz" && !view.nowChord && view.tones.length > 0 && (
            <section className="fb-tones-panel">
              <ToneChips tones={view.tones} root={view.root} scheme={settings.scheme} onHear={(semis) => hear(() => hearSemis(view.root, semis))} />
              {scaleLike && view.plainScale && <StepsLine tones={view.tones} />}
              {view.blendSrc && <BlendLegend a={scale.name} b={SCALES[settings.blendScale]?.name ?? ""} />}
            </section>
          )}
          {page !== "quiz" && view.tones.length > 0 && (
            <DegreeCircle tones={view.tones} root={view.root} scheme={settings.scheme} chordSemis={chordSemisNow} litSemis={litSemis} blendSrc={view.blendSrc} />
          )}
          {page === "chords" && voicing && !view.nowChord && (
            <section className="fretboard-about">
              <h3>Chord shape</h3>
              <ChordBox
                voicing={voicing}
                names={tuning.map((_, s) => (voicing.frets[s] === null ? "" : plainName(tuning[s] + (voicing.frets[s] ?? 0))))}
                tones={chord.tones}
                root={key}
                tuning={tuning}
                scheme={settings.scheme}
                onClick={() => hear(() => strumVoicing(voicing))}
              />
              <p className="fb-dim">Lowest fret {voicingMinFret(voicing)}</p>
            </section>
          )}

          <section className="fretboard-about">
            {scaleLike ? (
              <>
                <h3>About this scale</h3>
                {info ? (
                  <>
                    <p>{info.sound}</p>
                    <p><strong>Use it:</strong> {info.useIt}</p>
                    {info.heardIn.length > 0 && <p><strong>Heard in:</strong> {info.heardIn.join(" · ")}</p>}
                  </>
                ) : (
                  <p className="fb-dim">{scale.group}.</p>
                )}
                {colour.labels.length > 0 && (
                  <p><strong>Colour notes:</strong> {colour.labels.join(", ")} (ringed in gold on the neck)</p>
                )}
                {colour.explanation && <p>{colour.explanation}</p>}
              </>
            ) : (
              <>
                <h3>Notes of {KEYS[key]}{chord.symbol}</h3>
                <ul className="fb-note-list">
                  {chordNotes.map((n) => (
                    <li key={n.label}>
                      <strong>{n.note}</strong> — {n.interval} <span className="fb-dim">({n.label})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {page === "scales" && keyChords.length > 0 && (
            <section className="fretboard-chords">
              <h3>Chords in this key</h3>
              <label className="fb-playbar__check">
                <input type="checkbox" checked={keySevenths} onChange={(e) => setKeySevenths(e.target.checked)} /> 7ths
              </label>
              <div className="fb-chord-chips">
                {keyChords.map(([d, c]) => {
                  const cd = CHORDS[c];
                  const name = spell(key, scale.tones[d].semis, scale.tones[d].label) + cd.symbol;
                  return (
                    <button
                      key={d}
                      className="fb-chord-chip"
                      title={`Click to hear ${name}, double-click to open it on the Chords page`}
                      onClick={() => hear(() => playKeyChord(d, c), `chord ${name}`)}
                      onDoubleClick={() => openChord(d, c)}
                    >
                      {name}
                      <span className="fb-chord-chip__roman">{roman(d, cd)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
        )}
      </div>

      <PlayBar
        page={page}
        settings={settings}
        update={update}
        playing={playing}
        soundName={font.presets.find((p) => p.bank === settings.preset[0] && p.program === settings.preset[1])?.name ?? (settings.presetName || "SoundFont")}
        onToggle={togglePlayback}
        onSettings={() => setSettingsOpen(true)}
      />

      {settingsOpen && (
        <FretSettingsModal
          settings={settings}
          update={update}
          presets={font.presets}
          fontLoading={font.loading}
          userFonts={font.userFonts}
          onAddFont={font.add}
          onRemoveFont={font.remove}
          weak={quiz.weak}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {settingsError && <ErrorModal error={settingsError} onDismiss={clearError} />}
      {reportOpen && <QuizReport history={quiz.history} tuning={tuning} onClear={quiz.clear} onClose={() => setReportOpen(false)} />}
      {confirmReset && (
        <ConfirmModal
          title="Reset the score?"
          message="Set this session's score, streak and best streak back to zero? Your saved answer history is not touched."
          confirmLabel="Reset"
          onConfirm={() => {
            setConfirmReset(false);
            quiz.resetScore();
          }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
      {prog.error && <ErrorModal error={prog.error} onDismiss={prog.clearError} />}
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
