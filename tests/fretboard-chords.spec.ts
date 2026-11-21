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
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await expect(page.locator(".fretboard-view")).toBeVisible();
});


test("page tabs switch between scales, arpeggios and chords", async ({ page }) => {
  for (const name of ["Scales", "Arpeggios", "Chords"]) {
    await page.locator(".fb-tab", { hasText: name }).click();
    await expect(page.locator(".fb-tab.active")).toHaveText(name);
  }
});

test("arpeggios show only the chord tones in the chosen position", async ({ page }) => {
  await page.locator(".fb-tab", { hasText: "Arpeggios" }).click();
  await expect(page.locator(".fretboard-title")).toContainText("C Major arpeggio");
  const degrees = async () =>
    new Set(await page.locator('.fb-note[data-in-position="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-degree"))));
  expect([...(await degrees())].sort()).toEqual(["1", "3", "5"]);
  await page.locator('select[aria-label="Chord type"]').selectOption({ label: "Dominant 7" });
  await expect(page.locator(".fretboard-title")).toContainText("C Dominant 7 arpeggio");
  expect([...(await degrees())].sort()).toEqual(["1", "3", "5", "b7"]);
  expect(await page.locator('select[aria-label="Position"] option').count()).toBeGreaterThanOrEqual(4);
});

test("chords show a playable shape, a chord box with muted strings, and step through shapes", async ({ page }) => {
  await page.locator(".fb-tab", { hasText: "Chords" }).click();
  await expect(page.locator(".fretboard-title")).toContainText("C Major");
  await expect(page.locator(".chord-box")).toBeVisible();
  // The first shape is the open C chord: x32010.
  await expect(page.locator(".chord-box__mute")).toHaveCount(1);
  await expect(page.locator('.fb-note[data-in-position="true"]')).toHaveCount(5);
  const before = await page.locator('select[aria-label="Shape"]').inputValue();
  await page.keyboard.press("ArrowRight");
  expect(await page.locator('select[aria-label="Shape"]').inputValue()).not.toEqual(before);
  await page.keyboard.press("ArrowLeft");
  expect(await page.locator('select[aria-label="Shape"]').inputValue()).toEqual(before);
});

test("Strum and Play make sound without errors and log what was practised", async ({ page }) => {
  await page.locator(".fb-tab", { hasText: "Chords" }).click();
  await page.locator("button", { hasText: /^Strum$/ }).click();
  await page.locator("button", { hasText: /^Play$/ }).click();
  await page.waitForTimeout(300);
  await expect(page.locator(".error-modal")).toHaveCount(0);
  await page.locator("button", { hasText: "Back" }).first().click();
  await page.locator(".btn-open-session-active").click();
  await expect(page.locator(".modal-notes-label textarea")).toHaveValue(/Chords: C Major/);
});

test("double-clicking a chord in the key opens it on the Chords page", async ({ page }) => {
  await page.locator(".fb-chord-chip", { hasText: "Dm" }).dblclick();
  await expect(page.locator(".fb-tab.active")).toHaveText("Chords");
  await expect(page.locator(".fb-key.active")).toHaveText("D");
  await expect(page.locator('select[aria-label="Chord type"] option:checked')).toHaveText("Minor");
});

test("the chord page lists the chord's notes with intervals", async ({ page }) => {
  await page.locator(".fb-tab", { hasText: "Arpeggios" }).click();
  await expect(page.locator(".fretboard-about")).toContainText("Major 3rd");
  await expect(page.locator(".fretboard-about")).toContainText("E");
});
