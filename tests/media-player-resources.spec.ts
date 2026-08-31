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
        { name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file" },
        { name: "Backing Track", url: "/path/to/backing.mp3", type: "local_file" },
        { name: "Tab PDF", url: "https://example.com/tab.pdf", type: "url" },
      ],
      meta: { user_exercise: null, sessions: [] },
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
      body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }),
    })
  );
  await page.route("**/user/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) })
  );
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) })
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

test("the item's other resources stay reachable from the MediaPlayer while a local file is already playing", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await expect(card).toBeVisible();
  await card.locator('button[title="Log session"]').click();

  // Open the first local file — this closes the session modal and opens the player.
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".modal-card")).toHaveCount(0);

  // The resources button must be present in the player header — before this
  // fix, once media started playing there was no way back to the item's
  // other resources without stopping playback.
  const resourcesBtn = page.locator('button[title="Open other resources without stopping playback"]');
  await expect(resourcesBtn).toBeVisible();
  await resourcesBtn.click();

  const panel = page.locator(".mp-palette", { hasText: "Resources" });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".modal-resource-link", { hasText: "Backing Track" })).toBeVisible();
  const urlLink = panel.locator(".modal-resource-link", { hasText: "Tab PDF" });
  await expect(urlLink).toBeVisible();

  // Opening an external link from the player must not stop playback or close it.
  // (openUrl isn't mocked in this test environment, so the click surfaces the
  // failure via ErrorModal — proof the click actually reached the opener call
  // rather than being unreachable.)
  await urlLink.click();
  await expect(page.locator(".error-modal")).toBeVisible();
  await expect(page.locator(".media-player")).toBeVisible();
});

test("picking a different local file from the MediaPlayer's resources panel swaps playback in place", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();

  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();

  await page.locator('button[title="Open other resources without stopping playback"]').click();
  const panel = page.locator(".mp-palette", { hasText: "Resources" });
  await panel.locator(".modal-resource-link", { hasText: "Backing Track" }).click();

  // The player stays open, now backed by the newly picked file, and the
  // resources panel closes behind the selection.
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".mp-palette", { hasText: "Resources" })).toHaveCount(0);
});
