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

// Malformed data: each item names the other as its parent. Study materials are
// strictly two levels (parent + children) — a valid parent is never itself a
// child, so neither of these mutual references is valid. Both items must still
// render (as top-level roots) rather than disappearing into an unreachable cycle.
const itemA = {
  id: 20,
  name: "Item A",
  url: null,
  instrument: null,
  parent_study_material_id: 21,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [],
  meta: { user_study_material: null, sessions: [] },
};

const itemB = {
  id: 21,
  name: "Item B",
  url: null,
  instrument: null,
  parent_study_material_id: 20,
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
  study_materials: [itemA, itemB],
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

  await page.goto("/");
});

test("study materials with mutual/cyclic parent references still render instead of vanishing", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();

  await expect(page.locator(".item-card", { hasText: "Item A" })).toBeVisible();
  await expect(page.locator(".item-card", { hasText: "Item B" })).toBeVisible();
});
