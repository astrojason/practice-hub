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
    resources: [
      { name: "Practice Video", url: "/path/to/practice.mp4", type: "local_file" },
    ],
    meta: { user_exercise: null, sessions: [] },
  }],
  study_materials: [], chord: null, progression: null, interval: null,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  // Records the video element's readyState at the moment play() is called on it —
  // lets a test assert playback wasn't requested before the element had buffered
  // enough to actually paint a frame, without needing to observe real rendering.
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    (window as unknown as { __videoPlayReadyStates: number[] }).__videoPlayReadyStates = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: []) {
      if (this.tagName === "VIDEO") {
        (window as unknown as { __videoPlayReadyStates: number[] }).__videoPlayReadyStates.push(this.readyState);
      }
      return nativePlay.apply(this, args);
    };
  });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
});

// On WebKit, calling play() on a <video> before it has buffered enough to paint a
// frame (readyState < HAVE_FUTURE_DATA) can leave the video decoder desynced from
// the audio track: audio keeps advancing but the picture sticks on the first frame
// until something (e.g. a seek) forces a repaint. This showed up as a real video
// resource freezing every time on first playback, only recoverable by seeking.
// Deliberately delaying the file response (like the metadata-race test above)
// reproduces the readiness gap that used to be raced.
test("play() isn't requested on a freshly-opened video until it has buffered enough to paint a frame", async ({ page }) => {
  const videoBuf = fs.readFileSync(path.join(__dirname, "fixtures", "test-video.mp4"));
  await page.route("**/127.0.0.1:17865/**", async (route) => {
    await new Promise((r) => setTimeout(r, 500)); // simulate metadata/buffering taking a moment
    const range = route.request().headers()["range"];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : videoBuf.length - 1;
      route.fulfill({
        status: 206,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${videoBuf.length}` },
        body: videoBuf.subarray(start, end + 1),
      });
    } else {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(videoBuf.length) },
        body: videoBuf,
      });
    }
  });

  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:12", { timeout: 10000 });

  const readyStates = await page.evaluate(() => (window as unknown as { __videoPlayReadyStates: number[] }).__videoPlayReadyStates);
  expect(readyStates.length).toBeGreaterThan(0);
  for (const rs of readyStates) {
    // HAVE_FUTURE_DATA (3) — enough to actually paint a frame, not just HAVE_METADATA (1).
    expect(rs).toBeGreaterThanOrEqual(3);
  }

  await expect(page.locator(".error-modal")).toHaveCount(0);
});
