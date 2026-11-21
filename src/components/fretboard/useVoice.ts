import { useCallback, useEffect, useRef, useState } from "react";
import { spokenVocabulary } from "../../lib/fretboard/spoken";
import type { QuizKind } from "../../lib/fretboard/quiz";
import { voiceBackend, type VoiceEvent } from "../../lib/fretboard/voice";

interface Options {
  /** Listen now (the quiz is running and "Answer out loud" is on). */
  want: boolean;
  kind: QuizKind;
  /** The microphone by name ("" for the system default). */
  input: string;
  /** A phrase was heard: the recogniser's guesses and when speech began (ms since 1970), if known. */
  onHeard: (guesses: string[], onsetAt: number | null) => void;
}

export type VoiceStatus = "off" | "starting" | "listening" | "error";

/** Keeps the microphone listening while it is wanted, and reports what it hears. */
export function useVoice({ want, kind, input, onHeard }: Options) {
  const [status, setStatus] = useState<VoiceStatus>("off");
  const [onDevice, setOnDevice] = useState<boolean | null>(null);
  const [level, setLevel] = useState(0);
  const [dropouts, setDropouts] = useState(0);
  const [heard, setHeard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onsetRef = useRef<number | null>(null);
  const heardRef = useRef(onHeard);
  heardRef.current = onHeard;
  const pauseTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!want || error) {
      if (!want) {
        setStatus("off");
        setLevel(0);
      }
      return;
    }
    let cancelled = false;
    let stop: (() => void) | null = null;
    setStatus("starting");
    setDropouts(0);
    setHeard(null);
    const handle = (e: VoiceEvent) => {
      if (cancelled) return;
      switch (e.type) {
        case "ready": setOnDevice(e.onDevice); setStatus("listening"); break;
        case "onset": onsetRef.current = Date.now() - e.agoMs; break;
        case "heard": {
          setHeard(e.guesses[0] ?? "");
          const at = onsetRef.current;
          onsetRef.current = null;
          heardRef.current(e.guesses, at);
          break;
        }
        case "nothing": setHeard("(nothing recognised)"); break;
        case "dropout": setDropouts((d) => d + 1); break;
        case "level": setLevel(e.value); break;
        case "error": setError(e.message); setStatus("error"); break;
      }
    };
    voiceBackend()
      .start(spokenVocabulary(kind), input, handle)
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [want, kind, input, error, attempt]);

  /** Stop listening for a moment while the app plays a note, and a little after it. */
  const pauseFor = useCallback(
    (ms: number) => {
      if (!want || status !== "listening") return;
      if (pauseTimer.current !== null) window.clearTimeout(pauseTimer.current);
      voiceBackend()
        .pause(true)
        .catch((err) => setError(`Could not pause listening: ${err instanceof Error ? err.message : String(err)}`));
      pauseTimer.current = window.setTimeout(() => {
        voiceBackend()
          .pause(false)
          .catch((err) => setError(`Could not resume listening: ${err instanceof Error ? err.message : String(err)}`));
        pauseTimer.current = null;
      }, ms + 400);
    },
    [want, status],
  );

  const retry = useCallback(() => {
    setError(null);
    setAttempt((a) => a + 1);
  }, []);

  return { status, onDevice, level, dropouts, heard, error, retry, pauseFor };
}

export type Voice = ReturnType<typeof useVoice>;
