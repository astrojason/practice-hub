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
        id: 1,
        name: "Project Song",
        artist_id: 1,
        artist_name: "Some Artist",
        tuning_id: 1,
        tuning_name: "Standard",
        bpm: 120,
        active: true,
        resources: [
          { name: "Lyrics", url: "https://example.com/lyrics", type: "url" },
        ],
        tags: [],
        seconds: null,
        session_type: "song",
        created_timestamp: 0,
        updated_timestamp: 0,
        meta: { sessions: [], song_lists: [] },
      },
    ],
  },
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
});

test("a failure opening a plain URL resource is surfaced via ErrorModal, not swallowed", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Project Song" }).first();
  await expect(card).toBeVisible();
  await card.locator('button[title="Start timer"]').click();

  await page.locator(".modal-resource-link", { hasText: "Lyrics" }).click();

  await expect(page.locator(".error-modal")).toBeVisible();
});
