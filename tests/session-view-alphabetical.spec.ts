import { test, expect } from "./base";

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

const song = (id: number, name: string) => ({
  id,
  name,
  artist_id: 1,
  artist_name: "Artist",
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
});

const exercise = (id: number, name: string, children: unknown[] = []) => ({
  id,
  name,
  order: id,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: 0,
  updated_timestamp: 0,
  child_exercises: children,
  meta: { user_exercise: null, sessions: [] },
});

const material = (id: number, name: string, children: unknown[] = [], parentId: number | null = null) => ({
  id,
  name,
  url: null,
  instrument: null,
  parent_study_material_id: parentId,
  session_type: "study_material",
  created_timestamp: 0,
  updated_timestamp: 0,
  child_study_materials: children,
  meta: { user_study_material: null, sessions: [] },
});

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [song(1, "zebra"), song(2, "Apple"), song(3, "mango")] },
  to_learn: { songs: [] },
  project: { songs: [song(4, "Yellow"), song(5, "banana"), song(6, "Cherry")] },
  exercises: [
    exercise(10, "Warmup", [exercise(13, "Zigzag"), exercise(14, "alternate"), exercise(15, "Legato")]),
    exercise(11, "arpeggios"),
    exercise(12, "Scales"),
  ],
  study_materials: [
    material(20, "Theory", [material(23, "Rhythm", [], 20), material(24, "chords", [], 20), material(25, "Intervals", [], 20)]),
    material(21, "chords book"),
    material(22, "Ear training"),
  ],
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
  await page.route("**/practice-plan**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(route.request().url().includes("/today") ? { day: 1, entries: [] } : { plans: [] }),
    })
  );
  await page.goto("/");
});

async function openGroup(page: import("@playwright/test").Page, title: string) {
  const group = page.locator(".item-group", { has: page.locator(".item-group-title", { hasText: title }) });
  await group.locator(".item-group-header").click();
  await expect(group.locator(".item-group-body")).toBeVisible();
  return group;
}

const names = async (group: import("@playwright/test").Locator) =>
  (await group.locator(".item-name").allInnerTexts()).map((n) => n.trim());

test("Exercises group and its children are alphabetical", async ({ page }) => {
  const group = await openGroup(page, "Exercises");
  expect(await names(group)).toEqual(["arpeggios", "Scales", "Warmup"]);

  await group.locator(".item-card", { hasText: "Warmup" }).locator('button[title="Expand"]').click();
  expect(await names(group)).toEqual(["arpeggios", "Scales", "Warmup", "alternate", "Legato", "Zigzag"]);
});

test("Study Materials group and its children are alphabetical", async ({ page }) => {
  const group = await openGroup(page, "Study Materials");
  expect(await names(group)).toEqual(["chords book", "Ear training", "Theory"]);

  await group.locator(".item-card", { hasText: "Theory" }).locator('button[title="Expand"]').click();
  expect(await names(group)).toEqual(["chords book", "Ear training", "Theory", "chords", "Intervals", "Rhythm"]);
});

test("Project group is alphabetical", async ({ page }) => {
  const group = await openGroup(page, "Project");
  expect(await names(group)).toEqual(["banana", "Cherry", "Yellow"]);
});

test("Repertoire Review group is alphabetical", async ({ page }) => {
  const group = await openGroup(page, "Repertoire Review");
  expect(await names(group)).toEqual(["Apple", "mango", "zebra"]);
});
