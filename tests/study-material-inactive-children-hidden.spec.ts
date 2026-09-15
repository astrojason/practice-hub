import { test, expect } from "@playwright/test";

const DAY_MS = 86_400_000;
const now = Date.now();
const daysAgo = (n: number) => now - n * DAY_MS;

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

function smSession(id: number, daysAgoOffset: number) {
  return {
    id,
    study_material_id: 501,
    user_id: 1,
    notes: null,
    rating: "Good",
    seconds: 300,
    created_timestamp: daysAgo(daysAgoOffset),
    updated_timestamp: daysAgo(daysAgoOffset),
  };
}

function child(id: number, name: string, inUserList: boolean, sessions: unknown[]) {
  return {
    id,
    name,
    url: null,
    instrument: null,
    parent_study_material_id: 500,
    session_type: "study_material",
    created_timestamp: daysAgo(60),
    updated_timestamp: daysAgo(60),
    child_study_materials: [],
    meta: {
      user_study_material: inUserList ? { user_id: 1, study_material_id: id } : null,
      sessions,
    },
  };
}

// Only "Day 3" is currently in the user's active list -- Day 1/Day 2 were
// already swapped out, but the backend's full course detail still returns
// all three (it always returns the full catalog, active or not).
const activeChild = child(503, "Day 3", true, [smSession(1, 0)]);
const dashboardParent = {
  id: 500,
  name: "30-Day Course",
  url: null,
  instrument: null,
  parent_study_material_id: null,
  session_type: "study_material",
  created_timestamp: daysAgo(60),
  updated_timestamp: daysAgo(60),
  child_study_materials: [activeChild],
  meta: { user_study_material: null, sessions: [] },
};

const fullDetail = {
  ...dashboardParent,
  child_study_materials: [
    child(501, "Day 1", false, [smSession(2, 2)]),
    child(502, "Day 2", false, [smSession(3, 1)]),
    activeChild,
  ],
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fullDetail) })
  );
});

test("only the currently-active child renders, even after the full-course-history fetch returns swapped-out siblings", async ({ page }) => {
  const fullDetailResponse = page.waitForResponse((r) => r.url().includes("/study-material/500"));

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await fullDetailResponse;
  // Give the merge into dashboard state a moment to render.
  await page.waitForTimeout(200);

  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();
  const parentCard = page.locator(".item-card", { hasText: "30-Day Course" }).first();
  await expect(parentCard).toBeVisible();
  await parentCard.locator('button[title="Expand"]').click();

  await expect(page.locator(".item-card", { hasText: "Day 3" })).toBeVisible();
  await expect(page.locator(".item-card", { hasText: "Day 1" })).toHaveCount(0);
  await expect(page.locator(".item-card", { hasText: "Day 2" })).toHaveCount(0);
});
