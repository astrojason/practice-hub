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

// "Chapter 1" references a parent (id 999) that isn't included in the dashboard
// response — SessionView fetches it separately and must nest it correctly.
const orphanChild = {
  id: 11,
  name: "Chapter 1",
  url: null,
  instrument: null,
  parent_study_material_id: 999,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [],
  meta: { user_study_material: null, sessions: [] },
};

const fetchedParent = {
  id: 999,
  name: "Music Theory Book",
  url: null,
  instrument: null,
  parent_study_material_id: null,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [],
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
  study_materials: [orphanChild],
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
  await page.route("**/study-material/999", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fetchedParent) })
  );

  await page.goto("/");
});

test("a successful orphan-parent lookup nests the child under the fetched parent, with no error shown", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);

  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();

  const parentCard = page.locator(".item-card", { hasText: "Music Theory Book" }).first();
  await expect(parentCard).toBeVisible();
  await expect(page.locator(".item-card", { hasText: "Chapter 1" })).toHaveCount(0);

  await parentCard.locator('button[title="Expand"]').click();
  await expect(page.locator(".item-card", { hasText: "Chapter 1" })).toBeVisible();
});
