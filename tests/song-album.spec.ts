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

const albums = [
  { id: 7, name: "Appetite", artist_id: 42, artist_name: "GnR", year: 1987, track_count: 12 },
  { id: 8, name: "Lies", artist_id: 42, artist_name: "GnR", year: 1988, track_count: 8 },
];

function song(overrides: Record<string, unknown> = {}) {
  return {
    id: 615,
    name: "Nightrain",
    artist_id: 42,
    artist_name: "GnR",
    tuning_id: 1,
    tuning_name: "Standard",
    album_id: 7,
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
    rhythm_difficulty: null,
    rhythm_difficulty_name: null,
    lead_difficulty: null,
    lead_difficulty_name: null,
    rhythm_difficulty_manual: false,
    lead_difficulty_manual: false,
    meta: {
      date_learned: null,
      rhythm_difficulty: null,
      lead_difficulty: null,
      singing_difficulty: null,
      singing_difficulty_name: null,
      song_lists: [],
      sessions: [],
      sections: [],
    },
    ...overrides,
  };
}

let putBodies: Record<string, unknown>[] = [];
let albumPosts: Record<string, unknown>[] = [];
let albumRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  putBodies = [];
  albumPosts = [];
  albumRequests = [];
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
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scale: null,
        key_signature: null,
        overdue: [],
        to_review: { songs: [] },
        to_learn: { songs: [] },
        project: { songs: [song()] },
        exercises: [],
        study_materials: [],
        chord: null,
        progression: null,
        interval: null,
      }),
    })
  );
  await page.route("**/artist**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ artists: [{ id: 42, name: "GnR" }] }) })
  );
  await page.route("**/tuning**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tunings: [{ id: 1, name: "Standard" }] }) })
  );
  await page.route("**/album**", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      albumPosts.push(body);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 9, artist_name: "GnR", ...body }),
      });
    }
    albumRequests.push(req.url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ albums }) });
  });
  await page.route("**/song/615", (route) => {
    if (route.request().method() === "PUT") {
      putBodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(song()) });
    }
    return route.continue();
  });

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  await page.locator(".item-card", { hasText: "Nightrain" }).locator('button[title="Edit"]').click();
});

const save = (page: import("@playwright/test").Page) =>
  page.locator('button[type="submit"]', { hasText: "Save" }).click();

test("the edit form preselects the song's album from the artist's albums", async ({ page }) => {
  const select = page.locator("#ef-album");
  await expect(select).toHaveValue("7");
  await expect(select.locator("option", { hasText: "Lies" })).toHaveCount(1);
  expect(albumRequests.some((u) => u.includes("artist_id=42"))).toBe(true);
});

test("changing the album saves album_id", async ({ page }) => {
  await expect(page.locator("#ef-album")).toHaveValue("7");
  await page.locator("#ef-album").selectOption("8");
  await save(page);
  await expect.poll(() => putBodies.length).toBe(1);
  expect(putBodies[0].album_id).toBe(8);
});

test("choosing no album saves album_id null", async ({ page }) => {
  await expect(page.locator("#ef-album")).toHaveValue("7");
  await page.locator("#ef-album").selectOption("");
  await save(page);
  await expect.poll(() => putBodies.length).toBe(1);
  expect(putBodies[0].album_id).toBeNull();
});

test("a new album can be created inline and assigned to the song", async ({ page }) => {
  await expect(page.locator("#ef-album")).toHaveValue("7");
  await page.locator("#ef-album").selectOption("new");
  await page.locator("#ef-new-album-name").fill("Use Your Illusion");
  await page.locator("#ef-new-album-year").fill("1991");
  await page.locator("#ef-new-album-tracks").fill("16");
  await save(page);
  await expect.poll(() => putBodies.length).toBe(1);
  expect(albumPosts).toEqual([{ name: "Use Your Illusion", artist_id: 42, year: 1991, track_count: 16 }]);
  expect(putBodies[0].album_id).toBe(9);
});
