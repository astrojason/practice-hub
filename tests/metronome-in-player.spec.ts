import { test, expect } from "@playwright/test";

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
  await page.route("**/127.0.0.1:17865/**", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/mpeg" }, body: Buffer.from([]) }));
  await page.goto("/");
});

test("MediaPlayer's inline metronome toggles, tap-tempos, and follow-speed/count-in checkboxes work without crashing", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();

  const toggle = page.locator("#metronomeToggle");
  await expect(toggle).toHaveText("Start");
  await toggle.click();
  await expect(toggle).toHaveText("Stop");
  await expect(page.locator("#metronomeStatus")).toContainText("On");

  await page.locator("button", { hasText: "Tap" }).click();
  await page.waitForTimeout(150);
  await page.locator("button", { hasText: "Tap" }).click();

  // BPM changes while running phase in gradually (no restart) — just confirm no crash.
  await page.fill("#metronomeBpm", "140");
  await page.locator("#metronomeBpm").blur();
  await page.waitForTimeout(300);

  await page.locator("#metronomeFollowSpeed").click();
  await page.locator("#metronomeCountIn").click();

  await expect(page.locator(".error-modal")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveText("Start");
  await expect(page.locator("#metronomeStatus")).toContainText("Off");
  await expect(page.locator(".error-modal")).toHaveCount(0);
});
