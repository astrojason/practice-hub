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
  await page.addInitScript(() => localStorage.setItem("ph:refreshToken", "fake-refresh-token"));
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
});

test("the general help lists the Theory Training tutorial", async ({ page }) => {
  await page.locator("button", { hasText: /Help/ }).first().click();
  await expect(page.locator(".help-modal-list-item", { hasText: "Theory Training" })).toBeVisible();
});

test("a Help button in the trainer opens its tutorial, and so does F1", async ({ page }) => {
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await page.locator(".fretboard-view button", { hasText: /^Help$/ }).click();
  await expect(page.locator(".help-modal-list-item.active")).toHaveText("Theory Training");
  await expect(page.locator(".help-modal-content h1")).toHaveText("Theory Training");
  await page.keyboard.press("Escape");
  await expect(page.locator(".help-modal")).toHaveCount(0);
  await page.locator(".fretboard-title").click();
  await page.keyboard.press("F1");
  await expect(page.locator(".help-modal-list-item.active")).toHaveText("Theory Training");
});

test("the tutorial covers every page and the playback and sound controls", async ({ page }) => {
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await page.locator(".fretboard-view button", { hasText: /^Help$/ }).click();
  const headings = await page.locator(".help-modal-content h2").allTextContents();
  for (const h of ["Scales", "Arpeggios", "Chords", "Progressions", "Practice", "Speed trainer", "Quiz", "Playback and sound", "Focus mode", "Your files"]) {
    expect(headings).toContain(h);
  }
  await expect(page.locator(".help-modal-content")).toContainText("Count-in");
});
