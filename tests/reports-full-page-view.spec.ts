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

const emptyList = { id: 0, type: 0, name: "", session_playlist: false, created_timestamp: 0, updated_timestamp: 0, songs: [] };

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: emptyList,
  to_learn: emptyList,
  project: emptyList,
  exercises: [],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

const emptyHighlight = {
  mostPracticedSong: null,
  longestPracticeDay: null,
  longestStreakDays: 0,
  longestNonZeroStreak: 0,
  firstPracticeSession: null,
  longestEntityStreaks: { songs: 0, exercises: 0, studyMaterials: 0 },
};

const mockStats = {
  chart: { daily: [], monthly: [], yearly: [] },
  totals: { daily: 0, monthly: 0, yearly: 0, lifetime: 0 },
  totalsByType: { songs: 0, exercises: 0, studyMaterials: 0, openSessions: 0 },
  rangeTotals: {},
  highlights: emptyHighlight,
  rangeHighlights: { all: emptyHighlight },
  rangeLabels: {},
  rangeItems: {},
  userJoinedTimestamp: null,
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

  await page.route("**/user/stats", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockStats) })
  );

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
});

test("Reports opens as a full page view, not a modal", async ({ page }) => {
  await page.locator('button[title="Practice time report"]').click();

  await expect(page.locator(".report-view")).toBeVisible();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await expect(page.locator(".report-total-value", { hasText: "0s" }).first()).toBeVisible();

  await page.locator('button[title="Back to session"]').click();
  await expect(page.locator(".report-view")).not.toBeVisible();
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
});
