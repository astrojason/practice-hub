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

test("saving, applying, renaming, and deleting a loop region works without crashing (no token/songId — no server sync)", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  // Set a loop range from the playhead, then save it as a region.
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator('button[title="Set from playhead"]').first().click();
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator('button[title="Set from playhead"]').nth(1).click();

  await page.fill("#regionNameInput", "Verse");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Verse" });
  await expect(regionItem).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);

  // Apply the region (click it) — should mark it active.
  await regionItem.click();
  await expect(regionItem).toHaveClass(/is-active/);

  // Deselect
  await page.locator("button", { hasText: "Deselect" }).click();
  await expect(regionItem).not.toHaveClass(/is-active/);

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("editing a region's loop bounds and clicking Update Region changes it in place, without creating a duplicate", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
  await page.locator('button[title="Pause"]').click();

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const setFromPlayhead = page.locator('button[title="Set from playhead"]');

  // Region: 0 -> ~0.9s
  await setFromPlayhead.first().click();
  for (let i = 0; i < 6; i++) await skipForward.click();
  await setFromPlayhead.nth(1).click();
  await page.fill("#regionNameInput", "Verse");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Verse" });
  await expect(regionItem).toBeVisible();
  const originalMeta = await regionItem.locator(".mp-region-meta").textContent();

  // Apply it (seeks back to the region's start), then push the loop end further out.
  await regionItem.click();
  await expect(regionItem).toHaveClass(/is-active/);
  for (let i = 0; i < 12; i++) await skipForward.click();
  await setFromPlayhead.nth(1).click();

  await expect(page.locator("#updateRegionBtn")).toBeVisible();
  await page.locator("#updateRegionBtn").click();

  // Still exactly one "Verse" region — updated in place, not duplicated.
  await expect(page.locator(".mp-region-item", { hasText: "Verse" })).toHaveCount(1);
  await expect(regionItem.locator(".mp-region-meta")).not.toHaveText(originalMeta ?? "");
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("the sequence checkbox sits immediately to the left of the region name, on the same row", async ({ page }) => {
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
  await page.fill("#regionNameInput", "Verse");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Verse" });
  await expect(regionItem).toBeVisible();
  const checkbox = regionItem.locator('input[type="checkbox"]');
  const title = regionItem.locator(".mp-region-title");
  const checkboxBox = await checkbox.boundingBox();
  const titleBox = await title.boundingBox();
  expect(checkboxBox).not.toBeNull();
  expect(titleBox).not.toBeNull();

  // Same row: vertical centers line up within a few pixels.
  const checkboxCenterY = checkboxBox!.y + checkboxBox!.height / 2;
  const titleCenterY = titleBox!.y + titleBox!.height / 2;
  expect(Math.abs(checkboxCenterY - titleCenterY)).toBeLessThan(6);
  // Checkbox to the left of the name.
  expect(checkboxBox!.x).toBeLessThan(titleBox!.x);
});

test("applying a saved region restores its saved tempo, even if the current tempo has since changed", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  // Set tempo to 150% before saving the region, so the region remembers 150%.
  const speedNumberInput = page.locator(".media-player__speed-input");
  await speedNumberInput.fill("1.5");
  await speedNumberInput.blur();
  await expect(page.locator("#speedIndicator")).toHaveText("150%");

  await page.locator('button[title="Set from playhead"]').first().click();
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator('button[title="Set from playhead"]').nth(1).click();
  await page.fill("#regionNameInput", "Fast Part");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Fast Part" });
  await expect(regionItem).toBeVisible();

  // Change tempo away from the region's saved value.
  await speedNumberInput.fill("1.0");
  await speedNumberInput.blur();
  await expect(page.locator("#speedIndicator")).toHaveText("100%");

  // Selecting the region should restore its saved 150% tempo.
  await regionItem.click();
  await expect(regionItem).toHaveClass(/is-active/);
  await expect(page.locator("#speedIndicator")).toHaveText("150%");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("checking a region's sequence checkbox auto-applies its tempo when the playhead enters it during normal playback, and reverts when it leaves", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
  await page.locator('button[title="Pause"]').click();

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const skipBack = page.locator('button[title="Skip back 5%"]');
  const setFromPlayhead = page.locator('button[title="Set from playhead"]');
  const speedNumberInput = page.locator(".media-player__speed-input");
  const speedIndicator = page.locator("#speedIndicator");

  // Region "Slow Part" ~= [0.9s, 1.8s] of the 3s track, saved at 50% tempo.
  for (let i = 0; i < 6; i++) await skipForward.click();
  await setFromPlayhead.first().click();
  for (let i = 0; i < 6; i++) await skipForward.click();
  await setFromPlayhead.nth(1).click();
  await speedNumberInput.fill("0.5");
  await speedNumberInput.blur();
  await page.fill("#regionNameInput", "Slow Part");
  await page.locator("#addRegionBtn").click();

  const regionItem = page.locator(".mp-region-item", { hasText: "Slow Part" });
  await expect(regionItem).toBeVisible();

  // Back to normal tempo, and back to before the region's start (playhead ~0.6s).
  await speedNumberInput.fill("1.0");
  await speedNumberInput.blur();
  for (let i = 0; i < 8; i++) await skipBack.click();
  await expect(speedIndicator).toHaveText("100%");

  // Select the region for auto-tempo (checkbox only — never click/apply the row).
  await regionItem.locator('input[type="checkbox"]').check();
  await expect(regionItem).not.toHaveClass(/is-active/);
  await expect(speedIndicator).toHaveText("100%");

  // Skip forward into the region — tempo should snap to its saved 50%.
  for (let i = 0; i < 3; i++) await skipForward.click();
  await expect(speedIndicator).toHaveText("50%");

  // Skip forward out the far side — tempo should revert to normal.
  for (let i = 0; i < 6; i++) await skipForward.click();
  await expect(speedIndicator).toHaveText("100%");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("the region list scrolls instead of growing unbounded once there are many regions", async ({ page }) => {
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

  for (let i = 1; i <= 8; i++) {
    await page.fill("#regionNameInput", `Region ${i}`);
    await page.locator("#addRegionBtn").click();
    await expect(page.locator(".mp-region-item", { hasText: `Region ${i}` })).toBeVisible();
  }

  const list = page.locator("#regionList");
  const { scrollHeight, clientHeight, overflowY } = await list.evaluate((el) => {
    const style = getComputedStyle(el);
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: style.overflowY };
  });
  expect(overflowY).toMatch(/auto|scroll/);
  expect(scrollHeight).toBeGreaterThan(clientHeight);
});
