import { test, expect } from "@playwright/test";

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// PitchShifterWorklet (soundtouch.js) + soundtouchWorkletProcessor.js: the
// same SimpleFilter/SoundTouch DSP pipeline the old ScriptProcessorNode-based
// PitchShifter used, reused verbatim, now run on the audio rendering thread
// via AudioWorkletNode instead of the main thread — see the plan doc for why
// (ScriptProcessorNode is a documented source of extra, often
// 200-300ms-plausible, latency invisible to ctx.currentTime/outputLatency).
//
// Tested here in isolation, independent of useAudioEngine.ts, against a real
// (if silent) decodable audio buffer — same buildSilentWav() approach as
// tests/gp-viewer-space-shortcut.spec.ts.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function buildSilentWavBase64(seconds: number): string {
  const sampleRate = 8000;
  const numSamples = Math.round(sampleRate * seconds);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf.toString("base64");
}

test("percentagePlayed advances over real time once connected and running", async ({ page }) => {
  const wavBase64 = buildSilentWavBase64(3);
  const result = await page.evaluate(async (wavBase64) => {
    const { PitchShifterWorklet, loadSoundTouchWorklet } = await import("/src/lib/soundtouch.js");
    const ctx = new AudioContext();
    await loadSoundTouchWorklet(ctx);

    const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer);

    const shifter = new PitchShifterWorklet(ctx, audioBuffer);
    shifter.connect(ctx.destination);

    const initial = shifter.percentagePlayed;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterWait = shifter.percentagePlayed;

    shifter.disconnect();
    return { initial, afterWait };
  }, wavBase64);

  expect(result.initial).toBeCloseTo(0, 0);
  expect(result.afterWait).toBeGreaterThan(result.initial);
});

test("tempo and pitch setters don't throw and are readable back", async ({ page }) => {
  const wavBase64 = buildSilentWavBase64(1);
  const result = await page.evaluate(async (wavBase64) => {
    const { PitchShifterWorklet, loadSoundTouchWorklet } = await import("/src/lib/soundtouch.js");
    const ctx = new AudioContext();
    await loadSoundTouchWorklet(ctx);
    const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer);

    const shifter = new PitchShifterWorklet(ctx, audioBuffer);
    shifter.tempo = 1.5;
    shifter.pitch = 1.2;
    const readBack = { tempo: shifter.tempo, pitch: shifter.pitch };
    shifter.disconnect();
    return readBack;
  }, wavBase64);

  expect(result.tempo).toBe(1.5);
  expect(result.pitch).toBe(1.2);
});

test("seeking via percentagePlayed setter updates the reported position", async ({ page }) => {
  const wavBase64 = buildSilentWavBase64(2);
  const result = await page.evaluate(async (wavBase64) => {
    const { PitchShifterWorklet, loadSoundTouchWorklet } = await import("/src/lib/soundtouch.js");
    const ctx = new AudioContext();
    await loadSoundTouchWorklet(ctx);
    const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer);

    const shifter = new PitchShifterWorklet(ctx, audioBuffer);
    // percentagePlayed's setter expects a 0-1 fraction (matching how
    // useAudioEngine.ts actually calls it: pausedAt / duration), even
    // though the getter reports 0-100 — an existing, established quirk of
    // this library's API carried over verbatim from the original
    // ScriptProcessorNode-based PitchShifter, not something new here.
    shifter.percentagePlayed = 0.5;
    const afterSeek = shifter.percentagePlayed;
    shifter.disconnect();
    return afterSeek;
  }, wavBase64);

  expect(result).toBeCloseTo(50, 0);
});

test("loadSoundTouchWorklet is idempotent per context (adding the module twice doesn't throw)", async ({ page }) => {
  const ok = await page.evaluate(async () => {
    const { loadSoundTouchWorklet } = await import("/src/lib/soundtouch.js");
    const ctx = new AudioContext();
    await loadSoundTouchWorklet(ctx);
    await loadSoundTouchWorklet(ctx);
    return true;
  });
  expect(ok).toBe(true);
});
