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

const child = {
  id: 2,
  name: "C Major Scale",
  order: 1,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: 1,
  created_timestamp: 0,
  updated_timestamp: 0,
  child_exercises: [],
  meta: { user_exercise: null, sessions: [] },
};

const parent = {
  id: 1,
  name: "Scales",
  order: 1,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: 0,
  updated_timestamp: 0,
  child_exercises: [child],
  meta: { user_exercise: null, sessions: [] },
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [parent],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

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

  await page.goto("/");
});

test("skipping the only child auto-completes the parent exercise", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();

  const parentCard = page.locator(".item-card", { hasText: "Scales" }).first();
  await parentCard.locator('button[title="Expand"]').click();

  const childCard = page.locator(".item-card", { hasText: "C Major Scale" });
  await childCard.locator('button[title="Skip"]').click();

  await expect(childCard).toHaveClass(/skipped/);
  await expect(parentCard).toHaveClass(/completed/);
});
