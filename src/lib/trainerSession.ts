import { useSyncExternalStore } from "react";

/**
 * The Fretboard Trainer records what is being practised here. The session view
 * watches it: the first entry starts the Open Session timer, and every entry
 * is written into the Open Session's notes so the logged session says what was
 * actually worked on.
 */
let lines: string[] = [];
let snapshot: readonly string[] = lines;
const listeners = new Set<() => void>();

function emit() {
  snapshot = [...lines];
  listeners.forEach((l) => l());
}

/** Record an activity line (ignored when it repeats the previous one). */
export function logTrainerActivity(line: string) {
  if (lines[lines.length - 1] === line) return;
  lines.push(line);
  emit();
}

export function clearTrainerActivity() {
  if (lines.length === 0) return;
  lines = [];
  emit();
}

export function useTrainerActivity(): readonly string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}
