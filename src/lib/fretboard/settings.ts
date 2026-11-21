import { useCallback, useEffect, useState } from "react";
import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";
import { DEFAULT_SOUND, engine, type SoundSettings } from "./audio";
import type { ChordFocus, Comp, DrumStyle, Follow } from "./progression";

export type Direction = "up" | "down" | "updown";

export interface PlaybackSettings {
  bpm: number;
  /** Notes per beat: 1 quarter, 2 eighths, 3 triplets, 4 sixteenths. */
  notesPerBeat: number;
  direction: Direction;
  loop: boolean;
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
}

export type FretSettings = SoundSettings & PlaybackSettings;

export const DEFAULT_SETTINGS: FretSettings = {
  ...DEFAULT_SOUND,
  bpm: 80,
  notesPerBeat: 2,
  direction: "up",
  loop: true,
  countIn: 1,
  click: true,
  drone: true,
  comp: "beats",
  drums: "rock",
  beatsPerChord: 4,
  follow: "off",
  focus: "shape",
  playOver: false,
  suitScale: true,
};

const KEY = "ph:fretboard:settings";

/** Fretboard Trainer settings, saved in local storage. Problems reading or saving are returned in `error`. */
export function useFretSettings() {
  const [state] = useState(() => readLocalStorageJSON<Partial<FretSettings>>(KEY, {}));
  const [settings, setSettings] = useState<FretSettings>({ ...DEFAULT_SETTINGS, ...state.value });
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
        setError(`Couldn't save the Fretboard Trainer settings: ${err instanceof Error ? err.message : String(err)}`);
      }
      return next;
    });
  }, []);

  return { settings, update, error, clearError: () => setError(null) };
}
