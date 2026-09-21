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

const song = {
  id: 615,
  name: "Nightrain",
  artist_id: 42,
  artist_name: "Guns n' Roses",
  tuning_id: 1,
  tuning_name: "Standard",
  bpm: null,
  has_lead: false,
  has_singing: false,
  active: true,
  resources: [],
  tags: [],
  seconds: null,
  session_type: "song",
  created_timestamp: 0,
  updated_timestamp: 0,
  meta: { sessions: [] },
};

const dashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [song] },
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboard) })
  );
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const songCard = page.locator(".item-card", { hasText: "Nightrain" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Log session"]').click();
});

test("a transient connection drop while logging a session is retried automatically instead of surfacing an error", async ({ page }) => {
  let attempts = 0;
  await page.route("**/user-song-session", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      // Simulates the connection dropping mid-session, e.g. wifi blip.
      await route.abort("connectionfailed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ daily_practice_time: 300 }),
    });
  });

  await page.getByLabel("Duration (sec)").fill("60");
  await page.locator('button[type="submit"]', { hasText: "Log Session" }).click();

  // Should recover on its own and close the form — no error modal, no leftover form.
  await expect(page.locator(".error-modal")).toHaveCount(0);
  await expect(page.locator(".session-form")).toHaveCount(0, { timeout: 10_000 });
  expect(attempts).toBeGreaterThan(1);
});

test("a connection that never recovers still surfaces a real error after retries are exhausted", async ({ page }) => {
  await page.route("**/user-song-session", (route) => route.abort("connectionfailed"));

  await page.getByLabel("Duration (sec)").fill("60");
  await page.locator('button[type="submit"]', { hasText: "Log Session" }).click();

  await expect(page.locator(".error-modal")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".session-form")).toBeVisible();
});
