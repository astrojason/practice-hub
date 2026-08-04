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

const exerciseNoChildren = {
  id: 1,
  name: "Scales",
  order: 1,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: 0,
  updated_timestamp: 0,
  child_exercises: [],
  meta: { user_exercise: null, sessions: [] },
};

const studyMaterialNoChildren = {
  id: 10,
  name: "Music Theory",
  url: null,
  type: "url",
  instrument: null,
  session_type: "study_material",
  parent_study_material_id: null,
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: [],
  meta: { user_study_material: null, sessions: [] },
};

function makeDashboard(overrides: Record<string, unknown>) {
  return {
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
    ...overrides,
  };
}

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
});

test("adding a child exercise from the session view posts parent_exercise_id and appears expanded", async ({ page }) => {
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeDashboard({ exercises: [exerciseNoChildren] })),
    })
  );

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/exercise/", async (route) => {
    capturedBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 999,
        name: "Warmup A",
        order: 1,
        resources: [],
        session_type: "exercise",
        parent_exercise_id: 1,
        created_timestamp: 0,
        updated_timestamp: 0,
        child_exercises: [],
        meta: { user_exercise: null, sessions: [] },
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();

  const parentCard = page.locator(".item-card", { hasText: "Scales" }).first();
  await expect(parentCard).toBeVisible();
  await parentCard.locator('button[title="Add child"]').click();

  await page.locator("#ace-name").fill("Warmup A");
  await page.locator(".add-child-exercise-form button[type=\"submit\"]").click();

  expect(capturedBody).not.toBeNull();
  expect((capturedBody as { name: string }).name).toBe("Warmup A");
  expect((capturedBody as { parent_exercise_id: number }).parent_exercise_id).toBe(1);

  await expect(page.locator(".item-card", { hasText: "Warmup A" })).toBeVisible();
});

test("adding a child study material from the session view posts parent_study_material_id and appears expanded", async ({ page }) => {
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeDashboard({ study_materials: [studyMaterialNoChildren] })),
    })
  );

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/study-material/", async (route) => {
    capturedBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 998,
        name: "Chapter 1",
        url: "",
        type: "url",
        instrument: null,
        parent_study_material_id: 10,
        session_type: "study_material",
        created_timestamp: 0,
        updated_timestamp: 0,
        child_study_materials: [],
        meta: { user_study_material: null, sessions: [] },
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();

  const parentCard = page.locator(".item-card", { hasText: "Music Theory" }).first();
  await expect(parentCard).toBeVisible();
  await parentCard.locator('button[title="Add child"]').click();

  await page.locator("#acsm-name").fill("Chapter 1");
  await page.locator(".add-child-study-material-form button[type=\"submit\"]").click();

  expect(capturedBody).not.toBeNull();
  expect((capturedBody as { name: string }).name).toBe("Chapter 1");
  expect((capturedBody as { parent_study_material_id: number }).parent_study_material_id).toBe(10);

  await expect(page.locator(".item-card", { hasText: "Chapter 1" })).toBeVisible();
});
