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

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: {
    songs: [
      {
        id: 615,
        name: "Nightrain",
        artist_id: 42,
        artist_name: "Guns n' Roses",
        tuning_id: 1,
        tuning_name: "E♭ standard",
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
      },
    ],
  },
  exercises: [],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

const mockArtists = { artists: [{ id: 42, name: "Guns n' Roses" }] };
const mockTunings = { tunings: [{ id: 1, name: "E♭ standard" }] };

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

test("a failed native file picker in the song edit form is surfaced via ErrorModal, not swallowed", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const songCard = page.locator(".item-card", { hasText: "Nightrain" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();

  await page.locator(".edit-resource-header button", { hasText: "Add" }).click();
  await page.locator(".edit-resource-row select").selectOption("local_file");

  // In a plain browser test context (no Tauri runtime), the dialog plugin's
  // open() call rejects — this must surface via ErrorModal, not vanish.
  await page.locator(".edit-resource-browse").click();

  await expect(page.locator(".error-modal")).toBeVisible();
});
