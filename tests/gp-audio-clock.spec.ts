import { test, expect } from "@playwright/test";

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// These tests exercise `resolvePlaybackPosition`, the pure function in
// useAudioEngine.ts that turns a playback clock anchor into a cursor
// position for the GP viewer (and MediaPlayer's progress bar). They call it
// directly via a dynamic import of the source module (served as ESM by the
// Vite dev server), so no real AudioContext, GP file, or audio decode is
// needed — just a blank page to host the import.
//
// The clock is anchored to the AudioWorklet's own reported source position
// (posted back from the audio thread roughly every ~58ms — see
// soundtouchWorkletProcessor.js's POSITION_REPORT_INTERVAL_QUANTA), not to
// AudioContext.currentTime extrapolated by a nominal speed multiplier. The
// SoundTouch time-stretcher processes audio in discrete windows (tens of ms
// each) and doesn't consume source samples at a perfectly linear
// elapsed-time * speed rate locally, even though it's correct on average —
// so an estimate that never checks in against the worklet's real, ground-truth
// position drifts (visible as the reported "cursor lags, jumps, then runs
// ahead" bug) instead of self-correcting.
//
// Both sides of the anchor — the worklet's report and the "now" reading —
// are measured on AudioContext.currentTime (nowCtx here), never
// performance.now(). An earlier version tagged each report with a
// performance.now() timestamp taken at postMessage-receipt time on the main
// thread; postMessage delivery has its own scheduling jitter, so an
// accurate position value paired with a jittery timestamp made the cursor
// visibly vibrate. Comparing two points on the same audio-clock timeline
// removes that source of noise entirely.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function resolve(
  page: import("@playwright/test").Page,
  state: {
    playStartCtxTime: number;
    playStartPosition: number;
    lastReportPositionSeconds: number | null;
    lastReportCtxTime: number;
  },
  nowCtx: number,
  speed: number,
  duration: number,
  outputLatencySeconds = 0,
) {
  return page.evaluate(
    async ([state, nowCtx, speed, duration, outputLatencySeconds]) => {
      const mod = await import("/src/components/player/useAudioEngine.ts");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (mod as any).resolvePlaybackPosition(state, nowCtx, speed, duration, outputLatencySeconds);
    },
    [state, nowCtx, speed, duration, outputLatencySeconds] as const,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("before the worklet's first position report arrives, position extrapolates from the play/seek anchor", async ({ page }) => {
  const state = {
    playStartCtxTime: 0,
    playStartPosition: 2,
    lastReportPositionSeconds: null,
    lastReportCtxTime: 0,
  };

  const result = await resolve(page, state, 0.5, 1, 1000);
  expect(result.position).toBeCloseTo(2.5, 5);
});

test("once a real position report has arrived, it — not the play-start anchor — is the source of truth", async ({ page }) => {
  // The worklet reported real position 3.0s (not the 2.5s the naive
  // elapsed-time * speed extrapolation from play start would have predicted
  // at this point) — simulating the time-stretcher having actually consumed
  // source material slightly faster than nominal over that window.
  const state = {
    playStartCtxTime: 0,
    playStartPosition: 0,
    lastReportPositionSeconds: 3.0,
    lastReportCtxTime: 1.0,
  };

  const result = await resolve(page, state, 1.0, 1, 1000);
  // At the instant the report arrived (nowCtx === lastReportCtxTime), the
  // position must equal the report exactly — not the stale play-start-based
  // estimate (which would have been 1.0).
  expect(result.position).toBeCloseTo(3.0, 5);
});

test("position interpolates smoothly via the audio clock since the last report, not since play start", async ({ page }) => {
  const state = {
    playStartCtxTime: 0,
    playStartPosition: 0,
    lastReportPositionSeconds: 3.0,
    lastReportCtxTime: 1.0,
  };

  // 40ms of audio-clock time have passed since the last report (at ctx time
  // 1.0), well within the ~58ms report interval — the position should
  // advance by exactly that much, anchored to the report, not to play start
  // 1.04s ago.
  const result = await resolve(page, state, 1.04, 1, 1000);
  expect(result.position).toBeCloseTo(3.04, 2);
});

test("a later report snaps the interpolation to the new ground truth instead of compounding drift", async ({ page }) => {
  // First report: 3.0s at ctx time 1.0. Interpolating naively to ctx time
  // 1.058 (report interval) would predict 3.058s, but the *next* real report
  // says 3.05s instead (the stretcher ran a hair slower than nominal that
  // window). The next resolve() call must reflect the new report's anchor,
  // not keep compounding forward from the first.
  const afterSecondReport = {
    playStartCtxTime: 0,
    playStartPosition: 0,
    lastReportPositionSeconds: 3.05,
    lastReportCtxTime: 1.058,
  };

  const result = await resolve(page, afterSecondReport, 1.058, 1, 1000);
  expect(result.position).toBeCloseTo(3.05, 5);
});

test("position is clamped to duration and never negative", async ({ page }) => {
  const state = {
    playStartCtxTime: 0,
    playStartPosition: 0,
    lastReportPositionSeconds: 9.9,
    lastReportCtxTime: 0,
  };
  const overDuration = await resolve(page, state, 5, 1, 10);
  expect(overDuration.position).toBe(10);

  const beforeReport = {
    playStartCtxTime: 5,
    playStartPosition: 0,
    lastReportPositionSeconds: null,
    lastReportCtxTime: 0,
  };
  const beforePlayStart = await resolve(page, beforeReport, 0, 1, 10);
  expect(beforePlayStart.position).toBe(0);
});

// ─── Output latency compensation ───────────────────────────────────────────────
//
// AudioContext.outputLatency/baseLatency estimate the delay between the
// graph processing audio and it actually reaching the output device. The
// reported position advances by that amount so it tracks what's actually
// audible right now, not merely what's been scheduled — this is the app's
// documented, real-world direction for cursor/audio sync complaints (see
// useAudioEngine.ts's estimatedOutputLatencySeconds and the audioOffsetMs
// manual escape hatch it approximates automatically).

test("outputLatencySeconds advances the reported position by that amount", async ({ page }) => {
  const state = {
    playStartCtxTime: 0, playStartPosition: 0,
    lastReportPositionSeconds: 2, lastReportCtxTime: 2,
  };
  const withoutLatency = await resolve(page, state, 2, 1, 1000, 0);
  const withLatency = await resolve(page, state, 2, 1, 1000, 0.05);
  expect(withLatency.position - withoutLatency.position).toBeCloseTo(0.05, 5);
});

test("outputLatencySeconds compensation scales with playback speed, like elapsed time does", async ({ page }) => {
  // nowCtx === lastReportCtxTime, so elapsed time is zero and the only
  // contribution to position beyond the report itself is the latency term.
  const state = {
    playStartCtxTime: 5, playStartPosition: 0,
    lastReportPositionSeconds: 0, lastReportCtxTime: 5,
  };
  const atDoubleSpeed = await resolve(page, state, 5, 2, 1000, 0.05);
  const atNormalSpeed = await resolve(page, state, 5, 1, 1000, 0.05);
  expect(atDoubleSpeed.position).toBeCloseTo(0.1, 5); // 0.05 * speed 2
  expect(atNormalSpeed.position).toBeCloseTo(0.05, 5); // 0.05 * speed 1
});

test("defaults to zero compensation when outputLatencySeconds is omitted (existing callers unaffected)", async ({ page }) => {
  const state = {
    playStartCtxTime: 0, playStartPosition: 0,
    lastReportPositionSeconds: 2, lastReportCtxTime: 2,
  };
  const omitted = await resolve(page, state, 2, 1, 1000);
  const explicitZero = await resolve(page, state, 2, 1, 1000, 0);
  expect(omitted.position).toBeCloseTo(explicitZero.position, 10);
});
