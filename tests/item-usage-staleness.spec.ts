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

// Exercise added 30 days ago, never practiced -> red
const staleRedExercise = {
  id: 1,
  name: "Neglected Scale",
  order: 1,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(30),
  updated_timestamp: daysAgo(30),
  child_exercises: [],
  meta: { user_exercise: null, sessions: [] },
};

// Exercise added 20 days ago, last practiced 10 days ago -> orange
const staleOrangeExercise = {
  id: 2,
  name: "Rusty Arpeggios",
  order: 2,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(20),
  updated_timestamp: daysAgo(20),
  child_exercises: [],
  meta: {
    user_exercise: null,
    sessions: [
      { id: 1, exercise_id: 2, notes: null, rating: "Good", bpm: null, seconds: 60, created_timestamp: daysAgo(10), updated_timestamp: daysAgo(10) },
    ],
  },
};

// Exercise added 20 days ago, practiced yesterday -> no highlight
const freshExercise = {
  id: 3,
  name: "Fresh Chords",
  order: 3,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(20),
  updated_timestamp: daysAgo(20),
  child_exercises: [],
  meta: {
    user_exercise: null,
    sessions: [
      { id: 2, exercise_id: 3, notes: null, rating: "Good", bpm: null, seconds: 60, created_timestamp: daysAgo(1), updated_timestamp: daysAgo(1) },
    ],
  },
};

// Exercise added only 2 days ago, never practiced -> too new to flag
const newExercise = {
  id: 4,
  name: "Brand New Lick",
  order: 4,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(2),
  updated_timestamp: daysAgo(2),
  child_exercises: [],
  meta: { user_exercise: null, sessions: [] },
};

const staleStudyMaterial = {
  id: 10,
  name: "Neglected Theory PDF",
  url: null,
  instrument: null,
  parent_study_material_id: null,
  session_type: "study_material",
  created_timestamp: daysAgo(30),
  updated_timestamp: daysAgo(30),
  child_study_materials: [],
  meta: { user_study_material: null, sessions: [] },
};

const staleProjectSong = {
  id: 20,
  name: "Neglected Song",
  artist_id: 1,
  artist_name: "Some Artist",
  tuning_id: 1,
  tuning_name: "Standard",
  bpm: null,
  has_lead: false,
  has_singing: false,
  active: true,
  resources: null,
  tags: [],
  seconds: null,
  session_type: "song",
  created_timestamp: daysAgo(30),
  updated_timestamp: daysAgo(30),
  rhythm_difficulty: null,
  rhythm_difficulty_name: null,
  lead_difficulty: null,
  lead_difficulty_name: null,
  rhythm_difficulty_manual: false,
  lead_difficulty_manual: false,
  meta: { sessions: [] },
};

// Same "neglected" shape but sitting in Repertoire Review instead of Project —
// staleness tracking is scoped to Project songs only, not review songs.
const staleReviewSong = { ...staleProjectSong, id: 21, name: "Neglected Review Song" };

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [staleReviewSong] },
  to_learn: { songs: [] },
  project: { songs: [staleProjectSong] },
  exercises: [staleRedExercise, staleOrangeExercise, freshExercise, newExercise],
  study_materials: [staleStudyMaterial],
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
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
});

test("exercise unused for 14+ days is highlighted red", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Neglected Scale" });
  await expect(card).toHaveClass(/stale-red/);
});

test("exercise unused for 7-13 days (added 7+ days ago) is highlighted orange", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Rusty Arpeggios" });
  await expect(card).toHaveClass(/stale-orange/);
});

test("recently-practiced exercise is not highlighted", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Fresh Chords" });
  await expect(card).not.toHaveClass(/stale-orange/);
  await expect(card).not.toHaveClass(/stale-red/);
});

test("brand-new exercise (added under 7 days ago) is not highlighted even without a session", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Brand New Lick" });
  await expect(card).not.toHaveClass(/stale-orange/);
  await expect(card).not.toHaveClass(/stale-red/);
});

test("neglected study material is highlighted red", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Neglected Theory PDF" });
  await expect(card).toHaveClass(/stale-red/);
});

test("neglected project song is highlighted red", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Neglected Song" });
  await expect(card).toHaveClass(/stale-red/);
});

test("an equally-neglected Repertoire Review song is not highlighted (tracking is scoped to Project)", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Repertoire Review" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Neglected Review Song" });
  await expect(card).not.toHaveClass(/stale-orange/);
  await expect(card).not.toHaveClass(/stale-red/);
});
