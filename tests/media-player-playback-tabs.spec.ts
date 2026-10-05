import { test, expect } from "./base";

function makeSilentWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
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

const secs = (t: string) => { const [m, s] = t.split(":"); return Number(m) * 60 + Number(s); };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) }));
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.route("**/127.0.0.1:17865/**", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: makeSilentWav(30) }));
  await page.goto("/");
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player__time")).toContainText("0:30", { timeout: 10000 });
  await page.locator('button[title="Pause"]').click();
});

async function saveRegion(page: import("@playwright/test").Page, name: string, skips: number) {
  for (let i = 0; i < skips; i++) await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator('button[title="Set from playhead"]').first().click();
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator('button[title="Set from playhead"]').nth(1).click();
  await page.fill("#regionNameInput", name);
  await page.locator("#addRegionBtn").click();
  await expect(page.locator(".mp-region-item", { hasText: name })).toBeVisible();
}

test("playback section has Single and Sequence tabs; loop/auto-increase/break are Single-only", async ({ page }) => {
  const single = page.locator('[data-play-mode="single"]');
  const sequence = page.locator('[data-play-mode="sequence"]');
  await expect(single).toHaveText("Single");
  await expect(sequence).toHaveText("Sequence");
  await expect(single).toHaveAttribute("aria-selected", "true");

  for (const id of ["#loopPlayback", "#loopIncrease", "#loopBreak", "#singleRegionSelect"]) {
    await expect(page.locator(id)).toBeVisible();
  }
  await expect(page.locator("#playSequenceBtn")).toBeHidden();

  await sequence.click();
  await expect(sequence).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#playSequenceBtn")).toBeVisible();
  await expect(page.locator("#sequenceLoopToggle")).toBeVisible();
  for (const id of ["#loopPlayback", "#loopIncrease", "#loopBreak", "#singleRegionSelect"]) {
    await expect(page.locator(id)).toBeHidden();
  }
});

test("Single tab dropdown plays the entire file or a selected region", async ({ page }) => {
  await saveRegion(page, "Verse", 1);
  await saveRegion(page, "Chorus", 3);

  const select = page.locator("#singleRegionSelect");
  await expect(select.locator("option")).toHaveText(["Entire file", "Verse", "Chorus"]);

  const verse = page.locator(".mp-region-item", { hasText: "Verse" });
  await select.selectOption({ label: "Verse" });
  await expect(verse).toHaveClass(/is-active/);
  await expect(page.locator("#loopStart")).not.toHaveValue("");
  await expect(page.locator("#loopEnd")).not.toHaveValue("");

  await select.selectOption({ label: "Chorus" });
  await expect(page.locator(".mp-region-item", { hasText: "Chorus" })).toHaveClass(/is-active/);
  await expect(verse).not.toHaveClass(/is-active/);

  await select.selectOption({ label: "Entire file" });
  await expect(page.locator(".mp-region-item.is-active")).toHaveCount(0);
  await expect(page.locator("#loopStart")).toHaveValue("");
  await expect(page.locator("#loopEnd")).toHaveValue("");
});

test("clicking a region in the list is reflected in the Single dropdown", async ({ page }) => {
  await saveRegion(page, "Verse", 1);
  await page.locator(".mp-region-item", { hasText: "Verse" }).click();
  await expect(page.locator("#singleRegionSelect option:checked")).toHaveText("Verse");
});

test("switching to the Single tab stops a running sequence", async ({ page }) => {
  await saveRegion(page, "Verse", 1);
  await page.locator(".mp-region-item", { hasText: "Verse" }).locator(".mp-region-select-checkbox").check();
  await page.locator('[data-play-mode="sequence"]').click();
  await page.locator("#playSequenceBtn").click();
  await expect(page.locator("#sequenceStatus")).toBeVisible();

  await page.locator('[data-play-mode="single"]').click();
  await expect(page.locator("#sequenceStatus")).toHaveCount(0);
  await expect(page.locator('[data-play-mode="single"]')).toHaveAttribute("aria-selected", "true");
});
