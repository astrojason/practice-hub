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

test("loop In/Out controls sit in the Markers bar on the same row as the marker buttons, on both tabs", async ({ page }) => {
  const bar = page.locator(".mp-markers-bar");
  await expect(bar.locator("#loopStart")).toBeVisible();
  await expect(bar.locator("#loopEnd")).toBeVisible();
  await expect(bar.locator('[data-loop-nudge="start:-0.01"]')).toBeVisible();
  await expect(bar.locator('[data-loop-nudge="end:+0.001"]')).toBeVisible();

  const addBox = await page.locator("#waveAddMarkerBtn").boundingBox();
  const startBox = await page.locator("#loopStart").boundingBox();
  const endBox = await page.locator("#loopEnd").boundingBox();
  const midY = (b: { y: number; height: number } | null) => (b!.y + b!.height / 2);
  expect(Math.abs(midY(startBox) - midY(addBox))).toBeLessThan(20);
  expect(Math.abs(midY(endBox) - midY(addBox))).toBeLessThan(20);

  // Still available while on the Sequence tab (regions' bounds follow the sequence).
  await page.locator('[data-play-mode="sequence"]').click();
  await expect(page.locator("#loopStart")).toBeVisible();
});
