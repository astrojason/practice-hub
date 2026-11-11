import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// Instrument stems for the media player's instrument filter. The Rust side
// (separate_stems / mix_stems / get_cached_stems) runs Demucs via a Python
// sidecar and caches the stems per file; this hook tracks whether the current
// file has stems and resolves the mix to play for the current muted set.
//
// All state is tagged with the file it belongs to, so for the render(s)
// between switching files and the effects below catching up, the previous
// file's stems/mix are never paired with the new file's path.

export const STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"] as const;

export const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals", drums: "Drums", bass: "Bass", guitar: "Guitar", piano: "Piano", other: "Other",
};

export interface StemFile {
  name: string;
  path: string;
}

export type StemStatus = "unavailable" | "checking" | "none" | "separating" | "ready";

export interface StemsState {
  status: StemStatus;
  stems: StemFile[] | null;
  /** Path of the mix to play instead of the original, or null to play the original. */
  mixPath: string | null;
  mixing: boolean;
  separate: () => void;
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Tagged<T> { file: string; value: T }

export function useStems(
  filePath: string,
  mutedStems: string[],
  onError: (message: string) => void,
): StemsState {
  const [statusState, setStatusState] = useState<Tagged<StemStatus> | null>(null);
  const [stemsState, setStemsState] = useState<Tagged<StemFile[]> | null>(null);
  const [mixState, setMixState] = useState<Tagged<string> | null>(null);
  const [mixing, setMixing] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const currentFileRef = useRef(filePath);
  currentFileRef.current = filePath;

  const status: StemStatus = !hasTauri()
    ? "unavailable"
    : statusState?.file === filePath ? statusState.value : "checking";
  const stems = stemsState?.file === filePath ? stemsState.value : null;
  const mixPath = mixState?.file === filePath ? mixState.value : null;

  useEffect(() => {
    if (!hasTauri()) return;
    let cancelled = false;
    invoke<StemFile[] | null>("get_cached_stems", { filePath })
      .then((cached) => {
        if (cancelled) return;
        if (cached) setStemsState({ file: filePath, value: cached });
        setStatusState({ file: filePath, value: cached ? "ready" : "none" });
      })
      .catch((err) => {
        if (cancelled) return;
        setStatusState({ file: filePath, value: "none" });
        onErrorRef.current(`Couldn't check for separated instruments: ${errorText(err)}`);
      });
    return () => { cancelled = true; };
  }, [filePath]);

  const separate = useCallback(() => {
    const target = filePath;
    setStatusState({ file: target, value: "separating" });
    invoke<StemFile[]>("separate_stems", { filePath: target })
      .then((result) => {
        setStemsState({ file: target, value: result });
        setStatusState({ file: target, value: "ready" });
      })
      .catch((err) => {
        setStatusState({ file: target, value: "none" });
        if (currentFileRef.current !== target) return;
        onErrorRef.current(`Couldn't separate instruments: ${errorText(err)}`);
      });
  }, [filePath]);

  const mutedKey = [...mutedStems].sort().join("+");
  useEffect(() => {
    if (!stems || mutedKey === "") {
      setMixState(null);
      setMixing(false);
      return;
    }
    let cancelled = false;
    setMixing(true);
    invoke<string>("mix_stems", { filePath, muted: mutedKey.split("+") })
      .then((path) => {
        if (cancelled) return;
        setMixState({ file: filePath, value: path });
        setMixing(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setMixState(null);
        setMixing(false);
        onErrorRef.current(`Couldn't mix the remaining instruments: ${errorText(err)}`);
      });
    return () => { cancelled = true; };
  }, [stems, mutedKey, filePath]);

  return { status, stems, mixPath, mixing, separate };
}
