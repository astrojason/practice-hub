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
// AudioContext.currentTime is the single source of truth here: position is
// simply playStartPosition + (nowCtx - playStartCtxTime) * speed. Two
// earlier versions anchored position to the SoundTouch AudioWorkletNode's
// own periodic position reports instead — reasoning that the time-stretcher
// might not track elapsed-time * speed exactly — but introducing that
// second, independently-updating clock and reconciling it against
// ctx.currentTime was itself the source of visible cursor instability
// (vibration, lag). SoundTouch's own math confirms the simple formula is
// exact, not approximate: calculateEffectiveRateAndTempo() computes
// `_tempo = virtualTempo / virtualPitch` and `_rate = virtualRate *
// virtualPitch`, and since this app never sets `rate` (virtualRate stays 1),
// the net input:output frame ratio is `_rate * _tempo = virtualTempo =
// speed` — virtualPitch cancels out exactly, so pitch shifting never
// affects playback duration.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function resolve(
  page: import("@playwright/test").Page,
  state: { playStartCtxTime: number; playStartPosition: number },
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

test("position extrapolates linearly from the play-start anchor via ctx.currentTime elapsed", async ({ page }) => {
  const state = { playStartCtxTime: 10, playStartPosition: 2 };
  const result = await resolve(page, state, 10.5, 1, 1000);
  expect(result.position).toBeCloseTo(2.5, 5);
});

test("position advances proportionally with speed", async ({ page }) => {
  const state = { playStartCtxTime: 0, playStartPosition: 0 };
  const atNormalSpeed = await resolve(page, state, 2, 1, 1000);
  const atDoubleSpeed = await resolve(page, state, 2, 2, 1000);
  expect(atNormalSpeed.position).toBeCloseTo(2, 5);
  expect(atDoubleSpeed.position).toBeCloseTo(4, 5);
});

test("position at the exact play-start moment equals playStartPosition", async ({ page }) => {
  const state = { playStartCtxTime: 5, playStartPosition: 3.5 };
  const result = await resolve(page, state, 5, 1, 1000);
  expect(result.position).toBeCloseTo(3.5, 5);
});

test("position is clamped to duration and never negative", async ({ page }) => {
  const overDuration = await resolve(page, { playStartCtxTime: 0, playStartPosition: 0 }, 100, 1, 10);
  expect(overDuration.position).toBe(10);

  // nowCtx before playStartCtxTime shouldn't happen in practice, but must
  // never produce a negative position.
  const beforePlayStart = await resolve(page, { playStartCtxTime: 5, playStartPosition: 0 }, 0, 1, 10);
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
  const state = { playStartCtxTime: 0, playStartPosition: 0 };
  const withoutLatency = await resolve(page, state, 2, 1, 1000, 0);
  const withLatency = await resolve(page, state, 2, 1, 1000, 0.05);
  expect(withLatency.position - withoutLatency.position).toBeCloseTo(0.05, 5);
});

test("outputLatencySeconds compensation scales with playback speed, like elapsed time does", async ({ page }) => {
  // nowCtx === playStartCtxTime, so elapsed time is zero and the only
  // contribution to position is the latency term itself.
  const state = { playStartCtxTime: 5, playStartPosition: 0 };
  const atDoubleSpeed = await resolve(page, state, 5, 2, 1000, 0.05);
  const atNormalSpeed = await resolve(page, state, 5, 1, 1000, 0.05);
  expect(atDoubleSpeed.position).toBeCloseTo(0.1, 5); // 0.05 * speed 2
  expect(atNormalSpeed.position).toBeCloseTo(0.05, 5); // 0.05 * speed 1
});

test("defaults to zero compensation when outputLatencySeconds is omitted (existing callers unaffected)", async ({ page }) => {
  const state = { playStartCtxTime: 0, playStartPosition: 0 };
  const omitted = await resolve(page, state, 2, 1, 1000);
  const explicitZero = await resolve(page, state, 2, 1, 1000, 0);
  expect(omitted.position).toBeCloseTo(explicitZero.position, 10);
});
