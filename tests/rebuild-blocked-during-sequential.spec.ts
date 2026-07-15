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
            { name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file" },
          ],
          child_exercises: [],
          meta: { user_exercise: null, sessions: [] },
        },
      ],
      meta: { user_exercise: null, sessions: [] },
    },
  ],
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
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "audio/mpeg" }, body: Buffer.from([]) })
  );

  await page.goto("/");
});

test("Rebuild is blocked with a clear message while a sequential session is in progress", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const parentCard = page.locator(".item-card", { hasText: "Parent Exercise" }).first();
  await parentCard.locator('button[title="Start sequential session"]').click();
  await expect(page.locator(".modal-title", { hasText: "Child Exercise" })).toBeVisible();

  // Opening a media resource hides the sequential modal (without cancelling the
  // session), which is what makes the header's Rebuild button reachable again —
  // exactly the state that previously let a rebuild silently go stale.
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();

  let rebuildCalled = false;
  await page.route("**/user/dashboard?refresh=1", (route) => {
    rebuildCalled = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) });
  });

  await page.locator("button", { hasText: "Rebuild" }).click();

  await expect(page.getByText(/finish or cancel the current sequential session/i)).toBeVisible();
  expect(rebuildCalled).toBe(false);
  await page.locator(".error-modal-close").click();

  // The sequential session must still be intact — not cancelled as a side effect
  // of the blocked rebuild attempt.
  await page.locator(".media-player__close").click();
  await expect(page.locator(".modal-title", { hasText: "Child Exercise" })).toBeVisible();
});
