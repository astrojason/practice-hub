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

const initialChild = {
  id: 501,
  name: "Chapter 1",
  url: null,
  instrument: null,
  parent_study_material_id: 500,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [],
  meta: { user_study_material: { user_id: 1, study_material_id: 501 }, sessions: [] },
};

const dashboardParent = {
  id: 500,
  name: "Music Theory Book",
  url: null,
  instrument: null,
  parent_study_material_id: null,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [initialChild],
  meta: { user_study_material: null, sessions: [] },
};

// The dashboard load also fetches full detail for any top-level study material
// that already has children nested onto it, so its streak/staleness reflect
// full course history. Unlike every other entity/field in the API, the real
// GET /study-material/{id} endpoint keys a study material's children
// camelCase ("childStudyMaterials") instead of snake_case
// ("child_study_materials") — this mirrors that real shape.
const fullDetailCamelCase = {
  id: 500,
  name: "Music Theory Book",
  url: null,
  instrument: null,
  parent_study_material_id: null,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  childStudyMaterials: [initialChild],
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
  study_materials: [dashboardParent],
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
  await page.route("**/study-material/500", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fullDetailCamelCase) })
  );
});

test("a study material's children survive the camelCase full-history fetch from GET /study-material/{id}", async ({ page }) => {
  // Registered before navigation: the background full-course-history fetch
  // fires as soon as the dashboard loads, so waiting to register this after
  // the page has already rendered can miss the response entirely.
  const fullDetailResponse = page.waitForResponse((r) => r.url().includes("/study-material/500"));

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);

  // Wait for the background full-course-history fetch to resolve and merge
  // into the dashboard before checking — this is what silently wipes the
  // children if the camelCase field isn't translated.
  await fullDetailResponse;

  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();
  const parentCard = page.locator(".item-card", { hasText: "Music Theory Book" }).first();
  await expect(parentCard).toBeVisible();

  await parentCard.locator('button[title="Expand"]').click();
  await expect(page.locator(".item-card", { hasText: "Chapter 1" })).toBeVisible();
});
