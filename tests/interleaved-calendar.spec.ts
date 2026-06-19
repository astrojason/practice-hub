import { test, expect } from "@playwright/test";

// ─── Mock fixtures ────────────────────────────────────────────────────────────

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

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id_token: "fake-id-token",
        refresh_token: "fake-refresh-token",
      }),
    })
  );

  await page.route("**/user/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockUser),
    })
  );

  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockDashboard),
    })
  );

  // Mock practice-plan/today to return empty
  await page.route("**/practice-plan/today*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ day: 1, entries: [] }),
    })
  );

  // Mock practice plans list
  await page.route("**/practice-plan**", (route) => {
    const url = route.request().url();
    if (url.includes("/today")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ day: 1, entries: [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plans: [] }),
    });
  });

  await page.goto("/");
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("Calendar nav button is visible in session view", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await expect(page.locator("button", { hasText: "Calendar" })).toBeVisible();
});

test("Calendar view shows Plan and Today tabs", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator("button", { hasText: "Calendar" }).click();

  await expect(page.locator("button.cal-tab", { hasText: "Plan" })).toBeVisible();
  await expect(page.locator("button.cal-tab", { hasText: "Today" })).toBeVisible();
});

test("Today tab shows empty state message when no entries", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator("button", { hasText: "Calendar" }).click();

  // Click the Today tab
  await page.locator("button", { hasText: "Today" }).click();

  await expect(
    page.locator("text=No practice plan scheduled for today")
  ).toBeVisible();
});
