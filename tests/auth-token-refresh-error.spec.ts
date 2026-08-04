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

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 6, 25, 9, 0, 0) });

  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  // Succeeds during initial load (React StrictMode double-invokes the restore
  // effect in dev, so more than one call happens at mount) — the route is
  // switched to fail only once the app is fully settled, below.
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

test("a failed proactive token refresh surfaces the real error instead of silently forcing sign-out", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  // Let any StrictMode-duplicated mount-time restore calls finish settling.
  await page.clock.runFor(5000);

  // Now the stored refresh token stops working (e.g. revoked mid-session) —
  // only the proactive 50-minute refresh should hit this.
  await page.unroute("**/securetoken.googleapis.com/**");
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "TOKEN_EXPIRED" } }),
    })
  );

  // Cross the 50-minute proactive-refresh interval.
  await page.clock.runFor(51 * 60 * 1000);

  await expect(page.getByRole("button", { name: /Sign in with Google/i })).toBeVisible();
  await expect(page.locator(".error-modal")).toBeVisible();
  await expect(page.getByText(/session couldn't be refreshed/i)).toBeVisible();
  await expect(page.getByText(/TOKEN_EXPIRED/i)).toBeVisible();
});
