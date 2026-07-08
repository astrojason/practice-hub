import { test, expect } from "@playwright/test";

// ─── Mock fixtures ────────────────────────────────────────────────────────────

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

const overdueSong = {
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
  meta: {},
};

const exerciseWithChildren = {
  id: 1,
  name: "Scales",
  order: 1,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: 0,
  updated_timestamp: 0,
  child_exercises: [
    {
      id: 2,
      name: "C Major Scale",
      order: 1,
      resources: null,
      session_type: "exercise",
      parent_exercise_id: 1,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      meta: { user_exercise: null, sessions: [] },
    },
  ],
  meta: { user_exercise: null, sessions: [] },
};

const studyMaterialWithChildren = {
  id: 10,
  name: "Music Theory Book",
  url: null,
  instrument: null,
  parent_study_material_id: null,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [
    {
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
    },
  ],
  meta: { user_study_material: null, sessions: [] },
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [overdueSong],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [exerciseWithChildren],
  study_materials: [studyMaterialWithChildren],
  chord: null,
  progression: null,
  interval: null,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id_token: "fake-id-token",
        refresh_token: "fake-refresh-token",
      }),
    })
  );

  await page.route("**/user/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockUser),
    })
  );

  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockDashboard),
    })
  );

  await page.route("**/practice-plan/today*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ day: 1, entries: [] }),
    })
  );

  await page.route("**/practice-plan**", (route) => {
    const url = route.request().url();
    if (url.includes("/today")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ day: 1, entries: [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plans: [] }),
    });
  });

  await page.goto("/");
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("Exercises item group starts collapsed", async ({ page }) => {
  const group = page.locator(".item-group", { hasText: "Exercises" });
  await expect(group).toBeVisible();
  await expect(group.locator(".item-group-body")).toHaveCount(0);
});

test("Study Materials item group starts collapsed", async ({ page }) => {
  const group = page.locator(".item-group", { hasText: "Study Materials" });
  await expect(group).toBeVisible();
  await expect(group.locator(".item-group-body")).toHaveCount(0);
});

test("Exercise child list starts collapsed", async ({ page }) => {
  // Ensure the parent Exercises item-group is open, regardless of its own collapse default.
  const group = page.locator(".item-group", { hasText: "Exercises" });
  await expect(group).toBeVisible();
  if ((await group.locator(".item-group-body").count()) === 0) {
    await group.locator(".item-group-header").click();
    await expect(group.locator(".item-group-body")).toBeVisible();
  }

  await expect(page.locator(".item-card", { hasText: "C Major Scale" })).toHaveCount(0);
});

test("Study material child list starts collapsed", async ({ page }) => {
  const group = page.locator(".item-group", { hasText: "Study Materials" });
  await expect(group).toBeVisible();
  if ((await group.locator(".item-group-body").count()) === 0) {
    await group.locator(".item-group-header").click();
    await expect(group.locator(".item-group-body")).toBeVisible();
  }

  await expect(page.locator(".item-card", { hasText: "Chapter 1" })).toHaveCount(0);
});

test("Quick add overdue section starts collapsed", async ({ page }) => {
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const section = page.locator(".qa-section", { hasText: "Overdue" });
  await expect(section).toBeVisible();
  await expect(page.locator(".qa-row", { hasText: "Nutshell" })).toHaveCount(0);
});
