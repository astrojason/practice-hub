import { readLocalStorageJSON, writeLocalStorageJSON } from "../hooks/useLocalStorageJSON";
import type { ResourceAutoplay } from "../api/types";

/**
 * Study materials have no `autoplay` field on the backend (only exercise and
 * song resources do), so their per-file "what to do when opened" choice is
 * kept on this computer, keyed by the file path.
 */
const KEY = "ph:resourceAutoplay";

export function readLocalAutoplay(): { value: Record<string, ResourceAutoplay>; error: string | null } {
  return readLocalStorageJSON<Record<string, ResourceAutoplay>>(KEY, {});
}

/** Throws if the choice can't be stored — callers must surface that. */
export function writeLocalAutoplay(path: string, mode: ResourceAutoplay): void {
  const { value, error } = readLocalAutoplay();
  if (error) throw new Error(error);
  writeLocalStorageJSON(KEY, { ...value, [path]: mode });
}
