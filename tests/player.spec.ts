import { test, expect } from "@playwright/test";

// ─── Mock fixtures ────────────────────────────────────────────────────────────

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
  project: { songs: [] },
  exercises: [
    {
      id: 1,
      name: "Test Exercise",
      order: 1,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      resources: [
        {
          name: "Practice Track",
          url: "/path/to/practice.mp3",
          type: "local_file",
        },
      ],
      meta: {
        user_exercise: null,
        sessions: [],
      },
    },
  ],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Inject a fake refresh token so the auth flow skips the sign-in screen.
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  // Mock the Firebase token refresh to return a fake ID token.
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id_token: "fake-id-token",
        refresh_token: "fake-refresh-token",
      }),
    })
  );

  // Mock the user profile endpoint.
  await page.route("**/user/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockUser),
    })
  );

  // Mock the dashboard endpoint.
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockDashboard),
    })
  );

  // Mock the local file server so fetching audio doesn't fail.
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
      body: Buffer.from([]),
    })
  );

  await page.goto("/");
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("opens MediaPlayer when a local_file resource is clicked", async ({ page }) => {
  // Wait for the session view to appear (header title is always rendered).
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  // Click the log (plus) button on the exercise card to open the session modal.
  const card = page.locator(".item-card").first();
  await expect(card).toBeVisible();
  await card.locator('button[title="Log session"]').click();

  // The modal should appear with the local_file resource button.
  const resourceBtn = page.locator(".modal-resource-link--local", { hasText: "Practice Track" });
  await expect(resourceBtn).toBeVisible();

  // Click the resource button — this should open the MediaPlayer panel.
  await resourceBtn.click();

  // The MediaPlayer panel should now be visible.
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__item-name", { hasText: "Test Exercise" })).toBeVisible();
});

test("closes MediaPlayer when the close button is clicked", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();

  // Clicking a local_file resource opens the player and auto-closes the modal.
  await page.locator(".modal-resource-link--local").click();
  await expect(page.locator(".media-player")).toBeVisible();

  // Click the close button on the MediaPlayer.
  await page.locator(".media-player__close").click();

  await expect(page.locator(".media-player")).not.toBeVisible();
});

test("opens standalone Metronome panel from header button", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  // Click the Metronome button in the session header.
  await page.locator("button", { hasText: "Metronome" }).click();

  await expect(page.locator(".metronome-panel")).toBeVisible();

  // Toggle it off.
  await page.locator("button", { hasText: "Metronome" }).click();
  await expect(page.locator(".metronome-panel")).not.toBeVisible();
});
