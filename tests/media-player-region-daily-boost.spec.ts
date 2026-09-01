import { test, expect } from "@playwright/test";

// A minimal valid, decodable WAV file (silence) so the audio engine reports a
// real, nonzero duration — region actions are gated on `dur > 0`.
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
    resources: [{ name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file" }],
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

async function openPlayer(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
}

async function backdateRegionBoost(page: import("@playwright/test").Page, regionName: string) {
  await page.evaluate((name) => {
    const raw = localStorage.getItem("practicePlayerPresets");
    const presets = raw ? JSON.parse(raw) : {};
    const preset = presets["/path/to/practice.mp3"];
    const region = preset.regions.find((r: { name: string }) => r.name === name);
    region.lastBoostDate = "2000-01-01";
    localStorage.setItem("practicePlayerPresets", JSON.stringify(presets));
  }, regionName);
}

test("a region with the daily +1% boost enabled nudges its saved speed up once a new day has passed, and doesn't double-nudge the same day", async ({ page }) => {
  await openPlayer(page);
  await page.locator('button[title="Pause"]').click();

  const speedInput = page.locator(".media-player__speed-input");
  await speedInput.fill("0.5");
  await speedInput.blur();
  await expect(page.locator("#speedIndicator")).toHaveText("50%");

  await page.locator('button[title="Set from playhead"]').first().click();
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator('button[title="Set from playhead"]').nth(1).click();
  await page.fill("#regionNameInput", "Verse");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Verse" });
  await expect(regionItem).toBeVisible();

  // Turn on the daily boost for this region — no immediate change to its speed.
  await regionItem.locator('[data-region-action="daily-boost"]').click();
  await expect(regionItem.locator(".mp-region-meta")).toContainText("+1%/day");
  await expect(regionItem.locator(".mp-region-meta")).toContainText("50%");

  // Simulate the boost's baseline having been recorded a long time ago.
  await backdateRegionBoost(page, "Verse");

  // Reload and reopen the player — applying the region should now nudge its speed.
  await page.reload();
  await openPlayer(page);

  const regionItemAfterReload = page.locator(".mp-region-item", { hasText: "Verse" });
  await expect(regionItemAfterReload).toBeVisible();
  await expect(regionItemAfterReload.locator(".mp-region-meta")).toContainText("50%");

  await regionItemAfterReload.click();
  await expect(regionItemAfterReload).toHaveClass(/is-active/);
  await expect(page.locator("#speedIndicator")).toHaveText("51%");
  await expect(regionItemAfterReload.locator(".mp-region-meta")).toContainText("51%");

  // Deselect and re-apply the same day — no further nudge.
  await regionItemAfterReload.click();
  await regionItemAfterReload.click();
  await expect(page.locator("#speedIndicator")).toHaveText("51%");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("the daily boost never pushes a region's speed past 100%", async ({ page }) => {
  await openPlayer(page);
  await page.locator('button[title="Pause"]').click();

  await expect(page.locator("#speedIndicator")).toHaveText("100%");
  await page.locator('button[title="Set from playhead"]').first().click();
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator('button[title="Set from playhead"]').nth(1).click();
  await page.fill("#regionNameInput", "Already Fast");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Already Fast" });
  await expect(regionItem).toBeVisible();
  await regionItem.locator('[data-region-action="daily-boost"]').click();
  await expect(regionItem.locator(".mp-region-meta")).toContainText("+1%/day");

  await backdateRegionBoost(page, "Already Fast");

  await page.reload();
  await openPlayer(page);

  const regionItemAfterReload = page.locator(".mp-region-item", { hasText: "Already Fast" });
  await expect(regionItemAfterReload).toBeVisible();
  await regionItemAfterReload.click();
  await expect(regionItemAfterReload).toHaveClass(/is-active/);
  await expect(page.locator("#speedIndicator")).toHaveText("100%");
  await expect(regionItemAfterReload.locator(".mp-region-meta")).toContainText("100%");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});
