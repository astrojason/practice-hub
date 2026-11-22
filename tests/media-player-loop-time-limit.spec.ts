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

test("single loop with a time limit stops once the next pass would start at or after it", async ({ page }) => {
  await openVideo(page);
  await page.fill("#loopStart", "0:01");
  await page.fill("#loopEnd", "0:02");
  // 0.03 min = 1.8s: passes of 1s end at 1s (<1.8, go again) and 2s (>=1.8, stop).
  await page.fill("#loopMaxMinutes", "0.03");
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  await expect(page.locator("video")).toHaveJSProperty("paused", true, { timeout: 8000 });
  const t = await page.evaluate(() => document.querySelector("video")!.currentTime);
  expect(Math.abs(t - 1)).toBeLessThan(0.3);
  await page.waitForTimeout(1500);
  await expect(page.locator("video")).toHaveJSProperty("paused", true);
});

test("single loop with no time limit keeps looping", async ({ page }) => {
  await openVideo(page);
  await page.fill("#loopStart", "0:01");
  await page.fill("#loopEnd", "0:02");
  await expect(page.locator("#loopMaxMinutes")).toHaveValue("");
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  await page.waitForTimeout(4500);
  await expect(page.locator("video")).toHaveJSProperty("paused", false);
});

test("loop sequence with a time limit stops at the lap boundary once the limit is reached", async ({ page }) => {
  await openVideo(page);
  await addRegion(page, "Verse", "0:01", "0:02");
  await addRegion(page, "Chorus", "0:03", "0:04");
  await page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]').check();
  await page.locator(".mp-region-item", { hasText: "Chorus" }).locator('input[type="checkbox"]').check();
  await page.locator('[data-play-mode="sequence"]').click();
  await page.locator("#sequenceLoopToggle").check();
  // A lap is 2s; 0.03 min = 1.8s, so it stops after the first lap.
  await page.fill("#sequenceLoopMaxMinutes", "0.03");
  await page.locator("#playSequenceBtn").click();
  await expect(page.locator("#sequenceStatus")).toBeVisible();
  await expect(page.locator("#playSequenceBtn")).toContainText("Play Sequence", { timeout: 10000 });
  await expect(page.locator("video")).toHaveJSProperty("paused", true);
});

test("loop sequence with a time limit longer than a lap runs more than one lap", async ({ page }) => {
  await openVideo(page);
  await addRegion(page, "Verse", "0:01", "0:02");
  await addRegion(page, "Chorus", "0:03", "0:04");
  await page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]').check();
  await page.locator(".mp-region-item", { hasText: "Chorus" }).locator('input[type="checkbox"]').check();
  await page.locator('[data-play-mode="sequence"]').click();
  await page.locator("#sequenceLoopToggle").check();
  await page.fill("#sequenceLoopMaxMinutes", "0.1"); // 6s = 3 laps of 2s
  await page.locator("#playSequenceBtn").click();
  await page.waitForTimeout(3500);
  await expect(page.locator("#sequenceStatus")).toBeVisible(); // still in lap 2
  await expect(page.locator("#playSequenceBtn")).toContainText("Play Sequence", { timeout: 10000 });
});

test("the time limit takes seconds: minutes:seconds and seconds both work, and what isn't a time is marked", async ({ page }) => {
  await openVideo(page);
  const field = page.locator("#loopMaxMinutes");
  await field.fill("0:02");
  await expect(field).toHaveValue("0:02");
  await field.fill("90s");
  await field.blur();
  await expect(field).toHaveValue("90s");
  await expect(field).not.toHaveClass(/is-invalid/);
  await field.fill("soon");
  await field.blur();
  await expect(field).toHaveClass(/is-invalid/);
  await expect(field).toHaveValue("soon");
  await field.fill("1.5");
  await expect(field).not.toHaveClass(/is-invalid/);
});

test("a limit typed as seconds stops the loop like the same limit in minutes", async ({ page }) => {
  await openVideo(page);
  await page.fill("#loopStart", "0:01");
  await page.fill("#loopEnd", "0:02");
  // 2s: passes of 1s end at 1s (<2, go again) and 2s (>=2, stop).
  await page.fill("#loopMaxMinutes", "2s");
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  await expect(page.locator("video")).toHaveJSProperty("paused", true, { timeout: 8000 });
});

test("a limit set while it's already looping counts the time already spent, not from the moment it was typed", async ({ page }) => {
  await openVideo(page);
  await page.fill("#loopStart", "0:01");
  await page.fill("#loopEnd", "0:02");
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  await page.waitForTimeout(2600);
  await page.fill("#loopMaxMinutes", "3s");
  // About 2.6s in, the pass ending at 3s reaches the limit. Counting from the typing it would run 3s more.
  await expect(page.locator("video")).toHaveJSProperty("paused", true, { timeout: 2200 });
});

test("time paused to practise counts toward the limit, like the timer does", async ({ page }) => {
  await openVideo(page);
  await page.fill("#loopStart", "0:01");
  await page.fill("#loopEnd", "0:02");
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  await page.waitForTimeout(300);
  await page.fill("#loopMaxMinutes", "3s");
  await page.evaluate(() => document.querySelector("video")!.pause());
  await page.waitForTimeout(3500);
  // Only ~0.3s of passes were played, but 3.8s have gone by: the next pass end finishes the run.
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  // The first pass end (about 1.7s on) stops it; counting only the passes played it would take about 3.7s.
  await expect(page.locator("video")).toHaveJSProperty("paused", true, { timeout: 3000 });
});

test("the limit is measured on the item's own timer shown in the header, including time before the loop started", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Start timer"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:12", { timeout: 10000 });
  await expect(page.locator(".media-player__session-timer--active")).toBeVisible();
  // The timer has been running since before any looping; let it pass the limit first.
  await page.waitForTimeout(3300);
  await page.fill("#loopStart", "0:01");
  await page.fill("#loopEnd", "0:02");
  await page.fill("#loopMaxMinutes", "3s");
  await page.evaluate(() => { void document.querySelector("video")!.play(); });
  // The timer is already past 3s, so the first pass end (~2s on) is the last: it must not start another.
  await expect(page.locator("video")).toHaveJSProperty("paused", true, { timeout: 2800 });
});

test("a time limit set for a file is remembered for that file, like its other settings", async ({ page }) => {
  await openVideo(page);
  await page.fill("#loopMaxMinutes", "6");
  await page.waitForTimeout(1200); // the file's settings are saved shortly after a change
  await page.reload();
  await openVideo(page);
  await expect(page.locator("#loopMaxMinutes")).toHaveValue("6");
});
