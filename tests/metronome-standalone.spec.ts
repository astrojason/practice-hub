import { test, expect } from "@playwright/test";

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] }, exercises: [], study_materials: [], chord: null, progression: null, interval: null,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
});

test("standalone metronome starts, ticks, taps tempo, restarts on time-signature change, and stops without crashing", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator("button", { hasText: "Metronome" }).click();
  const panel = page.locator(".metronome-panel");
  await expect(panel).toBeVisible();

  const startBtn = panel.locator("button", { hasText: "Start" });
  await startBtn.click();
  await expect(panel.locator("button", { hasText: "Stop" })).toBeVisible();

  await page.waitForTimeout(500);
  await expect(page.locator(".error-modal")).toHaveCount(0);

  const tapBtn = panel.locator("button", { hasText: "Tap" });
  await tapBtn.click();
  await page.waitForTimeout(150);
  await tapBtn.click();
  await page.waitForTimeout(150);
  await tapBtn.click();

  // Changing time signature while running restarts the click loop at the downbeat.
  await panel.locator("select").selectOption("3");
  await page.waitForTimeout(300);

  await panel.locator("button", { hasText: "Stop" }).click();
  await expect(panel.locator("button", { hasText: "Start" })).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});
