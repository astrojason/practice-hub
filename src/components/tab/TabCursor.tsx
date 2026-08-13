import { forwardRef, useImperativeHandle, useRef } from "react";
import { timeToX, timeToLine, type TrackLayout } from "../../lib/tabLayout";
import { LEFT_MARGIN_PX, computeStaffMetrics, lineTopY } from "./tabGeometry";

// ─── The deterministic cursor ────────────────────────────────────────────────────
//
// `timeToX`/`timeToLine` (tabLayout.ts) are precomputed, deterministic
// functions of playback time, built from the same tempo-automation-aware
// timing (gpScore.buildBeatTiming) that also positioned every note. What's on
// screen and the cursor position come from the exact same numbers, so there's
// no risk of the layout and the cursor disagreeing with each other.
//
// The cursor itself does not own a clock or a requestAnimationFrame loop —
// it's purely reactive. GpViewer runs a single rAF loop (the one and only
// place AudioContext.currentTime gets read for rendering) and pushes each
// frame's time into setTimeMs() below via a ref. Two independently-scheduled
// rAF loops each computing their own position independently (the previous
// design: this component ran its own loop alongside useAudioEngine's) is
// exactly the "two clocks" failure mode that produces visible jitter —
// even when both loops are mathematically correct on their own, sampling
// the same continuously-advancing clock at two different, unsynchronized
// rAF callback times is itself a source of disagreement. A single loop
// pushing one reading to every consumer removes that entirely.
//
// The imperative-handle approach (rather than a `timeMs` prop) is
// deliberate too: driving this via React state/props would mean a render
// pass on every single animation frame (60/sec) for a value that only ever
// needs to reach a DOM `style.transform` and a couple of `dataset` fields —
// direct, non-React DOM mutation is the same technique the previous
// self-driving version used, just now triggered externally instead of by
// this component's own loop.
//
// The page is paginated (multiple staff systems stacked vertically), so the
// cursor needs both an x (line-local, via timeToX) and a y (which staff
// system it's on, via timeToLine) — and auto-scroll follows vertically
// instead of horizontally.

export interface TabCursorHandle {
  setTimeMs(ms: number): void;
}

interface Props {
  layout: TrackLayout;
  scrollContainerRef: React.RefObject<HTMLElement>;
}

export const TabCursor = forwardRef<TabCursorHandle, Props>(function TabCursor(
  { layout, scrollContainerRef },
  ref,
) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const metrics = computeStaffMetrics(layout.stringCount);

  useImperativeHandle(
    ref,
    () => ({
      setTimeMs(ms: number) {
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
      },
    }),
    [layout, scrollContainerRef, metrics],
  );

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
});
