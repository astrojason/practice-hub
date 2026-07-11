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
  overdue: [
    {
      id: 1,
      name: "Overdue Song",
      artist_id: 1,
      artist_name: "Some Artist",
      tuning_id: 1,
      tuning_name: "Standard",
      bpm: 120,
      active: true,
      resources: [
        { name: "Practice Video", url: "/path/to/practice.mp4", type: "local_file" },
      ],
      tags: [],
      seconds: null,
      session_type: "song",
      created_timestamp: 0,
      updated_timestamp: 0,
      meta: { sessions: [], song_lists: [] },
    },
  ],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
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
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "video/mp4" }, body: Buffer.from([]) })
  );

  await page.goto("/");
});

test("opening a video resource on a Quick-Added song does not stop the timer or kill the session modal", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  // Add the overdue song via the "Add" quick-add panel.
  await page.locator(".session-header-actions button", { hasText: "Add" }).first().click();
  await page.locator(".qa-section-header").click();
  await page.locator(".qa-row-add", { hasText: "Add" }).first().click();

  // Expand the "Additional" group and find the song card.
  await page.locator(".item-group", { hasText: "Additional" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Overdue Song" }).first();
  await expect(card).toBeVisible();

  await card.locator('button[title="Start timer"]').click();
  const elapsedBtn = card.locator(".item-elapsed");
  await expect(elapsedBtn).toBeVisible();

  // Let the timer accumulate a couple of seconds before opening media.
  await page.waitForTimeout(2200);

  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator(".media-player")).toBeVisible();

  // The timer must keep running in the background while the video is open.
  await page.waitForTimeout(1500);
  const elapsedWhileOpen = await elapsedBtn.textContent();
  expect(elapsedWhileOpen).not.toBe("0:00");

  await page.locator(".media-player__close").click();
  await expect(page.locator(".media-player")).not.toBeVisible();

  // The session modal must reopen automatically, and the elapsed time must not
  // have been reset — the underlying session/timer was never cancelled.
  await expect(page.locator(".modal-card")).toBeVisible();
  await expect(page.locator(".modal-elapsed-display")).not.toHaveText("0:00");
});
