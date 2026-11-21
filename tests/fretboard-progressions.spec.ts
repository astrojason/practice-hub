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
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await expect(page.locator(".fretboard-view")).toBeVisible();
});

const playBtn = (page: import("@playwright/test").Page) => page.getByTestId("fb-play");
const tab = (page: import("@playwright/test").Page, name: string) => page.locator(".fb-tab", { hasText: name }).click();
const cards = (page: import("@playwright/test").Page) => page.locator(".fb-chord-card");

test("presets fill the progression and pick a suitable scale", async ({ page }) => {
  await tab(page, "Progressions");
  expect(await page.locator('select[aria-label="Preset"] option').count()).toBeGreaterThanOrEqual(19);
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "ii – V – I (jazz)" });
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).nth(0)).toContainText("Dm7");
  await expect(cards(page).nth(1)).toContainText("G7");
  await expect(cards(page).nth(2)).toContainText("Cmaj7");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "12-bar blues" });
  await expect(cards(page)).toHaveCount(12);
  await expect(page.locator(".fretboard-title")).toContainText("Blues");
});

test("a chord can be edited, moved, duplicated and removed (removing asks first)", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "I – IV – V – I" });
  await cards(page).nth(1).click();
  const editor = page.locator(".fb-chord-editor");
  await expect(editor).toBeVisible();
  await editor.locator('select[aria-label="Chord type"]').selectOption({ label: "Dominant 7" });
  await expect(cards(page).nth(1)).toContainText("F7");
  await editor.locator("button", { hasText: "Move right" }).click();
  await expect(cards(page).nth(2)).toContainText("F7");
  await expect(cards(page).nth(1)).toContainText("G");
  await editor.locator("button", { hasText: "Duplicate" }).click();
  await expect(cards(page)).toHaveCount(5);
  await editor.locator("button", { hasText: "Remove" }).click();
  await expect(page.locator(".confirm-modal")).toBeVisible();
  await page.locator(".confirm-modal button", { hasText: "Cancel" }).click();
  await expect(cards(page)).toHaveCount(5);
  await editor.locator("button", { hasText: "Remove" }).click();
  await page.locator(".confirm-modal button", { hasText: "Remove" }).click();
  await expect(cards(page)).toHaveCount(4);
});

test("chords can be added from the key or from the full list", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "I – IV – V – I" });
  await page.locator(".fb-add-key button", { hasText: "Am" }).click();
  await expect(cards(page)).toHaveCount(5);
  await expect(cards(page).nth(4)).toContainText("Am");
  await page.locator('.fb-add-any select[aria-label="Root"]').selectOption({ label: "Eb" });
  await page.locator('.fb-add-any select[aria-label="Chord type"]').selectOption({ label: "Minor 7" });
  await page.locator(".fb-add-any button", { hasText: "Add" }).click();
  await expect(cards(page).nth(5)).toContainText("Ebm7");
});

test("a progression can be saved, reloaded and deleted (deleting asks first)", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "I – V – vi – IV (pop)" });
  await page.locator('input[aria-label="Progression name"]').fill("My pop loop");
  await page.locator("button", { hasText: /^Save$/ }).click();
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "12-bar blues" });
  await expect(cards(page)).toHaveCount(12);
  await page.locator('select[aria-label="My progressions"]').selectOption({ label: "My pop loop" });
  await expect(cards(page)).toHaveCount(4);
  await page.reload();
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await tab(page, "Progressions");
  await expect(page.locator('select[aria-label="My progressions"] option', { hasText: "My pop loop" })).toBeAttached();
  await page.locator('select[aria-label="My progressions"]').selectOption({ label: "My pop loop" });
  await page.locator("button", { hasText: "Delete saved" }).click();
  await page.locator(".confirm-modal button", { hasText: "Cancel" }).click();
  await expect(page.locator('select[aria-label="My progressions"] option', { hasText: "My pop loop" })).toBeAttached();
  await page.locator("button", { hasText: "Delete saved" }).click();
  await page.locator(".confirm-modal button", { hasText: "Delete" }).click();
  await expect(page.locator('select[aria-label="My progressions"] option', { hasText: "My pop loop" })).toHaveCount(0);
});

test("guitar and drum styles are offered", async ({ page }) => {
  await tab(page, "Progressions");
  expect(await page.locator('select[aria-label="Guitar part"] option').count()).toBe(4);
  expect(await page.locator('select[aria-label="Drum style"] option').count()).toBe(9);
});

test("playing lights the current chord and follows it with its scale", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "ii – V – I (jazz)" });
  await page.locator('select[aria-label="Follow the chords"]').selectOption("chordscale");
  // Two seconds a chord, so a busy machine doesn't skip past the first one.
  await page.locator('input[aria-label="Tempo (bpm)"]').fill("120");
  await playBtn(page).click();
  await expect(cards(page).nth(0)).toHaveClass(/fb-chord-card--playing/);
  await expect(page.locator(".fb-prog-now")).toContainText("Dm7");
  await expect(page.locator(".fb-prog-now")).toContainText("D Dorian");
  await expect(page.locator(".fb-prog-now")).toContainText("G7", { timeout: 12000 });
  await expect(page.locator(".fb-prog-now")).toContainText("G Mixolydian");
  await playBtn(page).click();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("chord tones are ringed with their role while a progression plays over a scale", async ({ page }) => {
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Dorian" });
  await page.locator(".fb-playbar label", { hasText: "Play over a progression" }).locator("input").check();
  await playBtn(page).click();
  await expect(page.locator(".fb-prog-now")).toContainText("Cm7");
  await expect(page.locator(".fb-note--chordtone").first()).toBeVisible();
  await expect(page.locator(".fb-note__badge").first()).toBeVisible();
  // The scale stays exactly as it was.
  await expect(page.locator(".fretboard-title")).toContainText("C Dorian");
  await playBtn(page).click();
});

test("with Suit the scale off, the Progressions page loop is used", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "I – IV – V – I" });
  await tab(page, "Scales");
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Dorian" });
  await page.locator(".fb-playbar label", { hasText: "Play over a progression" }).locator("input").check();
  await page.locator(".fb-playbar label", { hasText: "Suit the scale" }).locator("input").uncheck();
  await playBtn(page).click();
  await expect(page.locator(".fb-prog-now")).toContainText("C");
  await expect(page.locator(".fb-prog-now")).not.toContainText("Cm7");
  await playBtn(page).click();
});

test("arpeggios and chords follow the progression", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "ii – V – I (jazz)" });
  await tab(page, "Arpeggios");
  await page.locator(".fb-playbar label", { hasText: "Play over a progression" }).locator("input").check();
  await playBtn(page).click();
  await expect(page.locator(".fb-prog-now")).toContainText("Dm7");
  const degrees = await page.locator('.fb-note[data-in-position="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-degree")));
  expect(new Set(degrees)).toEqual(new Set(["1", "b3", "5", "b7"]));
  await playBtn(page).click();
  await expect(page.locator(".modal-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await tab(page, "Chords");
  await expect(page.locator(".modal-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-card")).toHaveCount(0);
  await playBtn(page).click();
  await expect(page.locator(".fb-prog-now")).toContainText("Dm7");
  await expect(page.locator(".chord-box")).toBeVisible();
  await playBtn(page).click();
});

test("scale tones that are not in the sounding chord are dimmed so the chord notes stand out", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "ii – V – I (jazz)" });
  await expect(page.locator(".fb-note--chordless")).toHaveCount(0);
  await cards(page).nth(0).click(); // Dm7: D F A C
  await expect(page.locator(".fb-note--chordtone").first()).toBeVisible();
  const dimmed = await page.locator(".fb-note--chordless").evaluateAll((els) => els.map((e) => e.getAttribute("data-degree")));
  expect(dimmed.length).toBeGreaterThan(3);
  // C major's 3rd, 5th and 7th (E, G, B) are not in Dm7 (D F A C).
  expect(new Set(dimmed)).toEqual(new Set(["3", "5", "7"]));
});

test("scales and arpeggios go up and down by default, not just up", async ({ page }) => {
  await expect(page.locator('select[aria-label="Direction"]')).toHaveValue("updown");
  const order = await page.evaluate(async () => {
    const { orderSteps } = await import("/src/lib/fretboard/playback.ts");
    const steps = [1, 2, 3, 4].map((m) => ({ midi: 40 + m, string: 0, fret: m }));
    return orderSteps(steps, "updown").map((s) => s.midi);
  });
  expect(order).toEqual([41, 42, 43, 44, 43, 42]);
});
