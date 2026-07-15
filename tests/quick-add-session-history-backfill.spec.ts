import { test, expect } from "@playwright/test";

const mockUser = {
  id: 1,
  firebase_uid: "test-uid",
  email: "test@example.com",
  display_name: "Test User",
  daily_minutes_goal: 30,
  timezone: "America/New_York",
  time_practiced_today: 0,
  total_time_practiced: 0,
  max_days_no_review: 7,
  min_days_between_reviews: 1,
  num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

const catalogExercise = {
  id: 55,
  name: "Metronome Drill",
  order: 1,
  resources: null,
  parent_exercise_id: null,
  child_exercises: [],
};

const twoDaysAgo = Date.now() - 2 * 86_400_000;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }),
    })
  );
  await page.route("**/user/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) })
  );
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) })
  );
  await page.route("**/song?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ songs: [], total: 0, page: 1, limit: 25 }) })
  );
  await page.route("**/study-material?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ study_material: [], total: 0, page: 1, limit: 25 }) })
  );
  await page.route("**/exercise?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exercises: [catalogExercise], total: 1, page: 1, limit: 25 }),
    })
  );
  await page.route("**/user-exercise-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user_exercise_sessions: [
          { id: 1, exercise_id: 55, notes: null, rating: "Good", bpm: null, seconds: 120, created_timestamp: twoDaysAgo, updated_timestamp: twoDaysAgo },
        ],
        total: 1,
        page: 1,
        limit: 50,
      }),
    })
  );

  await page.goto("/");
});

test("a quick-added exercise's real practice history is backfilled instead of showing as never practiced", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".session-header-actions button", { hasText: "Quick add" }).click();
  await page.locator(".quick-add-search").fill("Metronome");
  await page.locator(".qa-row", { hasText: "Metronome Drill" }).locator(".qa-row-add").click();
  await page.locator(".quick-add-close").click();

  await page.locator(".item-group", { hasText: "Additional" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Metronome Drill" });
  await card.locator('button[title="Log session"]').click();

  await expect(page.locator(".last-session")).toBeVisible();
  await expect(page.getByText(/2 days ago/i)).toBeVisible();
});
