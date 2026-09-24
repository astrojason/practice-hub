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

const emptyList = { id: 0, type: 0, name: "", session_playlist: false, created_timestamp: 0, updated_timestamp: 0, songs: [] };

const song = (id: number, name: string) => ({
  id,
  name,
  artist_id: 42,
  artist_name: "Some Artist",
  tuning_id: 1,
  tuning_name: "Standard",
  bpm: null,
  active: true,
  has_lead: false,
  has_singing: false,
  resources: [],
  tags: [],
  seconds: null,
  session_type: "song",
  created_timestamp: 0,
  updated_timestamp: 0,
  meta: { date_learned: null, difficulty: null, difficulty_name: null, song_lists: [], sessions: [], sections: [] },
});

const playlistList = (id: number, name: string, session_playlist: boolean, songs: unknown[]) => ({
  id,
  user_id: 1,
  name,
  type: 6,
  session_playlist,
  on_dashboard: true,
  created_timestamp: 0,
  updated_timestamp: 0,
  songs,
});

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: emptyList,
  to_learn: emptyList,
  project: emptyList,
  playlists: [
    playlistList(11, "Warmups", true, [song(2, "Zebra Song"), song(1, "Apple Song")]),
    playlistList(12, "Campfire", false, [song(3, "Wagon Wheel")]),
  ],
  exercises: [],
  study_materials: [],
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

test("saved playlists appear as their own groups with their songs alphabetized", async ({ page }) => {
  const group = page.locator(".item-group", { hasText: "Warmups" });
  await expect(group).toBeVisible();
  await expect(page.locator(".item-group", { hasText: "Campfire" })).toBeVisible();
  await expect(group.locator(".item-group-count")).toHaveText("0/2");

  await group.locator(".item-group-header").click();
  const names = await group.locator(".item-card .item-name").allTextContents();
  expect(names.map((n) => n.trim())).toEqual(["Apple Song", "Zebra Song"]);
});

test("only session playlists get a Start button in the header row", async ({ page }) => {
  await expect(page.locator(".item-group", { hasText: "Warmups" }).locator(".item-group-header").getByRole("button", { name: "Start playlist" })).toBeVisible();
  await expect(page.locator(".item-group", { hasText: "Campfire" }).getByRole("button", { name: "Start playlist" })).toHaveCount(0);
});

test("Start runs the playlist as a sequential session without expanding the group", async ({ page }) => {
  const group = page.locator(".item-group", { hasText: "Warmups" });
  await group.getByRole("button", { name: "Start playlist" }).click();

  await expect(group.locator(".item-group-body")).toHaveCount(0);
  await expect(page.locator(".modal-title", { hasText: "Apple Song" })).toBeVisible();
  await expect(page.locator(".modal-subtitle", { hasText: "Warmups · 1 of 2" })).toBeVisible();

  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.locator(".modal-title", { hasText: "Zebra Song" })).toBeVisible();
  await expect(page.locator(".modal-subtitle", { hasText: "Warmups · 2 of 2" })).toBeVisible();

  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.locator(".modal-title")).toHaveCount(0);
});

test("Stop & Save in a playlist session opens the song session form", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Warmups" }).getByRole("button", { name: "Start playlist" }).click();
  await page.getByRole("button", { name: /Stop & Save/ }).click();

  await expect(page.getByText("Focus", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".modal-title", { hasText: "Apple Song" })).toBeVisible();
});
