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

const exerciseNoChildren = {
  id: 503,
  name: "Metronome Drill",
  order: null,
  resources: [],
  parent_exercise_id: null,
  child_exercises: [],
  meta: { user_exercise: null, sessions: [] },
};

const emptyList = { id: 0, type: 0, name: "", session_playlist: false, created_timestamp: 0, updated_timestamp: 0, songs: [] };

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: emptyList,
  to_learn: emptyList,
  project: emptyList,
  exercises: [exerciseNoChildren],
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

  await page.route("**/song?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ songs: [], total: 0, page: 1, limit: 25 }),
    })
  );
});

test("navigating to another view and back does not remount the session view (no re-fetch, timers/state survive)", async ({ page }) => {
  let dashboardFetchCount = 0;
  await page.route("**/user/dashboard**", (route) => {
    dashboardFetchCount++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) });
  });

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  const initialFetchCount = dashboardFetchCount;

  // Start a timer on the exercise so there's in-progress local state to lose.
  await page.locator("button", { hasText: "Exercises" }).click();
  const card = page.locator(".item-card", { hasText: "Metronome Drill" }).first();
  await card.locator('button[title="Start timer"]').click();
  await page.locator('button[title="Close"]').click();
  await expect(card.locator(".item-elapsed")).toBeVisible();

  // Navigate away to Browse and back to Session.
  await page.locator('button[title="Browse catalog"]').click();
  await expect(page.locator(".browse-view")).toBeVisible();
  await page.locator('button[title="Back to session"]').click();

  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  // The dashboard must not have been re-fetched — the session view stayed mounted.
  expect(dashboardFetchCount).toBe(initialFetchCount);

  // The running timer must still be showing elapsed time, not reset back to Start.
  const cardAfter = page.locator(".item-card", { hasText: "Metronome Drill" }).first();
  await expect(cardAfter.locator(".item-elapsed")).toBeVisible();
});
