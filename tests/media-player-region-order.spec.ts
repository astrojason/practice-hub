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

async function openPlayer(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
  await page.locator('button[title="Pause"]').click();
}

async function skip(page: import("@playwright/test").Page, times: number) {
  const timeLabel = page.locator(".media-player__time");
  for (let i = 0; i < times; i++) {
    const before = await timeLabel.textContent();
    await page.locator('button[title="Skip forward 5%"]').click();
    await expect(timeLabel).not.toHaveText(before ?? "");
  }
}

// Saves a region from the current playhead: In = playhead, Out = playhead + `len` skips.
async function saveRegionAtPlayhead(page: import("@playwright/test").Page, name: string, len: number) {
  await page.locator('button[title="Set from playhead"]').first().click();
  await skip(page, len);
  await page.locator('button[title="Set from playhead"]').nth(1).click();
  await page.fill("#regionNameInput", name);
  await page.locator("#addRegionBtn").click();
  await expect(page.locator(".mp-region-item", { hasText: name })).toBeVisible();
}

const regionNames = (page: import("@playwright/test").Page) => page.locator(".mp-region-item .mp-region-title");

test("regions are listed in start-time order, not the order they were created", async ({ page }) => {
  await openPlayer(page);

  // "Late" first (starts ≈ 1.5s), then "Early" (starts at 0).
  await skip(page, 10);
  await saveRegionAtPlayhead(page, "Late", 3);
  for (let i = 0; i < 20; i++) await page.locator('button[title="Skip back 5%"]').click(); // clamps at 0
  await expect(page.locator(".media-player__time")).toContainText("0:00 /");
  await saveRegionAtPlayhead(page, "Early", 3);

  await expect(regionNames(page)).toHaveText(["Early", "Late"]);
});

test("moving a region's start past another re-sorts the list", async ({ page }) => {
  await openPlayer(page);

  await saveRegionAtPlayhead(page, "First", 3); // 0 → ≈0.45
  await skip(page, 10);
  await saveRegionAtPlayhead(page, "Second", 3); // ≈1.5 →
  await expect(regionNames(page)).toHaveText(["First", "Second"]);

  // Apply "First", move its whole loop to start after "Second" begins, and update it.
  await page.locator(".mp-region-item", { hasText: "First" }).click();
  await skip(page, 16); // ≈2.4s
  await page.locator('button[title="Set from playhead"]').nth(1).click(); // Out first, so In can land before it
  await page.locator('button[title="Skip back 5%"]').click();
  await page.locator('button[title="Skip back 5%"]').click(); // ≈2.1s
  await page.locator('button[title="Set from playhead"]').first().click();
  await page.locator("#updateRegionBtn").click();

  await expect(regionNames(page)).toHaveText(["Second", "First"]);
});
