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
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await expect(page.locator(".fretboard-view")).toBeVisible();
});

test("shows a degree-coloured neck for C Major with position 1 highlighted", async ({ page }) => {
  await expect(page.locator(".fretboard-title")).toContainText("C Major (Ionian)");
  // 3 notes per string across 6 strings.
  await expect(page.locator('.fb-note[data-in-position="true"]')).toHaveCount(18);
  // Root notes carry the degree "1" and a root ring.
  const roots = page.locator('.fb-note[data-in-position="true"][data-degree="1"]');
  expect(await roots.count()).toBeGreaterThan(0);
  await expect(roots.first()).toHaveClass(/fb-note--root/);
  // Notes outside the position are still drawn, dimmed.
  expect(await page.locator('.fb-note[data-in-position="false"]').count()).toBeGreaterThan(0);
});

test("key buttons and the scale select change the title and the tonality line", async ({ page }) => {
  await page.locator(".fb-key", { hasText: /^D$/ }).click();
  await expect(page.locator(".fretboard-title")).toContainText("D Major (Ionian)");
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Dorian" });
  await expect(page.locator(".fretboard-title")).toContainText("D Dorian");
  await expect(page.locator(".fb-tonality-row")).toContainText("Minor");
  await expect(page.locator(".fb-tonality-row")).toContainText("natural 6");
});

test("the position select moves the highlighted notes and spelling follows the key", async ({ page }) => {
  const before = await page.locator('.fb-note[data-in-position="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-fret")).join(","));
  await page.locator('select[aria-label="Position"]').selectOption({ index: 2 });
  const after = await page.locator('.fb-note[data-in-position="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-fret")).join(","));
  expect(after).not.toEqual(before);

  await page.locator(".fb-key", { hasText: /^F#$/ }).click();
  await page.locator('select[aria-label="Labels"]').selectOption("note");
  // F# major's 7th is E#, not F.
  await expect(page.locator('.fb-note[data-in-position="true"][data-degree="7"]').first()).toContainText("E#");
});

test("label modes switch between degree, interval and none", async ({ page }) => {
  const label = page.locator('.fb-note[data-in-position="true"][data-degree="3"]').first();
  await expect(label).toContainText("3");
  await page.locator('select[aria-label="Labels"]').selectOption("interval");
  await expect(label).toContainText("M3");
  await page.locator('select[aria-label="Labels"]').selectOption("none");
  await expect(label).toHaveText("");
});

test("clicking a note plays it without an error; Play starts an Open Session and Stop opens the save form describing what was practised", async ({ page }) => {
  await page.locator('.fb-note[data-in-position="true"]').first().click();
  await expect(page.locator(".error-modal")).toHaveCount(0);
  // Only Start/Play starts the Open Session timer.
  await page.getByTestId("fb-play").click();
  await expect(page.getByTestId("fb-play")).toHaveText("Stop");
  await page.getByTestId("fb-play").click();
  const notes = page.locator(".modal-card textarea");
  await expect(notes).toHaveValue(/Theory Training/);
  await expect(notes).toHaveValue(/C Major \(Ionian\)/);
});

test("the About card says how the scale sounds and ringed colour notes are marked", async ({ page }) => {
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Lydian" });
  await expect(page.locator(".fretboard-about")).toContainText("#4");
  await expect(page.locator('.fb-note[data-degree="#4"][data-in-position="true"]').first()).toHaveClass(/fb-note--colour/);
});

test("chords in this key are listed for a 7-note scale", async ({ page }) => {
  const chords = page.locator(".fb-chord-chip");
  await expect(chords).toHaveCount(7);
  await expect(chords.first()).toContainText("C");
  await expect(chords.nth(1)).toContainText("Dm");
});
