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

const exercise = {
  id: 1,
  name: "Scales",
  order: 1,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: 0,
  updated_timestamp: 0,
  child_exercises: [],
  meta: { user_exercise: null, sessions: [] },
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [exercise],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

// 2026-07-25T23:59:50 local time — ten seconds before the day rolls over.
const beforeMidnight = new Date(2026, 6, 25, 23, 59, 50).getTime();
// 2026-07-26T00:00:10 local time — ten seconds after.
const afterMidnight = new Date(2026, 6, 26, 0, 0, 10).getTime();

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: beforeMidnight });

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

test("an item marked complete before midnight stops showing as completed after the day rolls over, without reloading", async ({
  page,
}) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();

  const card = page.locator(".item-card", { hasText: "Scales" });
  await card.locator('button[title="Skip"]').click();
  await expect(card).toHaveClass(/skipped/);

  // Cross midnight while the app stays open — no navigation, no remount.
  await page.clock.setSystemTime(afterMidnight);
  await page.clock.runFor(1000);

  await expect(card).not.toHaveClass(/skipped/);
  await expect(card).not.toHaveClass(/completed/);
});
