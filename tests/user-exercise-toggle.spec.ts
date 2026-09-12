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

const emptyList = { id: 0, type: 0, name: "", session_playlist: false, created_timestamp: 0, updated_timestamp: 0, songs: [] };

function makeDashboard(overrides: Record<string, unknown>) {
  return {
    scale: null,
    key_signature: null,
    overdue: [],
    to_review: emptyList,
    to_learn: emptyList,
    project: emptyList,
    exercises: [],
    study_materials: [],
    chord: null,
    progression: null,
    interval: null,
    ...overrides,
  };
}

const mockArtists = { artists: [] };
const mockTunings = { tunings: [] };

const exerciseNotAdded = {
  id: 503,
  name: "Metronome Drill",
  order: null,
  resources: [],
  parent_exercise_id: null,
  child_exercises: [],
  meta: { user_exercise: null, sessions: [] },
};

const studyMaterialAlreadyAdded = {
  id: 701,
  name: "Music Theory",
  url: null,
  type: "url",
  instrument: null,
  parent_study_material_id: null,
  childStudyMaterials: [
    { id: 702, name: "Chapter 1", url: null, type: "url", instrument: null, parent_study_material_id: 701, childStudyMaterials: [] },
  ],
  meta: { user_study_material: { user_id: 1, study_material_id: 701 }, sessions: [] },
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

  await page.route("**/artist**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockArtists) })
  );

  await page.route("**/tuning**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockTunings) })
  );

  await page.route("**/song?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ songs: [], total: 0, page: 1, limit: 25 }),
    })
  );
});

test.describe("Browse: add/remove toggle", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/user/dashboard**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeDashboard({})) })
    );
    await page.goto("/");
    await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  });

  test("catalog meta is respected: an already-added exercise shows the in-list state", async ({ page }) => {
    const alreadyAdded = {
      ...exerciseNotAdded,
      meta: { user_exercise: { id: 1, exercise_id: 503, user_id: 1, randomize_sub_exercises: false, use_keys: false, use_scales: false }, sessions: [] },
    };
    await page.route("**/exercise?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ exercises: [alreadyAdded], total: 1, page: 1, limit: 25 }),
      })
    );

    await page.locator('button[title="Browse catalog"]').click();
    await page.locator(".browse-tabs button", { hasText: "Exercises" }).click();

    const row = page.locator(".browse-row", { hasText: "Metronome Drill" });
    await expect(row.locator('button[title="Remove from my exercises"]')).toBeVisible();
  });

  test("clicking the bookmark on a not-yet-added exercise adds it via toggle-user-exercise", async ({ page }) => {
    await page.route("**/exercise?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ exercises: [exerciseNotAdded], total: 1, page: 1, limit: 25 }),
      })
    );

    let capturedUrl = "";
    await page.route("**/exercise/503/toggle-user-exercise", async (route) => {
      capturedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...exerciseNotAdded,
          meta: { user_exercise: { id: 5, exercise_id: 503, user_id: 1, randomize_sub_exercises: false, use_keys: false, use_scales: false }, sessions: [] },
        }),
      });
    });

    await page.locator('button[title="Browse catalog"]').click();
    await page.locator(".browse-tabs button", { hasText: "Exercises" }).click();

    const row = page.locator(".browse-row", { hasText: "Metronome Drill" });
    await row.locator('button[title="Add to my exercises"]').click();

    await expect(row.locator('button[title="Remove from my exercises"]')).toBeVisible();
    expect(capturedUrl).toContain("/exercise/503/toggle-user-exercise");
  });

  test("study material children keyed as childStudyMaterials (camelCase) still expand in Browse", async ({ page }) => {
    await page.route("**/study-material?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ study_material: [studyMaterialAlreadyAdded], total: 1, page: 1, limit: 25 }),
      })
    );

    await page.locator('button[title="Browse catalog"]').click();
    await page.locator(".browse-tabs button", { hasText: "Study Materials" }).click();

    const row = page.locator(".browse-row", { hasText: "Music Theory" });
    await expect(row).toBeVisible();
    await expect(page.locator(".browse-row", { hasText: "Chapter 1" })).not.toBeVisible();
    await row.locator('button[title="Expand"]').click();
    await expect(page.locator(".browse-row", { hasText: "Chapter 1" })).toBeVisible();
  });

  test("a failed toggle surfaces the real error via ErrorModal", async ({ page }) => {
    await page.route("**/exercise?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ exercises: [exerciseNotAdded], total: 1, page: 1, limit: 25 }),
      })
    );

    await page.route("**/exercise/503/toggle-user-exercise", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Something broke on the server" }),
      });
    });

    await page.locator('button[title="Browse catalog"]').click();
    await page.locator(".browse-tabs button", { hasText: "Exercises" }).click();

    const row = page.locator(".browse-row", { hasText: "Metronome Drill" });
    await row.locator('button[title="Add to my exercises"]').click();

    await expect(page.getByText(/Something broke on the server/i)).toBeVisible();
  });
});

test.describe("Dashboard: remove-from-dashboard toggle", () => {
  test("toggling a top-level exercise off removes its card from the dashboard", async ({ page }) => {
    const activeExercise = {
      id: 1,
      name: "Scales",
      order: 1,
      resources: null,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      meta: { user_exercise: { id: 1, exercise_id: 1, user_id: 1, randomize_sub_exercises: false, use_keys: false, use_scales: false }, sessions: [] },
    };
    await page.route("**/user/dashboard**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeDashboard({ exercises: [activeExercise] })),
      })
    );
    await page.route("**/exercise/1/toggle-user-exercise", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...activeExercise, meta: { user_exercise: null, sessions: [] } }),
      });
    });

    await page.goto("/");
    await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
    await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();

    const card = page.locator(".item-card", { hasText: "Scales" }).first();
    await expect(card).toBeVisible();
    await card.locator('button[title="Remove from my exercises"]').click();

    await expect(page.locator(".item-card", { hasText: "Scales" })).toHaveCount(0);
  });

  test("a newly added child can be bookmarked into my exercises from the dashboard", async ({ page }) => {
    const parentExercise = {
      id: 1,
      name: "Scales",
      order: 1,
      resources: null,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      meta: { user_exercise: { id: 1, exercise_id: 1, user_id: 1, randomize_sub_exercises: false, use_keys: false, use_scales: false }, sessions: [] },
    };
    await page.route("**/user/dashboard**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeDashboard({ exercises: [parentExercise] })),
      })
    );
    await page.route("**/exercise/", async (route) => {
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
          meta: { user_exercise: null, sessions: [] },
        }),
      });
    });

    let capturedUrl = "";
    await page.route("**/exercise/999/toggle-user-exercise", async (route) => {
      capturedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...parentExercise,
          child_exercises: [
            {
              id: 999,
              name: "Warmup A",
              order: 1,
              resources: [],
              parent_exercise_id: 1,
              meta: { user_exercise: { id: 9, exercise_id: 999, user_id: 1, randomize_sub_exercises: false, use_keys: false, use_scales: false }, sessions: [] },
            },
          ],
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
    await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();

    const parentCard = page.locator(".item-card", { hasText: "Scales" }).first();
    await parentCard.locator('button[title="Add child"]').click();
    await page.locator("#ace-name").fill("Warmup A");
    await page.locator(".add-child-exercise-form button[type=\"submit\"]").click();

    const childCard = page.locator(".item-card", { hasText: "Warmup A" });
    await expect(childCard).toBeVisible();
    await childCard.locator('button[title="Add to my exercises"]').click();

    expect(capturedUrl).toContain("/exercise/999/toggle-user-exercise");
    await expect(childCard.locator('button[title="Remove from my exercises"]')).toBeVisible();
  });
});
