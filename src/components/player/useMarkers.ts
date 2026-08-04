import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface WaveMarker {
  time: number;
  name: string;
}

interface Options {
  dur: number;
  currentTime: number;
  isVideo: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  seekAudio: (time: number) => void;
  /** Called after any marker mutation — MediaPlayer schedules a debounced preset save. */
  onChange: () => void;
}

/** Waveform markers: add/delete/nudge/jump, kept in sync with a ref for synchronous reads (preset snapshots, keyboard shortcuts). */
export function useMarkers({ dur, currentTime, isVideo, videoRef, seekAudio, onChange }: Options) {
  const [markers, setMarkersState] = useState<WaveMarker[]>([]);
  const [selectedIdx, setSelectedIdxState] = useState(-1);
  const [nameInput, setNameInput] = useState("");
  const markersRef = useRef<WaveMarker[]>([]);
  const selectedIdxRef = useRef(-1);
  const durRef = useRef(dur);
  const currentTimeRef = useRef(currentTime);

  useEffect(() => { durRef.current = dur; }, [dur]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  const addMarkerAt = useCallback((time: number) => {
    if (!Number.isFinite(time) || durRef.current <= 0) return;
    const clamped = Math.max(0, Math.min(durRef.current, time));
    setMarkersState(prev => {
      const existing = prev.findIndex(m => Math.abs(m.time - clamped) < 0.05);
      let next: WaveMarker[];
      if (existing === -1) {
        next = [...prev, { time: clamped, name: "" }];
      } else {
        next = prev.map((m, i) => i === existing ? { ...m, time: clamped } : m);
      }
      next = [...next].sort((a, b) => a.time - b.time);
      const idx = next.findIndex(m => m.time === clamped);
      markersRef.current = next;
      setSelectedIdxState(idx);
      selectedIdxRef.current = idx;
      setNameInput(next[idx]?.name ?? "");
      return next;
    });
    onChange();
  }, [onChange]);

  const addMarkerFromCurrentTime = useCallback(() => {
    addMarkerAt(currentTimeRef.current);
  }, [addMarkerAt]);

  const jumpToMarker = useCallback((dir: "prev" | "next") => {
    const list = markersRef.current;
    if (!list.length) return;
    let idx = selectedIdxRef.current;
    if (idx === -1) idx = 0;
    else if (dir === "next") idx = (idx + 1) % list.length;
    else idx = (idx - 1 + list.length) % list.length;
    const marker = list[idx];
    setSelectedIdxState(idx);
    selectedIdxRef.current = idx;
    setNameInput(marker.name ?? "");
    if (isVideo && videoRef.current) videoRef.current.currentTime = marker.time;
    else seekAudio(marker.time);
  }, [isVideo, videoRef, seekAudio]);

  const deleteSelected = useCallback(() => {
    const idx = selectedIdxRef.current;
    if (idx < 0) return;
    setMarkersState(prev => {
      const next = prev.filter((_, i) => i !== idx);
      markersRef.current = next;
      const newIdx = next.length ? Math.min(idx, next.length - 1) : -1;
      setSelectedIdxState(newIdx);
      selectedIdxRef.current = newIdx;
      setNameInput(newIdx >= 0 ? (next[newIdx]?.name ?? "") : "");
      return next;
    });
    onChange();
  }, [onChange]);

  const clearAll = useCallback(() => {
    setMarkersState([]);
    markersRef.current = [];
    setSelectedIdxState(-1);
    selectedIdxRef.current = -1;
    setNameInput("");
    onChange();
  }, [onChange]);

  const nudgeSelected = useCallback((delta: number) => {
    const idx = selectedIdxRef.current;
    if (idx < 0 || durRef.current <= 0) return;
    setMarkersState(prev => {
      const marker = prev[idx];
      if (!marker) return prev;
      const next = Math.max(0, Math.min(durRef.current, marker.time + delta));
      const updated = prev.map((m, i) => i === idx ? { ...m, time: next } : m);
      const sorted = [...updated].sort((a, b) => a.time - b.time);
      const newIdx = sorted.findIndex(m => m.time === next);
      markersRef.current = sorted;
      setSelectedIdxState(newIdx);
      selectedIdxRef.current = newIdx;
      return sorted;
    });
    onChange();
  }, [onChange]);

  const renameSelected = useCallback((name: string) => {
    setNameInput(name);
    const idx = selectedIdxRef.current;
    if (idx < 0) return;
    setMarkersState(prev => {
      const next = prev.map((m, i) => i === idx ? { ...m, name } : m);
      markersRef.current = next;
      return next;
    });
    onChange();
  }, [onChange]);

  /** Replace the whole list — used when applying a stored preset. */
  const loadMarkers = useCallback((next: WaveMarker[] | undefined) => {
    const list = Array.isArray(next) ? [...next] : [];
    setMarkersState(list);
    markersRef.current = list;
    const idx = list.length ? 0 : -1;
    setSelectedIdxState(idx);
    selectedIdxRef.current = idx;
    setNameInput(list.length ? (list[0].name ?? "") : "");
  }, []);

  return {
    markers,
    markersRef,
    selectedIdx,
    nameInput,
    setNameInput,
    addMarkerAt,
    addMarkerFromCurrentTime,
    jumpToMarker,
    deleteSelected,
    clearAll,
    nudgeSelected,
    renameSelected,
    loadMarkers,
  };
}
