import { test, expect } from "./base";

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
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
    (window as unknown as { __trainerIdleMs: number }).__trainerIdleMs = 3000;
  });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
  await page.locator("button", { hasText: "Fretboard" }).first().click();
});

const timer = async (page: import("@playwright/test").Page) => (await page.locator(".btn-open-session-active").textContent())?.trim();
const seconds = (t: string | undefined) => {
  const p = (t ?? "0:00").split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

test("the Open Session the trainer started stops when nobody is doing anything, and asks to save", async ({ page }) => {
  await page.locator('.fb-note[data-in-position="true"]').first().click();
  await expect(page.locator(".btn-open-session-active")).toBeAttached();
  // Idle: no input and nothing playing. The trainer closes and the save form opens.
  await expect(page.locator(".fretboard-view")).toHaveCount(0, { timeout: 15000 });
  const form = page.locator(".modal-card");
  await expect(form).toContainText("Open Session");
  await expect(form.getByRole("button", { name: "Log Session" })).toBeVisible();
  await expect(form.locator("textarea")).toHaveValue(/Fretboard Trainer/);
  // The idle time wasn't counted.
  expect(parseInt(await form.locator('input[type="number"]').inputValue())).toBeLessThanOrEqual(3);
});

test("it keeps running while the trainer is playing on its own", async ({ page }) => {
  await page.getByTestId("fb-play").click();
  await page.locator(".fb-playbar label", { hasText: "Loop" }).locator("input").check();
  await page.waitForTimeout(1000);
  const a = seconds(await timer(page));
  await page.waitForTimeout(4500);
  expect(seconds(await timer(page))).toBeGreaterThan(a + 2);
  await page.getByTestId("fb-play").click();
});
