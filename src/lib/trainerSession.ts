import { useSyncExternalStore } from "react";

/**
 * Theory Training records what is being practised here. Pressing Start (or Play) anywhere in it
 * starts the Open Session timer; every activity line is written into the Open Session's notes so
 * the logged session says what was actually worked on; and Stop, leaving, or switching what is
 * being studied opens the Open Session save form with all of that filled in. Nothing is saved
 * without going through that form.
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
  started = false;
  if (lines.length === 0) return;
  lines = [];
  emit();
}

let started = false;
let startVersion = 0;
const startListeners = new Set<() => void>();

/** Start the Open Session timer (Start or Play was pressed in Theory Training). */
export function startTrainerSession() {
  started = true;
  startVersion += 1;
  startListeners.forEach((l) => l());
}

/** Whether a Theory Training session has been started and not yet logged or cancelled. */
export const isTrainerSessionStarted = () => started;

export function useTrainerStarts(): number {
  return useSyncExternalStore(
    (cb) => {
      startListeners.add(cb);
      return () => startListeners.delete(cb);
    },
    () => startVersion,
  );
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

let leaveRequested = false;

/**
 * Stop the Open Session timer and open the Open Session save form, ready to log what was
 * practised. With `leave`, the session view is shown too. Does nothing unless a session was started.
 */
export function requestSaveSession(leave = false) {
  if (!started) return;
  leaveRequested = leave;
  saveRequests += 1;
  saveListeners.forEach((l) => l());
}

/** Whether the last save request also asked to leave Theory Training (read once). */
export function consumeLeaveRequest(): boolean {
  const v = leaveRequested;
  leaveRequested = false;
  return v;
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
