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

// Simulates what the Instrumenta API returns: the PROJECT list itself is excluded
// from meta.song_lists (the API only returns *other* lists). The song also belongs
// to a custom list (id 2), which IS included.
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
        tags: [],
        seconds: null,
        session_type: "song",
        created_timestamp: 0,
        updated_timestamp: 0,
        meta: {
          date_learned: null,
          difficulty: null,
          difficulty_name: null,
          // API excludes the PROJECT list (id 1) from song_lists — only other lists appear
          song_lists: [{ id: 2, type: 6, name: "CustomForge" }],
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

test("song edit preserves the project list in song_lists payload", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  // Capture the PUT /song/{id} request body
  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/song/615", async (route) => {
    if (route.request().method() === "PUT") {
      capturedBody = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...mockDashboard.project.songs[0] }),
      });
    } else {
      await route.continue();
    }
  });

  // Open the edit form for Mr. Crowley
  const songCard = page.locator(".item-card", { hasText: "Mr. Crowley" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();

  // Save without changing anything
  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  // The PUT payload must include BOTH the project list (id 1) AND the custom list (id 2)
  expect(capturedBody).not.toBeNull();
  const songLists = (capturedBody as { song_lists: number[] }).song_lists;
  expect(songLists).toContain(1); // PROJECT list — must be preserved
  expect(songLists).toContain(2); // CustomForge — must also be preserved
});

test("song edit for review song preserves the review list in song_lists payload", async ({ page }) => {
  // Override dashboard: put the song in to_review instead of project
  const reviewDash = {
    ...mockDashboard,
    project: { ...mockDashboard.project, songs: [] },
    to_review: {
      id: 99,
      type: 3,
      name: "Review",
      session_playlist: false,
      created_timestamp: 0,
      updated_timestamp: 0,
      songs: [
        {
          ...mockDashboard.project.songs[0],
          meta: {
            ...mockDashboard.project.songs[0].meta,
            song_lists: [{ id: 2, type: 6, name: "CustomForge" }],
          },
        },
      ],
    },
  };

  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewDash) })
  );

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/song/615", async (route) => {
    if (route.request().method() === "PUT") {
      capturedBody = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...mockDashboard.project.songs[0] }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  const songCard = page.locator(".item-card", { hasText: "Mr. Crowley" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();

  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  expect(capturedBody).not.toBeNull();
  const songLists = (capturedBody as { song_lists: number[] }).song_lists;
  // Review list id is protected server-side too, but the client should still send it
  expect(songLists).toContain(99); // REVIEW list — must be preserved
  expect(songLists).toContain(2);  // CustomForge — must also be preserved
});
