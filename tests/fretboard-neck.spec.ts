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
const openSettings = async (page: import("@playwright/test").Page) => {
  await page.locator('button[aria-label="Fretboard settings"]').click();
  return page.locator('[role="dialog"][aria-label="Fretboard settings"]');
};
const done = (dlg: import("@playwright/test").Locator) => dlg.locator("button", { hasText: "Done" }).click();

test("tuning changes the open strings and every shape follows it", async ({ page }) => {
  await expect(page.locator('.fb-open-name[data-string="0"]')).toHaveText("E");
  const dlg = await openSettings(page);
  await dlg.locator('select[aria-label="Tuning"]').selectOption({ label: "Drop D" });
  await done(dlg);
  await expect(page.locator('.fb-open-name[data-string="0"]')).toHaveText("D");
  // C major position 1 still has 18 notes in the new tuning.
  await expect(page.locator('.fb-note[data-in-position="true"]')).toHaveCount(18);
});

test("the neck can be turned over", async ({ page }) => {
  const top = async (s: string) => (await page.locator(`.fb-note[data-string="${s}"]`).first().boundingBox())!.y;
  expect(await top("5")).toBeLessThan(await top("0"));
  const dlg = await openSettings(page);
  await dlg.locator("label", { hasText: "High E string on top" }).locator("input").uncheck();
  await done(dlg);
  expect(await top("5")).toBeGreaterThan(await top("0"));
});

test("degrees and strings can be hidden", async ({ page }) => {
  const dlg = await openSettings(page);
  await dlg.locator('button[aria-label="Show degree 3"]').click();
  await dlg.locator('button[aria-label="Show string 1"]').click();
  await done(dlg);
  await expect(page.locator('.fb-note[data-degree="3"]')).toHaveCount(0);
  await expect(page.locator('.fb-note[data-string="0"]')).toHaveCount(0);
  expect(await page.locator('.fb-note[data-degree="5"]').count()).toBeGreaterThan(0);
});

test("colour scheme and ghost notes are settings", async ({ page }) => {
  const fill = () => page.locator(".fb-note--root .fb-note__dot").first().evaluate((e) => getComputedStyle(e).fill);
  const before = await fill();
  const dlg = await openSettings(page);
  await dlg.locator('select[aria-label="Degree colours"]').selectOption({ label: "Nordic" });
  expect(await fill()).not.toEqual(before);
  await dlg.locator("label", { hasText: "other notes, faintly" }).locator("input").uncheck();
  await done(dlg);
  await expect(page.locator('.fb-note[data-in-position="false"]')).toHaveCount(0);
});

test("the chosen position can have more room", async ({ page }) => {
  const ratio = async () =>
    page.evaluate(() => {
      const svg = document.querySelector(".fretboard-neck") as SVGSVGElement;
      const xs = [...document.querySelectorAll('.fb-note[data-in-position="true"]')].map((e) => parseFloat(e.getAttribute("data-x") ?? "0"));
      const width = svg.viewBox.baseVal.width;
      return (Math.max(...xs) - Math.min(...xs)) / width;
    });
  const before = await ratio();
  const dlg = await openSettings(page);
  await dlg.locator("label", { hasText: "more room" }).locator("input").check();
  await done(dlg);
  expect(await ratio()).toBeGreaterThan(before * 1.2);
});

test("neighbouring positions can be shown faintly", async ({ page }) => {
  expect(await page.locator('.fb-note[data-neighbor="true"]').count()).toBe(0);
  await page.locator(".fretboard-controls label", { hasText: "Show next" }).locator("input").check();
  expect(await page.locator('.fb-note[data-neighbor="true"]').count()).toBeGreaterThan(5);
  await page.locator(".fretboard-controls label", { hasText: "Show next" }).locator("input").uncheck();
  await page.locator(".fretboard-controls label", { hasText: "Show previous" }).locator("input").check();
  await page.locator('select[aria-label="Position"]').selectOption({ index: 2 });
  expect(await page.locator('.fb-note[data-neighbor="true"]').count()).toBeGreaterThan(5);
});

test("a position can be connected to the next along a string, and Play travels the link", async ({ page }) => {
  await page.locator('select[aria-label="Connect to"]').selectOption("next");
  await page.locator('button[aria-label="Connect along string 2"]').click();
  expect(await page.locator('.fb-note[data-link="true"]').count()).toBeGreaterThan(0);
  const linked = await page.locator('.fb-note[data-in-position="true"]').count();
  expect(linked).toBeGreaterThan(18);
  await page.locator('select[aria-label="Connect to"]').selectOption("off");
  await expect(page.locator('.fb-note[data-link="true"]')).toHaveCount(0);
});

test("a second scale can be blended over the first", async ({ page }) => {
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Minor Pentatonic" });
  await page.locator('select[aria-label="Blend with"]').selectOption({ label: "Major Pentatonic" });
  expect(await page.locator(".fb-note--only-first").count()).toBeGreaterThan(0);
  expect(await page.locator(".fb-note--only-second").count()).toBeGreaterThan(0);
  expect(await page.locator('.fb-note[data-degree="b3"]').count()).toBeGreaterThan(0);
  await page.locator('select[aria-label="Blend with"]').selectOption({ label: "None" });
  await expect(page.locator(".fb-note--only-second")).toHaveCount(0);
});

test("focus mode hides everything but the neck and the play controls; Esc and F toggle it", async ({ page }) => {
  await expect(page.locator(".fretboard-keys")).toBeVisible();
  await page.locator("button", { hasText: /^Focus/ }).click();
  await expect(page.locator(".fb-focusbar")).toBeVisible();
  await expect(page.locator(".fretboard-keys")).toHaveCount(0);
  await expect(page.locator(".fretboard-neck")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".fretboard-keys")).toBeVisible();
  await page.locator(".fretboard-title").click();
  await page.keyboard.press("f");
  await expect(page.locator(".fb-focusbar")).toBeVisible();
  await page.keyboard.press("f");
  await expect(page.locator(".fb-focusbar")).toHaveCount(0);
});

test("a light theme can be chosen and is remembered", async ({ page }) => {
  const dlg = await openSettings(page);
  await dlg.locator('select[aria-label="Theme"]').selectOption("light");
  await done(dlg);
  await expect(page.locator(".fretboard-view")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await expect(page.locator(".fretboard-view")).toHaveAttribute("data-theme", "light");
});
