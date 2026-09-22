import { test, expect } from "./base";

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

async function openPlayerAndCreateRegion(page: import("@playwright/test").Page, name: string) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  await page.locator('button[title="Set from playhead"]').first().click();
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator('button[title="Set from playhead"]').nth(1).click();
  await page.fill("#regionNameInput", name);
}

test("a region can be saved with a bpm, shown in its list entry", async ({ page }) => {
  await openPlayerAndCreateRegion(page, "Verse");
  await page.fill("#regionBpmInput", "120");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Verse" });
  await expect(regionItem).toBeVisible();
  await expect(regionItem.locator(".mp-region-meta")).toContainText("120 BPM");
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("a region's bpm-adjusted-for-speed value is shown live and updates as playback speed changes", async ({ page }) => {
  await openPlayerAndCreateRegion(page, "Verse");
  await page.fill("#regionBpmInput", "120");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Verse" });
  await regionItem.click();
  await expect(regionItem).toHaveClass(/is-active/);

  // At full speed, the effective bpm equals the region's own bpm.
  await expect(page.locator("#regionBpmIndicator")).toHaveText("120 BPM");

  // Drop to 80% speed — the displayed value must recalculate live (120 * 0.8 = 96).
  const speedNumberInput = page.locator(".media-player__speed-input");
  await speedNumberInput.fill("0.8");
  await speedNumberInput.blur();
  await expect(page.locator("#speedIndicator")).toHaveText("80%");
  await expect(page.locator("#regionBpmIndicator")).toHaveText("96 BPM");
});

test("a saved region's list entry reports its bpm as adjusted by its own saved speed", async ({ page }) => {
  await openPlayerAndCreateRegion(page, "Slow Part");
  const speedNumberInput = page.locator(".media-player__speed-input");
  await speedNumberInput.fill("0.5");
  await speedNumberInput.blur();
  await expect(page.locator("#speedIndicator")).toHaveText("50%");
  await page.fill("#regionBpmInput", "140");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Slow Part" });
  await expect(regionItem).toBeVisible();
  // 140 native bpm at the region's own saved 50% speed -> 70 effective bpm.
  await expect(regionItem.locator(".mp-region-meta")).toContainText("70 BPM");
});
