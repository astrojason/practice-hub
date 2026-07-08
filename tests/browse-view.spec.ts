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

const mockDashboard = {
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
};

const mockArtists = { artists: [{ id: 42, name: "Some Artist" }] };
const mockTunings = { tunings: [{ id: 1, name: "Standard" }] };

const catalogSong = {
  id: 900,
  name: "Catalog Song",
  artist_id: 42,
  artist_name: "Some Artist",
  tuning_id: 1,
  tuning_name: "Standard",
  bpm: null,
  active: true,
  resources: [],
  tags: [],
  seconds: null,
  session_type: "song",
  created_timestamp: 0,
  updated_timestamp: 0,
  meta: {
    date_learned: null,
    difficulty: null,
    difficulty_name: null,
    song_lists: [],
    sessions: [],
    sections: [],
  },
};

const exerciseNoChildren = {
  id: 503,
  name: "Metronome Drill",
  order: null,
  resources: [],
  parent_exercise_id: null,
  child_exercises: [],
};

const exerciseWithChild = {
  id: 501,
  name: "Scales",
  order: null,
  resources: [],
  parent_exercise_id: null,
  child_exercises: [
    { id: 502, name: "C Major Scale", order: null, resources: [], parent_exercise_id: 501, child_exercises: [] },
  ],
};

const studyMaterialNoChildren = {
  id: 701,
  name: "Music Theory",
  url: null,
  type: "url",
  instrument: null,
  parent_study_material_id: null,
  child_study_materials: [],
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

  await page.route("**/artist**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockArtists) })
  );

  await page.route("**/tuning**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockTunings) })
  );

  // Default empty songs catalog — BrowseView fetches the Songs tab (its default)
  // on mount regardless of which tab a test cares about; individual tests
  // override this with more specific data when they need it.
  await page.route("**/song?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ songs: [], total: 0, page: 1, limit: 25 }),
    })
  );

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
});

test("Browse nav button opens the browse view and lists catalog songs", async ({ page }) => {
  await page.route("**/song?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ songs: [catalogSong], total: 1, page: 1, limit: 25 }),
    })
  );

  await page.locator('button[title="Browse catalog"]').click();
  await expect(page.locator(".browse-view")).toBeVisible();
  await expect(page.locator(".browse-row", { hasText: "Catalog Song" })).toBeVisible();
});

test("Exercises tab shows collapsed children that expand on click", async ({ page }) => {
  await page.route("**/exercise?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exercises: [exerciseWithChild], total: 1, page: 1, limit: 25 }),
    })
  );

  await page.locator('button[title="Browse catalog"]').click();
  await page.locator(".browse-tabs button", { hasText: "Exercises" }).click();

  await expect(page.locator(".browse-row", { hasText: "Scales" })).toBeVisible();
  await expect(page.locator(".browse-row", { hasText: "C Major Scale" })).not.toBeVisible();

  await page.locator(".browse-row", { hasText: "Scales" }).locator('button[title="Expand"]').click();
  await expect(page.locator(".browse-row", { hasText: "C Major Scale" })).toBeVisible();
});

test("editing a song from browse opens the edit form prefilled and saves via PUT", async ({ page }) => {
  await page.route("**/song?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ songs: [catalogSong], total: 1, page: 1, limit: 25 }),
    })
  );

  let putFired = false;
  await page.route("**/song/900", async (route) => {
    if (route.request().method() === "PUT") {
      putFired = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogSong) });
    } else {
      await route.continue();
    }
  });

  await page.locator('button[title="Browse catalog"]').click();
  const row = page.locator(".browse-row", { hasText: "Catalog Song" });
  await expect(row).toBeVisible();
  await row.locator('button[title="Edit"]').click();

  await expect(page.locator("#ef-name")).toHaveValue("Catalog Song");
  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  expect(putFired).toBe(true);
});

test("adding a child exercise posts to /exercise/ with parent_exercise_id and appears immediately", async ({ page }) => {
  await page.route("**/exercise?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exercises: [exerciseNoChildren], total: 1, page: 1, limit: 25 }),
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
        parent_exercise_id: 503,
        created_timestamp: 0,
        updated_timestamp: 0,
        child_exercises: [],
        meta: { user_exercise: null, sessions: [] },
      }),
    });
  });

  await page.locator('button[title="Browse catalog"]').click();
  await page.locator(".browse-tabs button", { hasText: "Exercises" }).click();

  const row = page.locator(".browse-row", { hasText: "Metronome Drill" });
  await expect(row).toBeVisible();
  await row.locator('button[title="Add child"]').click();

  await page.locator("#ace-name").fill("Warmup A");
  await page.locator(".add-child-exercise-form button[type=\"submit\"]").click();

  expect(capturedBody).not.toBeNull();
  expect((capturedBody as { name: string }).name).toBe("Warmup A");
  expect((capturedBody as { parent_exercise_id: number }).parent_exercise_id).toBe(503);

  await expect(page.locator(".browse-row", { hasText: "Warmup A" })).toBeVisible();
});

test("adding a child study material posts to /study-material/ with parent_study_material_id and appears immediately", async ({ page }) => {
  await page.route("**/study-material?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ study_material: [studyMaterialNoChildren], total: 1, page: 1, limit: 25 }),
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
        parent_study_material_id: 701,
        session_type: "study_material",
        created_timestamp: 0,
        updated_timestamp: 0,
        child_study_materials: [],
        meta: { user_study_material: null, sessions: [] },
      }),
    });
  });

  await page.locator('button[title="Browse catalog"]').click();
  await page.locator(".browse-tabs button", { hasText: "Study Materials" }).click();

  const row = page.locator(".browse-row", { hasText: "Music Theory" });
  await expect(row).toBeVisible();
  await row.locator('button[title="Add child"]').click();

  await page.locator("#acsm-name").fill("Chapter 1");
  await page.locator(".add-child-study-material-form button[type=\"submit\"]").click();

  expect(capturedBody).not.toBeNull();
  expect((capturedBody as { name: string }).name).toBe("Chapter 1");
  expect((capturedBody as { parent_study_material_id: number }).parent_study_material_id).toBe(701);

  await expect(page.locator(".browse-row", { hasText: "Chapter 1" })).toBeVisible();
});

test("a 409 conflict from add-child-exercise is surfaced via ErrorModal, not swallowed", async ({ page }) => {
  await page.route("**/exercise?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exercises: [exerciseNoChildren], total: 1, page: 1, limit: 25 }),
    })
  );

  await page.route("**/exercise/", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "An exercise with this name already exists" }),
    });
  });

  await page.locator('button[title="Browse catalog"]').click();
  await page.locator(".browse-tabs button", { hasText: "Exercises" }).click();

  const row = page.locator(".browse-row", { hasText: "Metronome Drill" });
  await row.locator('button[title="Add child"]').click();
  await page.locator("#ace-name").fill("Metronome Drill");
  await page.locator(".add-child-exercise-form button[type=\"submit\"]").click();

  await expect(page.getByText(/already exists/i)).toBeVisible();
});
