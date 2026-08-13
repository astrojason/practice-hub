import { useEffect, useRef } from "react";
import { timeToX, timeToLine, type TrackLayout } from "../../lib/tabLayout";
import { LEFT_MARGIN_PX, computeStaffMetrics, lineTopY } from "./tabGeometry";

// ─── The deterministic cursor ────────────────────────────────────────────────────
//
// This is the actual fix for the originally reported bug. The old GpViewer
// cursor was an event-driven relay: a rAF loop pushed the audio-engine's
// current time into alphaTab's IExternalMediaSynthOutput, which alphaTab
// then translated back into a cursor position via its own internal MIDI tick
// lookup — two independently-clocked systems bridged every frame.
//
// Here there's no relay: `timeToX`/`timeToLine` (tabLayout.ts) are
// precomputed, deterministic functions of playback time, built from the same
// tempo-automation-aware timing (gpScore.buildBeatTiming) that also
// positioned every note. The cursor reads the audio engine's clock directly
// every animation frame and sets a CSS transform — no intermediary event
// system to drift out of sync with what's on screen, because what's on
// screen and the cursor position come from the exact same numbers.
//
// The page is paginated (multiple staff systems stacked vertically), so the
// cursor needs both an x (line-local, via timeToX) and a y (which staff
// system it's on, via timeToLine) — and auto-scroll follows vertically
// instead of horizontally.

interface Props {
  layout: TrackLayout;
  getCurrentTimeMs: () => number;
  scrollContainerRef: React.RefObject<HTMLElement>;
}

export function TabCursor({ layout, getCurrentTimeMs, scrollContainerRef }: Props) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const metrics = computeStaffMetrics(layout.stringCount);

    function tick() {
      const ms = getCurrentTimeMs();
      const x = timeToX(layout, ms) + LEFT_MARGIN_PX;
      const line = timeToLine(layout, ms);
      const y = lineTopY(line, metrics);
      const cursor = cursorRef.current;
      if (cursor) {
        cursor.style.transform = `translate(${x}px, ${y}px)`;
        cursor.dataset.cursorX = String(x);
        cursor.dataset.cursorY = String(y);
        cursor.dataset.cursorLine = String(line);
      }

      const container = scrollContainerRef.current;
      if (container) {
        const margin = metrics.canvasHeight * 0.5;
        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;
        if (y < viewTop + margin || y + metrics.canvasHeight > viewBottom - margin) {
          container.scrollTop = Math.max(0, y - container.clientHeight / 2 + metrics.canvasHeight / 2);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [layout, getCurrentTimeMs, scrollContainerRef]);

  const metrics = computeStaffMetrics(layout.stringCount);

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
        height: metrics.canvasHeight,
        background: "#8b7cf6",
        pointerEvents: "none",
        willChange: "transform",
      }}
    />
  );
}
