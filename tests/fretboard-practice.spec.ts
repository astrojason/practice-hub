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
    if (!localStorage.getItem("ph:fretboard:settings")) {
      localStorage.setItem("ph:fretboard:settings", JSON.stringify({ countIn: 0, bpm: 240, notesPerBeat: 4, loop: false, click: false }));
    }
  });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await expect(page.locator(".fretboard-view")).toBeVisible();
});

const playBtn = (page: import("@playwright/test").Page) => page.getByTestId("fb-play");
const chips = (page: import("@playwright/test").Page) => page.locator(".fb-step-chip");
const routine = (page: import("@playwright/test").Page, name: string) => page.locator('select[aria-label="Routine"]').selectOption({ label: name });

test.beforeEach(async ({ page }) => {
  await page.locator(".fb-tab", { hasText: "Practice" }).click();
});

test("every routine is offered, with a one-line description", async ({ page }) => {
  expect(await page.locator('select[aria-label="Routine"] option').count()).toBe(8);
  await expect(page.locator(".fb-routine-help")).toContainText("Every position of the scale");
  expect(await chips(page).count()).toBeGreaterThan(7);
});

test("CAGED goes chord, arpeggio, scale for each of five shapes", async ({ page }) => {
  await routine(page, "CAGED");
  await expect(chips(page)).toHaveCount(15);
  await expect(chips(page).nth(0)).toContainText("chord");
  await expect(chips(page).nth(1)).toContainText("arpeggio");
  await expect(chips(page).nth(2)).toContainText("Major (Ionian)");
  await expect(page.locator(".fb-step-chip", { hasText: "C shape" }).first()).toBeVisible();
});

test("clicking a step shows it on the neck", async ({ page }) => {
  await routine(page, "CAGED");
  await chips(page).nth(1).click();
  await expect(page.locator(".fretboard-title")).toContainText("arpeggio");
  const degrees = await page.locator('.fb-note[data-in-position="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-degree")));
  expect(new Set(degrees)).toEqual(new Set(["1", "3", "5"]));
});

test("circle of fifths visits all twelve keys, or fourths", async ({ page }) => {
  await routine(page, "Circle of fifths");
  await expect(chips(page)).toHaveCount(12);
  await expect(chips(page).nth(1)).toContainText(/^G /);
  await page.locator("label", { hasText: "Fourths" }).locator("input").check();
  await expect(chips(page).nth(1)).toContainText(/^F /);
});

test("chord relay needs a seven-note scale and climbs the key", async ({ page }) => {
  await routine(page, "Chord relay");
  await expect(chips(page)).toHaveCount(15);
  await expect(chips(page).nth(0)).toContainText("I C");
  await expect(chips(page).nth(1)).toContainText("ii Dm");
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Major Pentatonic" });
  await expect(chips(page)).toHaveCount(0);
  await expect(page.locator(".fb-practice-message")).toContainText("seven-note");
});

test("extended arpeggios follow the chosen extension", async ({ page }) => {
  await routine(page, "Extended arpeggios");
  await expect(chips(page)).toHaveCount(7);
  await page.locator('select[aria-label="Extension"]').selectOption({ label: "9th" });
  await expect(chips(page).first()).toContainText("9th arpeggio");
});

test("chord changes use the progression; sequences and ladder build steps", async ({ page }) => {
  await routine(page, "Chord changes in one position");
  await expect(chips(page)).toHaveCount(4);
  await routine(page, "Scale sequences");
  await expect(chips(page)).toHaveCount(2);
  await page.locator('select[aria-label="Pattern"]').selectOption({ label: "Groups of 4" });
  await expect(chips(page).first()).toContainText("Groups of 4");
});

test("click patterns offer every way of dropping beats", async ({ page }) => {
  await routine(page, "Time keeping");
  expect(await page.locator('select[aria-label="Click pattern"] option').count()).toBe(9);
  await expect(chips(page)).toHaveCount(1);
});

test("playing steps through the routine and lights the current step", async ({ page }) => {
  await routine(page, "Position ladder");
  await playBtn(page).click();
  await expect(page.locator(".fb-step-chip--playing")).toHaveCount(1);
  await expect(page.locator(".fb-step-chip--playing")).toContainText("Position", { timeout: 3000 });
  await expect(page.locator(".fb-step-chip--playing")).not.toContainText("Position 1 up", { timeout: 8000 });
  await playBtn(page).click();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("speed bursts show a badge for the second pass", async ({ page }) => {
  await routine(page, "Scale sequences");
  await page.locator('select[aria-label="Speed bursts"]').selectOption("4");
  await playBtn(page).click();
  await expect(page.locator(".fb-pass-badge")).toHaveText(/Normal speed/);
  await expect(page.locator(".fb-pass-badge")).toHaveText(/SPEED BURSTS/, { timeout: 8000 });
  await playBtn(page).click();
});

test("call-outs name each note as it plays", async ({ page }) => {
  await routine(page, "Position ladder");
  await page.locator('select[aria-label="Call-outs"]').selectOption("note");
  await playBtn(page).click();
  await expect(page.locator(".fb-callout")).toHaveText(/^[A-G][#b]?$/, { timeout: 4000 });
  await playBtn(page).click();
});

test("the circle of fifths shows the next key ahead of time", async ({ page }) => {
  await routine(page, "Circle of fifths");
  await playBtn(page).click();
  await expect(page.locator(".fb-announce")).toContainText(/Next key: /, { timeout: 4000 });
  await playBtn(page).click();
});

test("the speed trainer raises the tempo every few loops", async ({ page }) => {
  await routine(page, "Time keeping");
  await page.locator('select[aria-label="Bars"]').selectOption("1");
  await page.locator("label", { hasText: "Speed trainer" }).locator("input").check();
  await page.locator('input[aria-label="Raise tempo by"]').fill("20");
  await page.locator('input[aria-label="Raise tempo by"]').blur();
  await page.locator('input[aria-label="Raise every (loops)"]').fill("1");
  await page.locator('input[aria-label="Raise every (loops)"]').blur();
  await page.locator('input[aria-label="Up to (bpm)"]').fill("300");
  await page.locator('input[aria-label="Up to (bpm)"]').blur();
  await page.locator(".fb-playbar label", { hasText: "Loop" }).locator("input").check();
  await playBtn(page).click();
  await expect(page.locator('input[aria-label="Tempo (bpm)"]')).not.toHaveValue("240", { timeout: 8000 });
  await playBtn(page).click();
});
