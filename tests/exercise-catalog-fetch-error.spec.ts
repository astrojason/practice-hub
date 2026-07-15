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

const song = {
  id: 100,
  name: "Nutshell",
  artist_id: 1,
  artist_name: "Alice In Chains",
  tuning_id: 1,
  tuning_name: "Standard",
  bpm: null,
  active: true,
  resources: null,
  tags: [],
  seconds: null,
  session_type: "song",
  created_timestamp: 0,
  updated_timestamp: 0,
  meta: { sessions: [] },
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { id: 1, songs: [song] },
  exercises: [],
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
  await page.route("**/exercise/user-catalog", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "catalog lookup failed" }) })
  );

  await page.goto("/");
});

test("a failed historical-exercise-catalog fetch (used for AI chat context) surfaces an error instead of failing silently", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  // Loaded lazily on chat open, not on initial dashboard load — no modal yet.
  await expect(page.locator(".error-modal")).toHaveCount(0);

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  await page.locator(".item-card", { hasText: "Nutshell" }).locator(".btn-chat").click();

  await expect(page.locator(".error-modal")).toBeVisible();
  await expect(page.getByText(/catalog lookup failed/i)).toBeVisible();

  await page.locator(".error-modal-close").click();
  await expect(page.locator(".error-modal")).not.toBeVisible();

  // The rest of the dashboard must still work despite this background fetch failing.
  await expect(page.locator(".item-group", { hasText: "Exercises" })).toBeVisible();
});
