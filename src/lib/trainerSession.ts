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

/** How long with no input (and nothing playing) before the trainer's Open Session timer pauses. */
export const idleMs = () => (window as unknown as { __trainerIdleMs?: number }).__trainerIdleMs ?? 120_000;

let busy = false;
let touchVersion = 0;
const touchListeners = new Set<() => void>();

/** The trainer is doing something on its own (playing, a quiz or speed session running). */
export function setTrainerBusy(b: boolean) {
  busy = b;
}
export const isTrainerBusy = () => busy;

/** Someone used the trainer (a click or key press in it). */
export function touchTrainer() {
  touchVersion += 1;
  touchListeners.forEach((l) => l());
}

export function useTrainerTouches(): number {
  return useSyncExternalStore(
    (cb) => {
      touchListeners.add(cb);
      return () => touchListeners.delete(cb);
    },
    () => touchVersion,
  );
}

let saveRequests = 0;
const saveListeners = new Set<() => void>();

/** Ask the session view to open the Open Session form, ready to save what the trainer logged. */
export function requestSaveSession() {
  saveRequests += 1;
  saveListeners.forEach((l) => l());
}

export function useSaveRequests(): number {
  return useSyncExternalStore(
    (cb) => {
      saveListeners.add(cb);
      return () => saveListeners.delete(cb);
    },
    () => saveRequests,
  );
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
