import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { seekVideo } from "./videoSeek";

export interface WaveMarker {
  time: number;
  name: string;
}

const MARKER_EPS = 0.05;

interface Options {
  dur: number;
  /** The live playhead position — reactive, so the selected marker can silently
   * follow it as it moves (playback advancing past a marker, scrubbing, etc.)
   * without issuing a seek. */
  currentTime: number;
  /** Reads the authoritative playhead position at call time — must not rely on
   * React state mirrored from a DOM event (e.g. video `timeupdate`), which can
   * lag or fail to fire promptly after a programmatic seek while paused. */
  getCurrentTime: () => number;
  isVideo: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  seekAudio: (time: number) => void;
  /** Called after any marker mutation — MediaPlayer schedules a debounced preset save. */
  onChange: () => void;
}

/** Waveform markers: add/delete/nudge/jump, kept in sync with a ref for synchronous reads (preset snapshots, keyboard shortcuts). */
export function useMarkers({ dur, currentTime, getCurrentTime, isVideo, videoRef, seekAudio, onChange }: Options) {
  const [markers, setMarkersState] = useState<WaveMarker[]>([]);
  const [selectedIdx, setSelectedIdxState] = useState(-1);
  const [nameInput, setNameInput] = useState("");
  const markersRef = useRef<WaveMarker[]>([]);
  const selectedIdxRef = useRef(-1);
  const durRef = useRef(dur);
  const getCurrentTimeRef = useRef(getCurrentTime);

  useEffect(() => { durRef.current = dur; }, [dur]);
  useEffect(() => { getCurrentTimeRef.current = getCurrentTime; }, [getCurrentTime]);

  // Silently keep the selection in sync with wherever the playhead actually is —
  // the last marker at or before currentTime — without seeking. This runs on
  // every currentTime change (playback advancing, scrubbing, a Prev/Next seek
  // landing), so Next/Prev's simple selectedIdx ± 1 step always starts from the
  // marker the playhead is really sitting on.
  useEffect(() => {
    const list = markersRef.current;
    if (!list.length) return;
    let idx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].time <= currentTime + MARKER_EPS) { idx = i; break; }
    }
    if (idx !== selectedIdxRef.current) {
      setSelectedIdxState(idx);
      selectedIdxRef.current = idx;
      setNameInput(idx >= 0 ? (list[idx].name ?? "") : "");
    }
  }, [currentTime]);

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
    addMarkerAt(getCurrentTimeRef.current());
  }, [addMarkerAt]);

  // Steps to the adjacent marker by index (selectedIdx is already kept in sync
  // with the playhead by the effect above), so the result is always exactly the
  // previous/next item in the list — and the caller can disable Prev/Next at the
  // ends instead of wrapping.
  const jumpToMarker = useCallback((dir: "prev" | "next") => {
    const list = markersRef.current;
    if (!list.length) return;
    const cur = selectedIdxRef.current;
    const idx = dir === "next"
      ? (cur < 0 ? 0 : cur + 1)
      : (cur < 0 ? list.length - 1 : cur - 1);
    if (idx < 0 || idx >= list.length) return;
    const marker = list[idx];
    setSelectedIdxState(idx);
    selectedIdxRef.current = idx;
    setNameInput(marker.name ?? "");
    if (isVideo && videoRef.current) seekVideo(videoRef.current, marker.time);
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
