import { test, expect } from "@playwright/test";

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// These tests exercise `resolvePlaybackPosition`, the pure function in
// useAudioEngine.ts that turns (audio-clock time, wall-clock time) into a
// cursor position for the GP viewer. They call it directly via a dynamic
// import of the source module (served as ESM by the Vite dev server), so no
// real AudioContext, GP file, or audio decode is needed — just a blank page
// to host the import.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function resolve(
  page: import("@playwright/test").Page,
  state: {
    playStartCtxTime: number;
    playStartWallTime: number;
    playStartPosition: number;
    lastCtxSample: number;
    lastCtxSampleWall: number;
  },
  nowCtx: number,
  nowWall: number,
  speed: number,
  duration: number,
  outputLatencySeconds = 0,
) {
  return page.evaluate(
    async ([state, nowCtx, nowWall, speed, duration, outputLatencySeconds]) => {
      const mod = await import("/src/components/player/useAudioEngine.ts");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (mod as any).resolvePlaybackPosition(state, nowCtx, nowWall, speed, duration, outputLatencySeconds);
    },
    [state, nowCtx, nowWall, speed, duration, outputLatencySeconds] as const,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("cursor position tracks the audio clock, not wall-clock, when the two drift apart", async ({ page }) => {
  // Playback "started" with both clocks at 0. Simulate a track that plays for
  // 10 seconds of wall-clock time, but whose audio hardware clock (ctx.currentTime)
  // only advanced 9.8s in that span — a ~2% clock-rate mismatch, well within
  // real-world audio hardware clock drift (tens of ppm to low hundreds of ppm
  // is common; exaggerated here so the test doesn't need to wait 10 real seconds
  // or simulate hundreds of buffer ticks).
  const initialState = {
    playStartCtxTime: 0,
    playStartWallTime: 0,
    playStartPosition: 0,
    lastCtxSample: 0,
    lastCtxSampleWall: 0,
  };

  const result = await resolve(page, initialState, 9.8, 10.0, 1, 1000);

  // The old buggy formula (playStartPosition + wallElapsed * speed) would
  // report 10.0 here — drifting further from the truth every second that
  // passes. The fix must track the audio clock instead.
  expect(result.position).toBeGreaterThanOrEqual(9.8);
  expect(result.position).toBeLessThan(9.9);
});

test("position still interpolates smoothly within a single audio buffer period", async ({ page }) => {
  // Within one ScriptProcessor buffer period, ctx.currentTime doesn't move at
  // all (it only updates once per buffer callback, ~93ms at 4096 samples).
  // The fix must still advance the reported position using wall-clock time in
  // that gap, or the earlier "reduce cursor lag" fix (switching from
  // ctx.currentTime to performance.now()) would regress.
  const initialState = {
    playStartCtxTime: 0,
    playStartWallTime: 0,
    playStartPosition: 0,
    lastCtxSample: 0,
    lastCtxSampleWall: 0,
  };

  // ctx.currentTime hasn't ticked forward yet (still 0), but 40ms of
  // wall-clock time has passed within this same buffer period.
  const result = await resolve(page, initialState, 0, 0.04, 1, 1000);

  expect(result.position).toBeCloseTo(0.04, 2);
});

test("drift correction resets each time the audio clock ticks forward", async ({ page }) => {
  // Simulate two buffer periods: audio clock ticks from 0 -> 0.09 while wall
  // clock runs from 0 -> 0.10 (a mismatch within this one period). After the
  // audio clock ticks, the anchor should resync so the next interpolation
  // window starts fresh rather than carrying forward the prior period's
  // drift.
  const initialState = {
    playStartCtxTime: 0,
    playStartWallTime: 0,
    playStartPosition: 0,
    lastCtxSample: 0,
    lastCtxSampleWall: 0,
  };

  const afterFirstBuffer = await resolve(page, initialState, 0.09, 0.10, 1, 1000);
  // Now interpolate 20ms further into the *next* buffer period without the
  // audio clock having ticked again yet.
  const afterInterpolation = await resolve(
    page,
    { playStartCtxTime: 0, playStartWallTime: 0, playStartPosition: 0, ...afterFirstBuffer },
    0.09,
    0.12,
    1,
    1000,
  );

  // Position should be the resynced audio-clock value (0.09) plus only the
  // 20ms interpolated since the last resync (0.12 - 0.10), not the full
  // 0.12s of wall-clock time since play start.
  expect(afterInterpolation.position).toBeCloseTo(0.11, 2);
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
    playStartCtxTime: 0, playStartWallTime: 0, playStartPosition: 0,
    lastCtxSample: 0, lastCtxSampleWall: 0,
  };
  const withoutLatency = await resolve(page, state, 2, 2, 1, 1000, 0);
  const withLatency = await resolve(page, state, 2, 2, 1, 1000, 0.05);
  expect(withLatency.position - withoutLatency.position).toBeCloseTo(0.05, 5);
});

test("outputLatencySeconds compensation scales with playback speed, like elapsed time does", async ({ page }) => {
  // nowCtx === playStartCtxTime, so elapsed time is zero and the only
  // contribution to position is the latency term itself.
  const state = {
    playStartCtxTime: 5, playStartWallTime: 5, playStartPosition: 0,
    lastCtxSample: 5, lastCtxSampleWall: 5,
  };
  const atDoubleSpeed = await resolve(page, state, 5, 5, 2, 1000, 0.05);
  const atNormalSpeed = await resolve(page, state, 5, 5, 1, 1000, 0.05);
  expect(atDoubleSpeed.position).toBeCloseTo(0.1, 5); // 0.05 * speed 2
  expect(atNormalSpeed.position).toBeCloseTo(0.05, 5); // 0.05 * speed 1
});

test("defaults to zero compensation when outputLatencySeconds is omitted (existing callers unaffected)", async ({ page }) => {
  const state = {
    playStartCtxTime: 0, playStartWallTime: 0, playStartPosition: 0,
    lastCtxSample: 0, lastCtxSampleWall: 0,
  };
  const omitted = await resolve(page, state, 2, 2, 1, 1000);
  const explicitZero = await resolve(page, state, 2, 2, 1, 1000, 0);
  expect(omitted.position).toBeCloseTo(explicitZero.position, 10);
});
