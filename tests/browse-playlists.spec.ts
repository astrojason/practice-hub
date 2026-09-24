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

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: emptyList,
  to_learn: emptyList,
  project: emptyList,
  playlists: [],
  exercises: [],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

const playlist = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: 1,
  name,
  type: 6,
  session_playlist: false,
  on_dashboard: false,
  locked: false,
  song_count: 3,
  editable: true,
  instruments: [],
  ...extra,
});

let lists: ReturnType<typeof playlist>[];

test.beforeEach(async ({ page }) => {
  lists = [
    playlist(11, "Warmups", { session_playlist: true }),
    playlist(12, "Campfire"),
    playlist(13, "Already Saved", { on_dashboard: true }),
  ];

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
  await page.route("**/song?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ songs: [], total: 0 }) })
  );
  await page.route("**/user-song-list?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user_song_lists: lists, total: lists.length, page: 1, limit: 25 }),
    })
  );

  await page.goto("/");
  await page.getByTitle("Browse").click();
  await page.locator(".browse-tab", { hasText: "Playlists" }).click();
});

test("Playlists tab lists custom playlists alphabetically with their saved state", async ({ page }) => {
  const rows = page.locator(".browse-playlist-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Already Saved");
  await expect(rows.nth(1)).toContainText("Campfire");
  await expect(rows.nth(2)).toContainText("Warmups");

  await expect(rows.nth(0).getByRole("button", { name: "Saved to dashboard" })).toBeVisible();
  await expect(rows.nth(1).getByRole("button", { name: "Save to dashboard" })).toBeVisible();
  await expect(rows.nth(2)).toContainText("Session playlist");
  await expect(rows.nth(1)).not.toContainText("Session playlist");
});

test("saving a playlist PUTs on_dashboard=true and flips the button", async ({ page }) => {
  let body: unknown = null;
  await page.route("**/user-song-list/12/dashboard", (route) => {
    body = route.request().postDataJSON();
    lists = lists.map((l) => (l.id === 12 ? { ...l, on_dashboard: true } : l));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(lists.find((l) => l.id === 12)) });
  });

  const row = page.locator(".browse-playlist-row", { hasText: "Campfire" });
  await row.getByRole("button", { name: "Save to dashboard" }).click();

  await expect(row.getByRole("button", { name: "Saved to dashboard" })).toBeVisible();
  expect(body).toEqual({ on_dashboard: true });
});

test("removing a saved playlist PUTs on_dashboard=false", async ({ page }) => {
  let body: unknown = null;
  await page.route("**/user-song-list/13/dashboard", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(playlist(13, "Already Saved")) });
  });

  const row = page.locator(".browse-playlist-row", { hasText: "Already Saved" });
  await row.getByRole("button", { name: "Saved to dashboard" }).click();

  await expect(row.getByRole("button", { name: "Save to dashboard" })).toBeVisible();
  expect(body).toEqual({ on_dashboard: false });
});

test("a failed save shows the error and leaves the playlist unsaved", async ({ page }) => {
  await page.route("**/user-song-list/12/dashboard", (route) =>
    route.fulfill({ status: 500, contentType: "text/plain", body: "playlist exploded" })
  );

  const row = page.locator(".browse-playlist-row", { hasText: "Campfire" });
  await row.getByRole("button", { name: "Save to dashboard" }).click();

  await expect(page.getByText(/playlist exploded/)).toBeVisible();
  await expect(row.getByRole("button", { name: "Save to dashboard" })).toBeVisible();
});

test("a failed playlist load shows the error", async ({ page }) => {
  await page.route("**/user-song-list?**", (route) =>
    route.fulfill({ status: 500, contentType: "text/plain", body: "lists unavailable" })
  );
  await page.locator(".browse-tab", { hasText: "Songs" }).click();
  await page.locator(".browse-tab", { hasText: "Playlists" }).click();

  await expect(page.getByText(/lists unavailable/)).toBeVisible();
});
