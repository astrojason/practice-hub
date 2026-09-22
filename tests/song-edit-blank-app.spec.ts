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

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { id: 99, type: 3, name: "Review", session_playlist: false, created_timestamp: 0, updated_timestamp: 0, songs: [] },
  to_learn: { id: 98, type: 4, name: "To Learn", session_playlist: false, created_timestamp: 0, updated_timestamp: 0, songs: [] },
  project: {
    id: 1,
    type: 5,
    name: "Project",
    session_playlist: false,
    created_timestamp: 0,
    updated_timestamp: 0,
    songs: [
      {
        id: 615,
        name: "Mr. Crowley",
        artist_id: 42,
        artist_name: "Ozzy Osbourne",
        tuning_id: 1,
        tuning_name: "Standard",
        bpm: null,
        active: true,
        resources: [],
        tags: ["classic"],
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
      },
    ],
  },
  exercises: [],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

const mockArtists = { artists: [{ id: 42, name: "Ozzy Osbourne" }] };
const mockTunings = { tunings: [{ id: 1, name: "Standard" }] };

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
  await page.goto("/");
});

test("editing a song whose PUT response omits display-only fields (e.g. tags) doesn't blank the app", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  // Simulates a real API response leaner than the dashboard shape: the
  // backend's update endpoint echoes back the row it wrote, not every
  // denormalized display field the dashboard fetch includes.
  await page.route("**/song/615", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const { tags: _tags, ...rest } = mockDashboard.project.songs[0];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rest) });
  });

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const songCard = page.locator(".item-card", { hasText: "Mr. Crowley" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();
  await expect(page.locator(".modal-card", { hasText: "Edit: Mr. Crowley" })).toBeVisible();
  await page.locator('button[type="submit"]', { hasText: "Save" }).click();
  // Wait for the save to actually land (the modal closes on success) before
  // checking the app is still alive — asserting immediately after the click
  // would race the in-flight PUT and pass regardless of the bug.
  await expect(page.locator(".modal-card", { hasText: "Edit: Mr. Crowley" })).toHaveCount(0);

  // The app must still be up and showing the (now-edited) song, not blank.
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await expect(page.locator(".item-card", { hasText: "Mr. Crowley" })).toBeVisible();
});
