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

const mockArtists = { artists: [{ id: 42, name: "Guns n' Roses" }] };
const mockTunings = { tunings: [{ id: 1, name: "Standard" }] };

function baseSong(overrides: Record<string, unknown> = {}) {
  return {
    id: 615,
    name: "Nightrain",
    artist_id: 42,
    artist_name: "Guns n' Roses",
    tuning_id: 1,
    tuning_name: "Standard",
    bpm: null,
    has_lead: false,
    has_singing: false,
    active: true,
    resources: [],
    tags: [],
    seconds: null,
    session_type: "song",
    created_timestamp: 0,
    updated_timestamp: 0,
    meta: {
      date_learned: null,
      rhythm_difficulty: null,
      lead_difficulty: null,
      singing_difficulty: null,
      singing_difficulty_name: null,
      rhythm_difficulty_manual: false,
      lead_difficulty_manual: false,
      song_lists: [],
      sessions: [],
      sections: [],
    },
    ...overrides,
  };
}

function dashboardWithSong(song: Record<string, unknown>) {
  return {
    scale: null,
    key_signature: null,
    overdue: [],
    to_review: { songs: [] },
    to_learn: { songs: [] },
    project: { songs: [song] },
    exercises: [],
    study_materials: [],
    chord: null,
    progression: null,
    interval: null,
  };
}

async function setupCommonRoutes(page: import("@playwright/test").Page, dashboard: unknown) {
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboard) })
  );
  await page.route("**/artist**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockArtists) })
  );
  await page.route("**/tuning**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockTunings) })
  );
}

test("song edit form hides Lead/Singing difficulty controls until their checkboxes are checked, and saves per-aspect values", async ({ page }) => {
  const song = baseSong({ meta: { ...baseSong().meta, rhythm_difficulty: 40 } });
  await setupCommonRoutes(page, dashboardWithSong(song));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/song/615", async (route) => {
    if (route.request().method() === "PUT") {
      capturedBody = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(song) });
    } else {
      await route.continue();
    }
  });

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const songCard = page.locator(".item-card", { hasText: "Nightrain" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();

  // Lead/Singing difficulty controls are not rendered while has_lead/has_singing are false.
  await expect(page.locator("#ef-diff-lead")).not.toBeVisible();
  await expect(page.locator("#ef-diff-singing")).not.toBeVisible();
  await expect(page.locator("#ef-diff-rhythm")).toBeVisible();

  await page.getByText("Has Lead part").click();
  await page.getByText("Has Singing part").click();

  await expect(page.locator("#ef-diff-lead")).toBeVisible();
  await expect(page.locator("#ef-diff-singing")).toBeVisible();

  await page.locator("#ef-diff-rhythm").fill("65");
  await page.locator("#ef-diff-lead").fill("80");
  await page.locator("#ef-diff-singing").selectOption("70");

  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  expect(capturedBody).not.toBeNull();
  const body = capturedBody as unknown as Record<string, unknown>;
  expect(body.has_lead).toBe(true);
  expect(body.has_singing).toBe(true);
  expect(body.rhythm_difficulty).toBe(65);
  expect(body.lead_difficulty).toBe(80);
  expect(body.singing_difficulty).toBe(70);
});

test("song edit form clears lead difficulty when Has Lead part is unchecked before save", async ({ page }) => {
  const song = baseSong({
    has_lead: true,
    has_singing: true,
    meta: {
      ...baseSong().meta,
      rhythm_difficulty: 40,
      lead_difficulty: 55,
      singing_difficulty: 30,
    },
  });
  await setupCommonRoutes(page, dashboardWithSong(song));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/song/615", async (route) => {
    if (route.request().method() === "PUT") {
      capturedBody = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(song) });
    } else {
      await route.continue();
    }
  });

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const songCard = page.locator(".item-card", { hasText: "Nightrain" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();

  await expect(page.locator("#ef-diff-lead")).toHaveValue("55");

  await page.getByText("Has Lead part").click();
  await expect(page.locator("#ef-diff-lead")).not.toBeVisible();

  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  expect(capturedBody).not.toBeNull();
  const body = capturedBody as unknown as Record<string, unknown>;
  expect(body.has_lead).toBe(false);
  expect(body.lead_difficulty).toBeNull();
  // Singing was untouched and should still round-trip.
  expect(body.has_singing).toBe(true);
  expect(body.singing_difficulty).toBe(30);
});

test("song session form only shows rating pickers for aspects the song has, and posts null for the rest", async ({ page }) => {
  const song = baseSong({ has_lead: true, has_singing: false });
  await setupCommonRoutes(page, dashboardWithSong(song));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/user-song-session", async (route) => {
    capturedBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ daily_practice_time: 300 }),
    });
  });

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const songCard = page.locator(".item-card", { hasText: "Nightrain" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Log session"]').click();

  await expect(page.getByLabel("Lead")).toBeVisible();
  await expect(page.getByLabel("Singing")).toHaveCount(0);

  // Rhythm defaults to Neutral; bump Lead to Good.
  await page.getByLabel("Lead").selectOption("4");
  await page.getByLabel("Duration (sec)").fill("60");

  await page.locator('button[type="submit"]', { hasText: "Log Session" }).click();

  expect(capturedBody).not.toBeNull();
  const body = capturedBody as unknown as Record<string, unknown>;
  expect(body.rhythm_rating).toBe(3);
  expect(body.lead_rating).toBe(4);
  expect(body.singing_rating).toBeNull();
});

test("AI chat button flags struggling per-aspect: a bad Lead streak triggers it even when Rhythm is fine", async ({ page }) => {
  const now = Date.now();
  const strugglingSong = baseSong({
    id: 615,
    name: "Nightrain",
    has_lead: true,
    has_singing: false,
    meta: {
      ...baseSong().meta,
      sessions: [
        { id: 3, song_id: 615, user_id: 1, focus: null, bpm: null, rhythm_rating: "Great", lead_rating: "Awful", singing_rating: null, seconds: 60, notes: null, from_memory: false, created_timestamp: now, updated_timestamp: now },
        { id: 2, song_id: 615, user_id: 1, focus: null, bpm: null, rhythm_rating: "Great", lead_rating: "Bad", singing_rating: null, seconds: 60, notes: null, from_memory: false, created_timestamp: now - 1000, updated_timestamp: now - 1000 },
        { id: 1, song_id: 615, user_id: 1, focus: null, bpm: null, rhythm_rating: "Great", lead_rating: "Awful", singing_rating: null, seconds: 60, notes: null, from_memory: false, created_timestamp: now - 2000, updated_timestamp: now - 2000 },
      ],
    },
  });
  const healthySong = baseSong({
    id: 616,
    name: "Paradise City",
    has_lead: true,
    has_singing: false,
    meta: {
      ...baseSong().meta,
      sessions: [
        { id: 6, song_id: 616, user_id: 1, focus: null, bpm: null, rhythm_rating: "Great", lead_rating: "Good", singing_rating: null, seconds: 60, notes: null, from_memory: false, created_timestamp: now, updated_timestamp: now },
        { id: 5, song_id: 616, user_id: 1, focus: null, bpm: null, rhythm_rating: "Great", lead_rating: "Good", singing_rating: null, seconds: 60, notes: null, from_memory: false, created_timestamp: now - 1000, updated_timestamp: now - 1000 },
        { id: 4, song_id: 616, user_id: 1, focus: null, bpm: null, rhythm_rating: "Great", lead_rating: "Good", singing_rating: null, seconds: 60, notes: null, from_memory: false, created_timestamp: now - 2000, updated_timestamp: now - 2000 },
      ],
    },
  });
  const dashboard = {
    scale: null,
    key_signature: null,
    overdue: [],
    to_review: { songs: [] },
    to_learn: { songs: [] },
    project: { songs: [strugglingSong, healthySong] },
    exercises: [],
    study_materials: [],
    chord: null,
    progression: null,
    interval: null,
  };
  await setupCommonRoutes(page, dashboard);
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();

  const strugglingCard = page.locator(".item-card", { hasText: "Nightrain" });
  const healthyCard = page.locator(".item-card", { hasText: "Paradise City" });
  await expect(strugglingCard).toBeVisible();
  await expect(healthyCard).toBeVisible();

  await expect(strugglingCard.locator('button[title="AI chat"]')).toHaveClass(/btn-chat--struggling/);
  await expect(healthyCard.locator('button[title="AI chat"]')).not.toHaveClass(/btn-chat--struggling/);
});
