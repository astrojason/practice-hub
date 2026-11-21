import { useCallback, useState } from "react";
import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";
import { presetChords, type ProgChord } from "./progression";

export interface SavedProgression {
  name: string;
  chords: ProgChord[];
  /** Index into SCALES of the scale it was saved with. */
  scale: number;
}

const CURRENT = "ph:fretboard:progression";
const SAVED = "ph:fretboard:saved-progressions";

interface Current {
  chords: ProgChord[];
  name: string;
}

/** The progression being edited, plus the person's saved ones. Storage problems come back in `error`. */
export function useProgression(suggested?: Current) {
  const [initial] = useState(() => {
    // A progression suggested by the dashboard is the starting point; it is only kept once the person changes something.
    const cur = suggested
      ? { value: suggested, error: undefined }
      : readLocalStorageJSON<Current>(CURRENT, { chords: presetChords(0), name: "" });
    const saved = readLocalStorageJSON<SavedProgression[]>(SAVED, []);
    return { cur: cur.value, saved: saved.value, error: cur.error ?? saved.error };
  });
  const [chords, setChordsState] = useState<ProgChord[]>(initial.cur.chords);
  const [name, setNameState] = useState(initial.cur.name);
  const [saved, setSavedState] = useState<SavedProgression[]>(initial.saved);
  const [error, setError] = useState<string | null>(initial.error);

  const persist = useCallback((key: string, value: unknown) => {
    try {
      writeLocalStorageJSON(key, value);
    } catch (err) {
      setError(`Couldn't save the progression: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const setChords = useCallback(
    (next: ProgChord[], nextName?: string) => {
      setChordsState(next);
      const n = nextName ?? name;
      if (nextName !== undefined) setNameState(nextName);
      persist(CURRENT, { chords: next, name: n });
    },
    [name, persist],
  );

  const setName = useCallback(
    (n: string) => {
      setNameState(n);
      persist(CURRENT, { chords, name: n });
    },
    [chords, persist],
  );

  const save = useCallback(
    (entry: SavedProgression) => {
      const next = [...saved.filter((s) => s.name !== entry.name), entry].sort((a, b) => a.name.localeCompare(b.name));
      setSavedState(next);
      persist(SAVED, next);
    },
    [saved, persist],
  );

  const remove = useCallback(
    (entryName: string) => {
      const next = saved.filter((s) => s.name !== entryName);
      setSavedState(next);
      persist(SAVED, next);
    },
    [saved, persist],
  );

  return { chords, setChords, name, setName, saved, save, remove, error, clearError: () => setError(null) };
}
