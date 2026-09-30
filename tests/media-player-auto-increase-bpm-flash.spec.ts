import { test, expect } from "./base";

// A minimal valid, decodable WAV file (silence) so the audio engine reports a
// real, nonzero duration — region/loop actions are gated on `dur > 0`.
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

const mockDashboard = {
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [{
    id: 1, name: "Test Exercise", order: 1, session_type: "exercise", parent_exercise_id: null,
    created_timestamp: 0, updated_timestamp: 0, child_exercises: [],
    // A resource-level bpm gives the transport-row indicator a base value
    // without needing a saved region.
    resources: [{ name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file", bpm: 100 }],
    meta: { user_exercise: null, sessions: [] },
  }],
  study_materials: [], chord: null, progression: null, interval: null,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.route("**/127.0.0.1:17865/**", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: makeSilentWav(3) }));
  await page.goto("/");
});

async function openPlayerWithShortLoop(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
  await page.locator('button[title="Pause"]').click();

  // Loop 0 → ≈0.45s
  await page.locator('button[title="Set from playhead"]').first().click();
  for (let i = 0; i < 3; i++) {
    const before = await page.locator(".media-player__time").textContent();
    await page.locator('button[title="Skip forward 5%"]').click();
    await expect(page.locator(".media-player__time")).not.toHaveText(before ?? "");
  }
  await page.locator('button[title="Set from playhead"]').nth(1).click();
  await page.locator('button[title="Go to loop start"]').click();
}

test("the bpm indicator flashes {prev} → {next} when the loop auto-increases the tempo, then settles back to a plain value", async ({ page }) => {
  await openPlayerWithShortLoop(page);

  const indicator = page.locator("#regionBpmIndicator");
  await expect(indicator).toHaveText("100 BPM");

  await page.locator("#loopPlayback").check();
  await page.locator("#loopIncrease").check();
  await page.fill("#loopIncreaseBy", "10");
  await page.fill("#loopIncreaseAt", "1");

  await page.locator('button[title="Play"]').click();

  // Once the tempo has auto-increased at least once, the indicator briefly
  // shows the transition instead of jumping straight to the new value.
  await expect(indicator).toHaveText(/^\d+\.\d{2} → \d+\.\d{2} BPM$/, { timeout: 8000 });

  // Stop further loops so nothing else triggers an increase. The flash must stay
  // readable mid-practice (well past the old ~3s), then settle to a plain value.
  await page.locator('button[title="Pause"]').click();
  await page.waitForTimeout(5000);
  await expect(indicator).toHaveText(/→/);
  await expect(indicator).toHaveText(/^\d+ BPM$/, { timeout: 10000 });

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("with no bpm set, the auto-increase still flashes the speed change so it is visibly happening", async ({ page }) => {
  await page.route("**/user/dashboard**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      ...mockDashboard,
      exercises: mockDashboard.exercises.map((e) => ({ ...e, resources: e.resources.map(({ bpm: _bpm, ...r }) => r) })),
    }),
  }));
  await page.reload();
  await openPlayerWithShortLoop(page);

  await page.locator("#loopPlayback").check();
  await page.locator("#loopIncrease").check();
  await page.fill("#loopIncreaseBy", "10");
  await page.fill("#loopIncreaseAt", "1");
  await page.locator('button[title="Play"]').click();

  await expect(page.locator("#regionBpmIndicator")).toHaveText(/^\d+(\.\d+)?% → \d+(\.\d+)?%$/, { timeout: 8000 });
  await expect(page.locator(".error-modal")).toHaveCount(0);
});
