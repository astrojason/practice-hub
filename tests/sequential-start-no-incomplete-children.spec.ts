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
  id: 11,
  name: "Chapter 1",
  url: null,
  instrument: null,
  parent_study_material_id: 10,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [],
  meta: { user_study_material: null, sessions: [] },
};

const parent = {
  id: 10,
  name: "Music Theory Book",
  url: null,
  instrument: null,
  parent_study_material_id: null,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [child],
  meta: { user_study_material: null, sessions: [] },
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [],
  study_materials: [parent],
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
  await page.route("**/user-study-material-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        daily_practice_time: 60,
        update_log: "",
        study_material_id: 11,
        rating: 3,
        seconds: 60,
        notes: null,
        created_timestamp: 0,
        updated_timestamp: 0,
      }),
    })
  );

  await page.goto("/");
});

test("starting a sequential session when every child is already complete shows a message instead of doing nothing", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();

  const parentCard = page.locator(".item-card", { hasText: "Music Theory Book" }).first();
  await parentCard.locator('button[title="Expand"]').click();

  const childCard = page.locator(".item-card", { hasText: "Chapter 1" });
  await childCard.locator('button[title="Log session"]').click();
  await page.getByLabel("Duration (sec)").fill("60");
  await page.locator("button", { hasText: "Log Session" }).click();

  // Parent auto-completes once its only child is done.
  await expect(parentCard).toHaveClass(/completed/);

  await parentCard.locator('button[title="Start sequential session"]').click();

  await expect(page.locator(".error-modal")).toBeVisible();
  await expect(page.getByText(/already complete/i)).toBeVisible();
});
