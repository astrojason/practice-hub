import { test, expect } from "./base";

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
    resources: [
      { name: "Practice Video", url: "/path/to/practice.mp4", type: "local_file" },
      { name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file" },
    ],
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
  // The local-file server can't find the resource.
  await page.route("**/127.0.0.1:17865/**", (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/");
});

async function openResource(page: import("@playwright/test").Page, name: string) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: name }).click();
  await expect(page.locator(".media-player")).toBeVisible();
}

test("an error modal appears when a video resource can't be loaded", async ({ page }) => {
  await openResource(page, "Practice Video");
  const modal = page.locator(".error-modal");
  await expect(modal).toBeVisible({ timeout: 10000 });
  await expect(modal).toContainText("practice.mp4");
});

test("an error modal appears when an audio resource can't be loaded", async ({ page }) => {
  await openResource(page, "Practice Track");
  const modal = page.locator(".error-modal");
  await expect(modal).toBeVisible({ timeout: 10000 });
  await expect(modal).toContainText("HTTP 404");
});
