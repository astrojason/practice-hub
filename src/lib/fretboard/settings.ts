import { useCallback, useEffect, useState } from "react";
import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";
import { DEFAULT_SOUND, engine, type SoundSettings } from "./audio";
import { DEFAULT_PRACTICE, type PracticeSettings } from "./practice";
import { DEFAULT_SPEED, type SpeedSetup } from "./speed";
import type { Pace } from "./weakness";
import type { ChordFocus, Comp, DrumStyle, Follow } from "./progression";

export type Direction = "up" | "down" | "updown";

export interface PlaybackSettings {
  bpm: number;
  /** Notes per beat: 1 quarter, 2 eighths, 3 triplets, 4 sixteenths. */
  notesPerBeat: number;
  direction: Direction;
  loop: boolean;
  /** Settings saved before scales and arpeggios played up and down by default: 2 once the default was applied. */
  dirVersion: number;
  /** Bars of count-in before playback (0, 1 or 2). */
  countIn: number;
  click: boolean;
  drone: boolean;
  /** How the guitar plays a progression, and the drum style behind it. */
  comp: Comp;
  drums: DrumStyle;
  /** Beats each chord lasts unless it sets its own. */
  beatsPerChord: number;
  follow: Follow;
  focus: ChordFocus;
  /** Play a progression under the Scales, Arpeggios and Chords pages. */
  playOver: boolean;
  /** On the Scales page, choose the progression that suits the scale. */
  suitScale: boolean;
  practice: PracticeSettings;
  speed: SpeedSetup;
  /** What counts as your usual pace for clearing weak spots. */
  pace: Pace;
  /** Answer the quiz out loud, through the microphone. */
  voice: boolean;
  /** How fast the voice talks, in words per minute. */
  voiceRate: number;
  /** The microphone for spoken answers, by name ("" for the system default). */
  micName: string;
  /** The speech voice by name ("" for the system default). */
  voiceName: string;
}

export type LabelMode = "degree" | "note" | "both" | "interval" | "none";

export interface NeckSettings {
  theme: "dark" | "light" | "system";
  /** Index into SCHEMES. */
  scheme: number;
  labels: LabelMode;
  /** Which stringed instrument the neck shows (an INSTRUMENT_TYPES id). */
  stringed: string;
  /** Index into that instrument's tunings. */
  tuning: number;
  highOnTop: boolean;
  /** Give the chosen position more room. */
  zoom: boolean;
  /** Show the scale's other notes, faintly. */
  ghosts: boolean;
  /** How much to dim everything outside the position (0-1). */
  dim: number;
  /** Degree families (1-7) hidden from the neck. */
  hiddenDegrees: number[];
  /** Strings (0 = lowest) hidden from the neck. */
  hiddenStrings: number[];
  showPrev: boolean;
  showNext: boolean;
  /** Position number (1-based) to join the chosen position to along the chosen strings, or 0 for none. */
  connect: number;
  connectStrings: number[];
  /** Index into SCALES of a second scale laid over the first, or -1. */
  blendScale: number;
  /** Half steps above the key the blended scale starts on. */
  blendRoot: number;
  /** Mark weak spots from the quiz with a ! badge. */
  showWeak: boolean;
}

export type FretSettings = SoundSettings & PlaybackSettings & NeckSettings;

export const DEFAULT_SETTINGS: FretSettings = {
  ...DEFAULT_SOUND,
  bpm: 80,
  notesPerBeat: 2,
  direction: "updown",
  loop: true,
  countIn: 1,
  dirVersion: 2,
  click: true,
  drone: true,
  comp: "beats",
  drums: "rock",
  beatsPerChord: 4,
  follow: "off",
  focus: "shape",
  playOver: false,
  suitScale: true,
  practice: DEFAULT_PRACTICE,
  speed: DEFAULT_SPEED,
  pace: { type: "average" },
  voice: false,
  voiceRate: 175,
  voiceName: "",
  micName: "",
  theme: "dark",
  scheme: 0,
  labels: "degree",
  stringed: "guitar6",
  tuning: 0,
  highOnTop: true,
  zoom: false,
  ghosts: true,
  dim: 0.72,
  hiddenDegrees: [],
  hiddenStrings: [],
  showPrev: false,
  showNext: false,
  connect: 0,
  connectStrings: [],
  blendScale: -1,
  blendRoot: 0,
  showWeak: true,
};

const KEY = "ph:fretboard:settings";

/** Theory Training settings, saved in local storage. Problems reading or saving are returned in `error`. */
export function useFretSettings() {
  const [state] = useState(() => readLocalStorageJSON<Partial<FretSettings>>(KEY, {}));
  const [settings, setSettings] = useState<FretSettings>({ ...DEFAULT_SETTINGS, ...state.value, connect: typeof state.value.connect === "number" ? state.value.connect : 0,
    // Scales and arpeggios now go up and down by default, not just up; carry that over once.
    ...(state.value.dirVersion === 2 || Object.keys(state.value).length === 0 ? {} : { direction: "updown" as const, dirVersion: 2 }), practice: { ...DEFAULT_PRACTICE, ...state.value.practice }, speed: { ...DEFAULT_SPEED, ...state.value.speed } });
  const [error, setError] = useState<string | null>(state.error);

  useEffect(() => {
    engine.configure(settings);
  }, [settings]);

  const update = useCallback((patch: Partial<FretSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        writeLocalStorageJSON(KEY, next);
      } catch (err) {
        setError(`Couldn't save the Theory Training settings: ${err instanceof Error ? err.message : String(err)}`);
      }
      return next;
    });
  }, []);

  return { settings, update, error, clearError: () => setError(null) };
}
