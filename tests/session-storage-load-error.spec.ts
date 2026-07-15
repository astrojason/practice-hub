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
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
    // Corrupted/malformed data — simulates a partial write or manual edit.
    localStorage.setItem("ph_completed", "{not valid json");
    localStorage.setItem("ph_skipped", "{not valid json either");
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

test("corrupted locally-stored completed/skipped state surfaces an error instead of silently resetting", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await expect(page.locator(".error-modal")).toBeVisible();
  await expect(page.getByText(/completed|skipped/i).first()).toBeVisible();

  await page.locator(".error-modal-close").click();
  await expect(page.locator(".error-modal")).not.toBeVisible();

  // The rest of the dashboard must still be usable despite the corrupted storage.
  await expect(page.locator(".item-group", { hasText: "Exercises" })).toBeVisible();
});
