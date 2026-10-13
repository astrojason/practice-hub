import { test, expect } from "./base";

// A minimal valid, decodable WAV file (silence) so the audio engine reports a
// real, nonzero duration — region/sequence actions are gated on `dur > 0`.
function makeSilentWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

const makeDashboard = (autoplay?: string) => ({
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [{
    id: 1, name: "Test Exercise", order: 1, session_type: "exercise", parent_exercise_id: null,
    created_timestamp: 0, updated_timestamp: 0, child_exercises: [],
    resources: [{ name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file", ...(autoplay ? { autoplay } : {}) }],
    meta: { user_exercise: null, sessions: [] },
  }],
  study_materials: [], chord: null, progression: null, interval: null,
});


const region = (id: string, name: string, start: number, end: number) => ({
  id, name, start, end, playbackSpeed: 1, speedIncreasePercent: 5, speedIncreaseInterval: 3,
  increaseEnabled: false, createdAt: Number(id.replace(/\D/g, "")) || 1,
});

const savedPreset = (opts: { loop?: boolean }) => ({
  filePath: "/path/to/practice.mp3", mediaType: "audio", playbackSpeed: 1,
  loopStart: opts.loop ? "0.5" : "", loopEnd: opts.loop ? "1.2" : "", loopIncreaseBy: "5", loopIncreaseAt: "3",
  loopIncreaseEnabled: false, loopPlaybackEnabled: true, metronomeBpm: 120,
  pitchSemitones: 0, pitchCents: 0, markers: [], sequenceLoop: false, updatedAt: 1,
  regions: [region("r1", "Verse", 0.5, 1.2), region("r2", "Chorus", 1.5, 2.7)],
  sequenceRegionIds: ["r1", "r2"],
});

async function open(page: import("@playwright/test").Page, autoplay: string | undefined, loop = false) {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeDashboard(autoplay)) }));
  await page.route("**/127.0.0.1:17865/**", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: makeSilentWav(3) }));
  await page.goto("/");
  await page.evaluate((p) => {
    localStorage.setItem("practicePlayerPresets", JSON.stringify({ "/path/to/practice.mp3": p }));
  }, savedPreset({ loop }));
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
}

test("autoplay=full plays the whole file and ignores a saved sequence", async ({ page }) => {
  await open(page, "full");
  await expect(page.locator('button[title="Pause"]')).toBeVisible();
  await expect(page.locator('[data-play-mode="single"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#playSequenceBtn")).not.toContainText("Stop Sequence");
});

test("autoplay=sequence starts the saved sequence", async ({ page }) => {
  await open(page, "sequence");
  await expect(page.locator("#playSequenceBtn")).toContainText("Stop Sequence");
  await expect(page.locator('[data-play-mode="sequence"]')).toHaveAttribute("aria-selected", "true");
});

test("autoplay=none does not start playback, even with a saved sequence", async ({ page }) => {
  await open(page, "none");
  await expect(page.locator('[data-play-mode="single"]')).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(1000);
  await expect(page.locator('button[title="Pause"]')).toHaveCount(0);
  await expect(page.locator("#playSequenceBtn")).not.toContainText("Stop Sequence");
});

test("autoplay=region plays the saved loop region", async ({ page }) => {
  await open(page, "region", true);
  await expect(page.locator('[data-play-mode="single"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('button[title="Pause"]')).toBeVisible();
  await expect(page.locator("#playSequenceBtn")).not.toContainText("Stop Sequence");
});

test("autoplay=region with no saved loop region does not play", async ({ page }) => {
  await open(page, "region", false);
  await expect(page.locator('[data-play-mode="single"]')).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(1000);
  await expect(page.locator('button[title="Pause"]')).toHaveCount(0);
});

test("a resource with no autoplay value plays the whole file", async ({ page }) => {
  await open(page, undefined);
  await expect(page.locator('[data-play-mode="single"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('button[title="Pause"]')).toBeVisible();
  await expect(page.locator("#playSequenceBtn")).not.toContainText("Stop Sequence");
});
