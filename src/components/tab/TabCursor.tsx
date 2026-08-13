import { useEffect, useRef } from "react";
import { timeToX, type TrackLayout } from "../../lib/tabLayout";
import { LEFT_MARGIN_PX } from "./tabGeometry";

// ─── Phase 4: the deterministic cursor ──────────────────────────────────────────
//
// This is the actual fix for the reported bug. The old GpViewer cursor was an
// event-driven relay: a rAF loop pushed the audio-engine's current time into
// alphaTab's IExternalMediaSynthOutput, which alphaTab then translated back
// into a cursor position via its own internal MIDI tick lookup — two
// independently-clocked systems bridged every frame.
//
// Here there's no relay: `timeToX` (tabLayout.ts) is a precomputed,
// deterministic function of playback time, built from the same
// tempo-automation-aware timing (gpScore.buildBeatTiming) that also
// positioned every note. The cursor reads the audio engine's clock directly
// every animation frame and sets a CSS transform — no intermediary event
// system to drift out of sync with what's on screen, because what's on
// screen and the cursor position come from the exact same numbers.

interface Props {
  layout: TrackLayout;
  getCurrentTimeMs: () => number;
  scrollContainerRef: React.RefObject<HTMLElement>;
  height: number;
}

export function TabCursor({ layout, getCurrentTimeMs, scrollContainerRef, height }: Props) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function tick() {
      const ms = getCurrentTimeMs();
      const x = timeToX(layout, ms) + LEFT_MARGIN_PX;
      const cursor = cursorRef.current;
      if (cursor) {
        cursor.style.transform = `translateX(${x}px)`;
        cursor.dataset.cursorX = String(x);
      }

      const container = scrollContainerRef.current;
      if (container) {
        const margin = 120;
        const viewLeft = container.scrollLeft;
        const viewRight = viewLeft + container.clientWidth;
        if (x < viewLeft + margin || x > viewRight - margin) {
          container.scrollLeft = Math.max(0, x - container.clientWidth / 2);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [layout, getCurrentTimeMs, scrollContainerRef]);

  return (
    <div
      ref={cursorRef}
      data-testid="tab-cursor"
      className="tab-cursor"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 2,
        height,
        background: "#8b7cf6",
        pointerEvents: "none",
        willChange: "transform",
      }}
    />
  );
}
