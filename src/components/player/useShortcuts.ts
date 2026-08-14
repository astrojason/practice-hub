import { useCallback, useEffect, useRef, useState } from "react";
import { readLocalStorageJSON, writeLocalStorageJSON } from "../../hooks/useLocalStorageJSON";

const SHORTCUT_KEY = "practicePlayerShortcuts";

export const defaultShortcuts: Record<string, string> = {
  increaseSpeed: "=",
  decreaseSpeed: "-",
  togglePlayPause: "Space",
  seekBackward: "ArrowLeft",
  seekForward: "ArrowRight",
  jumpForward: ".",
  jumpBackward: ",",
  setLoopStart: "a",
  setLoopEnd: "b",
  toggleLoop: "l",
  nudgeLoopStartBack: "[",
  nudgeLoopStartForward: "]",
  nudgeLoopEndBack: ";",
  nudgeLoopEndForward: "'",
  nudgeMarkerBack: "Shift+ArrowLeft",
  nudgeMarkerForward: "Shift+ArrowRight",
  nudgeLoopStartBackSmall: "Ctrl+ArrowLeft",
  nudgeLoopStartForwardSmall: "Ctrl+ArrowRight",
  nudgeLoopEndBackSmall: "Ctrl+ArrowUp",
  nudgeLoopEndForwardSmall: "Ctrl+ArrowDown",
  addMarker: "m",
  prevMarker: "Alt+ArrowLeft",
  nextMarker: "Alt+ArrowRight",
  closePlayer: "Escape",
};

export const shortcutMeta: Record<string, { label: string; description: string }> = {
  increaseSpeed: { label: "Increase speed", description: "Raise playback speed by one step" },
  decreaseSpeed: { label: "Decrease speed", description: "Lower playback speed by one step" },
  togglePlayPause: { label: "Play / pause", description: "Toggle playback" },
  seekBackward: { label: "Seek backward", description: "Seek back 5s" },
  seekForward: { label: "Seek forward", description: "Seek forward 5s" },
  jumpForward: { label: "Skip forward", description: "Jump ahead by 5%" },
  jumpBackward: { label: "Skip backward", description: "Jump back by 5%" },
  setLoopStart: { label: "Set loop start", description: "Drop loop start at playhead" },
  setLoopEnd: { label: "Set loop end", description: "Drop loop end at playhead" },
  toggleLoop: { label: "Toggle loop", description: "Enable or disable loop playback" },
  nudgeLoopStartBack: { label: "Loop start −5%", description: "Move loop start backward by 5%" },
  nudgeLoopStartForward: { label: "Loop start +5%", description: "Move loop start forward by 5%" },
  nudgeLoopEndBack: { label: "Loop end −5%", description: "Move loop end backward by 5%" },
  nudgeLoopEndForward: { label: "Loop end +5%", description: "Move loop end forward by 5%" },
  nudgeMarkerBack: { label: "Marker −0.5s", description: "Nudge selected marker back 0.5s" },
  nudgeMarkerForward: { label: "Marker +0.5s", description: "Nudge selected marker forward 0.5s" },
  nudgeLoopStartBackSmall: { label: "Loop start −0.5s", description: "Nudge loop start back 0.5s" },
  nudgeLoopStartForwardSmall: { label: "Loop start +0.5s", description: "Nudge loop start forward 0.5s" },
  nudgeLoopEndBackSmall: { label: "Loop end −0.5s", description: "Nudge loop end back 0.5s" },
  nudgeLoopEndForwardSmall: { label: "Loop end +0.5s", description: "Nudge loop end forward 0.5s" },
  addMarker: { label: "Add marker", description: "Drop a marker at current playhead" },
  prevMarker: { label: "Previous marker", description: "Jump to the nearest marker before the playhead" },
  nextMarker: { label: "Next marker", description: "Jump to the nearest marker after the playhead" },
  closePlayer: { label: "Close player", description: "Close the media player" },
};

export const shortcutOrder = Object.keys(defaultShortcuts);

function loadShortcuts(): { value: Record<string, string>; error: string | null } {
  const { value, error } = readLocalStorageJSON<Record<string, string>>(SHORTCUT_KEY, {});
  return {
    value: { ...defaultShortcuts, ...value },
    error: error && `Couldn't load your custom keyboard shortcuts — defaults are in use instead. (${error})`,
  };
}

interface Options {
  onPersistError: (message: string) => void;
}

/** Keyboard-shortcut bindings: load/persist/rebind/reset. Dispatching a pressed key to a player action stays in MediaPlayer — it needs access to nearly every player action. */
export function useShortcuts({ onPersistError }: Options) {
  const initialLoadRef = useRef<ReturnType<typeof loadShortcuts> | null>(null);
  if (initialLoadRef.current === null) initialLoadRef.current = loadShortcuts();

  const [bindings, setBindingsState] = useState<Record<string, string>>(initialLoadRef.current.value);
  const bindingsRef = useRef(bindings);
  useEffect(() => { bindingsRef.current = bindings; }, [bindings]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingRebind, setPendingRebind] = useState<string | null>(null);

  const persistBindings = useCallback((next: Record<string, string>, buildErrorMessage: (detail: string) => string) => {
    setBindingsState(next);
    bindingsRef.current = next;
    try {
      writeLocalStorageJSON(SHORTCUT_KEY, next);
    } catch (err) {
      onPersistError(buildErrorMessage(err instanceof Error ? err.message : String(err)));
    }
  }, [onPersistError]);

  const commitRebind = useCallback((actionId: string, key: string) => {
    persistBindings(
      { ...bindingsRef.current, [actionId]: key },
      (detail) => `Couldn't save your keyboard shortcut — it'll reset next time the app opens. (${detail})`
    );
  }, [persistBindings]);

  const resetToDefaults = useCallback(() => {
    persistBindings(
      { ...defaultShortcuts },
      (detail) => `Couldn't save your keyboard shortcuts reset — it'll revert next time the app opens. (${detail})`
    );
  }, [persistBindings]);

  return {
    bindings,
    bindingsRef,
    initialLoadError: initialLoadRef.current.error,
    paletteOpen,
    setPaletteOpen,
    pendingRebind,
    setPendingRebind,
    commitRebind,
    resetToDefaults,
  };
}
