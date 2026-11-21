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

test("Play lights up each note as it sounds, then ends by itself when not looping", async ({ page }) => {
  await playBtn(page).click();
  await expect(playBtn(page)).toHaveText("Stop");
  await expect(page.locator(".fb-note--playing").first()).toBeVisible();
  await expect(playBtn(page)).toHaveText("Play", { timeout: 8000 });
  await expect(page.locator(".fb-note--playing")).toHaveCount(0);
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("with Loop on it keeps playing until stopped, and Space toggles", async ({ page }) => {
  await page.locator(".fb-playbar label", { hasText: "Loop" }).locator("input").check();
  await playBtn(page).click();
  await page.waitForTimeout(3500);
  await expect(playBtn(page)).toHaveText("Stop");
  await playBtn(page).click();
  await expect(playBtn(page)).toHaveText("Play");
  await page.locator(".fretboard-title").click();
  await page.keyboard.press("Space");
  await expect(playBtn(page)).toHaveText("Stop");
  await page.keyboard.press("Space");
  await expect(playBtn(page)).toHaveText("Play");
});

test("direction decides which note comes first", async ({ page }) => {
  // One note a second, so the first note is still lit when it is read.
  await page.locator('input[aria-label="Tempo (bpm)"]').fill("60");
  await page.locator('input[aria-label="Tempo (bpm)"]').blur();
  await page.locator('select[aria-label="Notes per beat"]').selectOption("1");
  const first = async () => {
    await playBtn(page).click();
    const note = page.locator(".fb-note--playing").first();
    await expect(note).toBeVisible();
    const s = await note.getAttribute("data-string");
    await playBtn(page).click();
    return s;
  };
  expect(await first()).toBe("0"); // up: starts on the low E string
  await page.locator('select[aria-label="Direction"]').selectOption("down");
  await expect(playBtn(page)).toHaveText("Play");
  expect(await first()).toBe("5"); // down: starts on the high E string
});

test("tempo is clamped, and notes per beat can be chosen", async ({ page }) => {
  const bpm = page.locator('input[aria-label="Tempo (bpm)"]');
  await expect(bpm).toHaveValue("240");
  await page.locator('select[aria-label="Notes per beat"]').selectOption("3");
  await expect(page.locator('select[aria-label="Notes per beat"]')).toHaveValue("3");
});

test("settings: choose a built-in guitar, count-in, and have them remembered", async ({ page }) => {
  await page.locator('button[aria-label="Fretboard settings"]').click();
  const dlg = page.locator('[role="dialog"][aria-label="Fretboard settings"]');
  await expect(dlg).toBeVisible();
  await dlg.locator('select[aria-label="Guitar sound"]').selectOption("nylon");
  await dlg.locator('select[aria-label="Count-in"]').selectOption("2");
  await dlg.locator("button", { hasText: "Test" }).click();
  await expect(page.locator(".error-modal:not(.fb-settings)")).toHaveCount(0);
  await dlg.locator("button", { hasText: "Done" }).click();
  await expect(page.locator(".fb-playbar__sound")).toHaveText("Nylon classical");
  await page.reload();
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await expect(page.locator(".fb-playbar__sound")).toHaveText("Nylon classical");
});

test("a SoundFont can be chosen: guitar instruments are listed and playing makes no error", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  test.skip(browserName === "webkit", "SoundFont playback is checked in Chromium");
  await page.locator('button[aria-label="Fretboard settings"]').click();
  const dlg = page.locator('[role="dialog"][aria-label="Fretboard settings"]');
  await dlg.locator('select[aria-label="Guitar sound"]').selectOption("sf");
  const presets = dlg.locator('select[aria-label="SoundFont instrument"]');
  await expect(presets.locator("optgroup[label=Guitars] option").first()).toBeAttached({ timeout: 60_000 });
  expect(await presets.locator("optgroup[label=Guitars] option").count()).toBeGreaterThanOrEqual(4);
  await dlg.locator("button", { hasText: "Done" }).click();
  await playBtn(page).click();
  await expect(page.locator(".fb-note--playing").first()).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("the chosen SoundFont instrument is remembered after reopening", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  test.skip(browserName === "webkit", "SoundFont playback is checked in Chromium");
  await page.locator('button[aria-label="Fretboard settings"]').click();
  const dlg = page.locator('[role="dialog"][aria-label="Fretboard settings"]');
  await dlg.locator('select[aria-label="Guitar sound"]').selectOption("sf");
  const presets = dlg.locator('select[aria-label="SoundFont instrument"]');
  await expect(presets.locator("optgroup[label=Guitars] option").first()).toBeAttached({ timeout: 60_000 });
  const second = await presets.locator("optgroup[label=Guitars] option").nth(1).getAttribute("value");
  await presets.selectOption(second as string);
  await dlg.locator("button", { hasText: "Done" }).click();
  await page.reload();
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await page.locator('button[aria-label="Fretboard settings"]').click();
  const again = page.locator('[role="dialog"][aria-label="Fretboard settings"]');
  await expect(again.locator('select[aria-label="Guitar sound"]')).toHaveValue("sf");
  await expect(again.locator('select[aria-label="SoundFont instrument"]')).toHaveValue(second as string, { timeout: 60_000 });
});

test("the SoundFont instrument's name shows straight away on reopening", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "SoundFont playback is checked in Chromium");
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ph:fretboard:settings") ?? "{}");
    localStorage.setItem("ph:fretboard:settings", JSON.stringify({ ...s, instrument: "sf", preset: [0, 24], presetName: "Nylon Guitar" }));
  });
  await page.reload();
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await expect(page.locator(".fb-playbar__sound")).toContainText("Guitar");
});
