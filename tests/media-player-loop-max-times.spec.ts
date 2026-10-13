import { test, expect } from "./base";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    resources: [{ name: "Practice Video", url: "/path/to/practice.mp4", type: "local_file" }],
    meta: { user_exercise: null, sessions: [] },
  }],
  study_materials: [], chord: null, progression: null, interval: null,
};

test.use({ viewport: { width: 1280, height: 1600 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  const videoBuf = fs.readFileSync(path.join(__dirname, "fixtures", "test-video.mp4"));
  await page.route("**/127.0.0.1:17865/**", (route) => {
    const range = route.request().headers()["range"];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : videoBuf.length - 1;
      return route.fulfill({
        status: 206,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${videoBuf.length}` },
        body: videoBuf.subarray(start, end + 1),
      });
    }
    return route.fulfill({ status: 200, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" }, body: videoBuf });
  });
  await page.goto("/");
});

async function addRegion(page: import("@playwright/test").Page, name: string, start: string, end: string) {
  await page.fill("#loopStart", start);
  await page.fill("#loopEnd", end);
  await page.fill("#regionNameInput", name);
  await page.locator("#addRegionBtn").click();
  await expect(page.locator(".mp-region-item", { hasText: name })).toBeVisible();
}

async function openVideo(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:12", { timeout: 10000 });
}

test("single loop with 'loop x times' stops and returns to the loop start after the last pass", async ({ page }) => {
  await openVideo(page);
  await page.fill("#loopStart", "0:01");
  await page.fill("#loopEnd", "0:02");
  await page.fill("#loopMaxTimes", "2");
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  await expect(page.locator("video")).toHaveJSProperty("paused", true, { timeout: 8000 });
  const t = await page.evaluate(() => document.querySelector("video")!.currentTime);
  expect(Math.abs(t - 1)).toBeLessThan(0.3);
  // Stays stopped.
  await page.waitForTimeout(1500);
  await expect(page.locator("video")).toHaveJSProperty("paused", true);
});

test("single loop with no 'loop x times' keeps looping forever", async ({ page }) => {
  await openVideo(page);
  await page.fill("#loopStart", "0:01");
  await page.fill("#loopEnd", "0:02");
  await expect(page.locator("#loopMaxTimes")).toHaveValue("");
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  await page.waitForTimeout(4500);
  await expect(page.locator("video")).toHaveJSProperty("paused", false);
});

test("loop sequence with 'loop x times' stops after the last lap and returns to the first region", async ({ page }) => {
  await openVideo(page);
  await addRegion(page, "Verse", "0:01", "0:02");
  await addRegion(page, "Chorus", "0:03", "0:04");
  await page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]').check();
  await page.locator(".mp-region-item", { hasText: "Chorus" }).locator('input[type="checkbox"]').check();
  await page.locator('[data-play-mode="sequence"]').click();
  await page.locator("#sequenceLoopToggle").check();
  await page.fill("#sequenceLoopMaxTimes", "2");
  await page.locator("#playSequenceBtn").click();
  await expect(page.locator("#sequenceStatus")).toBeVisible();
  await expect(page.locator("#playSequenceBtn")).toContainText("Play Sequence", { timeout: 10000 });
  await expect(page.locator("video")).toHaveJSProperty("paused", true);
  const t = await page.evaluate(() => document.querySelector("video")!.currentTime);
  expect(Math.abs(t - 1)).toBeLessThan(0.3);
});
