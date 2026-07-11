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
      name: "Parent Exercise",
      order: 1,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      resources: [],
      child_exercises: [
        {
          id: 2,
          name: "Child Exercise",
          order: 1,
          session_type: "exercise",
          parent_exercise_id: 1,
          created_timestamp: 0,
          updated_timestamp: 0,
          resources: [
            {
              name: "Practice Track",
              url: "/path/to/practice.mp3",
              type: "local_file",
            },
          ],
          child_exercises: [],
          meta: {
            user_exercise: null,
            sessions: [],
          },
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
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

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

  await page.route("**/user/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockUser),
    })
  );

  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockDashboard),
    })
  );

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

test("opening a media resource during a sequential session does not stop the timer or kill the session modal", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  // Expand Exercises and start the sequential session on the parent.
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const parentCard = page.locator(".item-card", { hasText: "Parent Exercise" }).first();
  await expect(parentCard).toBeVisible();
  await parentCard.locator('button[title="Start sequential session"]').click();

  // Sequential session modal should appear for the first child.
  await expect(page.locator(".modal-title", { hasText: "Child Exercise" })).toBeVisible();

  // Let the timer accumulate a couple of seconds.
  await page.waitForTimeout(2200);

  // Open the child's media resource — this should hide the modal behind the
  // media player, not cancel the whole sequential session.
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();

  // Close the media player.
  await page.locator(".media-player__close").click();
  await expect(page.locator(".media-player")).not.toBeVisible();

  // The sequential session modal must still be here (not cancelled), with the
  // timer having kept running (not reset to 0:00) while the media was open.
  await expect(page.locator(".modal-title", { hasText: "Child Exercise" })).toBeVisible();
  await expect(page.locator(".modal-elapsed-display")).not.toHaveText("0:00");
});
