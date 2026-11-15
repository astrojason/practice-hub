import { useSyncExternalStore } from "react";

/**
 * A request to open an item's session modal from outside its card (e.g. the
 * AI challenges panel). The card lives inside a collapsible group that may not
 * be mounted yet, so the request is held here until the card consumes it, and
 * the group watches it to expand itself.
 */
let pending: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function requestSessionModal(itemKey: string) {
  pending = itemKey;
  emit();
}

export function consumeSessionModalRequest(itemKey: string): boolean {
  if (pending !== itemKey) return false;
  pending = null;
  emit();
  return true;
}

export function usePendingSessionModalKey(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
  );
}
