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
});

type P = import("@playwright/test").Page;
const pick = (page: P, label: string) => page.locator('select[aria-label="Instrument"]').first().selectOption({ label });
const names = (page: P) => page.locator(".fb-open-name").allTextContents();
const inPos = (page: P) => page.locator('.fb-note[data-in-position="true"]');

test("the instrument can be switched between guitars, basses and a ukulele", async ({ page }) => {
  expect(await page.locator('select[aria-label="Instrument"] option').count()).toBe(5);
  expect(await names(page)).toEqual(["E", "A", "D", "G", "B", "e"]);
  await pick(page, "7-string guitar");
  expect(await names(page)).toEqual(["B", "E", "A", "D", "G", "B", "E"]);
  await expect(inPos(page)).toHaveCount(21); // 3 notes a string, 7 strings
  await pick(page, "4-string bass");
  expect(await names(page)).toEqual(["E", "A", "D", "G"]);
  await expect(inPos(page)).toHaveCount(12);
  await pick(page, "5-string bass");
  expect(await names(page)).toEqual(["B", "E", "A", "D", "G"]);
  await expect(inPos(page)).toHaveCount(15);
  await pick(page, "Ukulele");
  expect(await names(page)).toEqual(["G", "C", "E", "A"]);
  await expect(inPos(page)).toHaveCount(12);
});

test("ukulele positions stay compact and in the key even though its top string is re-entrant", async ({ page }) => {
  await pick(page, "Ukulele");
  const notes = await inPos(page).evaluateAll((els) => els.map((e) => [parseInt(e.getAttribute("data-string")!), parseInt(e.getAttribute("data-fret")!)]));
  const open = [67, 60, 64, 69];
  const inScale = new Set([0, 2, 4, 5, 7, 9, 11]);
  expect(notes.every(([s, f]) => inScale.has((open[s] + f) % 12))).toBe(true);
  const frets = notes.map((n) => n[1]);
  expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(11);
});

test("each instrument has its own tunings, and the choice is remembered", async ({ page }) => {
  await pick(page, "4-string bass");
  await page.locator('button[aria-label="Theory Training settings"]').click();
  const dlg = page.locator('[role="dialog"][aria-label="Theory Training settings"]');
  await expect(dlg.locator('select[aria-label="Instrument"]')).toHaveValue("bass4");
  await expect(dlg.locator('select[aria-label="Tuning"] option').first()).toHaveText("Standard (E A D G)");
  await dlg.locator('select[aria-label="Tuning"]').selectOption({ label: "Drop D (D A D G)" });
  await dlg.locator("button", { hasText: "Done" }).click();
  expect((await names(page))[0]).toBe("D");
  await page.reload();
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  expect(await names(page)).toEqual(["D", "A", "D", "G"]);
});

test("every page works on a bass: no errors, and what needs six strings says so", async ({ page }) => {
  await pick(page, "4-string bass");
  for (const tab of ["Arpeggios", "Chords", "Progressions", "Practice", "Speed", "Quiz"]) {
    await page.locator(".fb-tab", { hasText: tab }).click();
    await expect(page.locator(".error-modal")).toHaveCount(0);
  }
  await page.locator(".fb-tab", { hasText: "Practice" }).click();
  await page.locator('select[aria-label="Routine"]').selectOption({ label: "CAGED" });
  await expect(page.locator(".fb-practice-message").first()).toContainText("standard tuning");
  await page.locator('select[aria-label="Routine"]').selectOption({ label: "Chord relay" });
  await expect(page.locator(".fb-practice-message").first()).toContainText("six-string");
  await page.locator('select[aria-label="Routine"]').selectOption({ label: "Position ladder" });
  expect(await page.locator(".fb-step-chip").count()).toBeGreaterThan(5);
});

test("playing and quizzes follow the instrument's strings", async ({ page }) => {
  await pick(page, "4-string bass");
  await page.getByTestId("fb-play").click();
  await expect(page.locator(".fb-note--playing").first()).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);
  await page.getByTestId("fb-play").click();
  await expect(page.locator(".modal-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-card")).toHaveCount(0);
  await page.locator(".fb-tab", { hasText: "Quiz" }).click();
  // Changing page after starting asks to save: close that too.
  await expect(page.locator(".modal-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-card")).toHaveCount(0);
  await page.locator(".fb-quiz-kind", { hasText: "Find the note" }).click();
  await page.getByRole("button", { name: /Start/ }).first().click();
  await expect(page.locator('.fb-note[data-pickable="true"]')).toHaveCount(4 * 23);
  await expect(page.locator(".fb-pick-string")).toHaveCount(4);
});

test("chord shapes are drawn with the instrument's strings", async ({ page }) => {
  await pick(page, "Ukulele");
  await page.locator(".fb-tab", { hasText: "Chords" }).click();
  await expect(page.locator(".chord-box .chord-box__string")).toHaveCount(4);
  await pick(page, "7-string guitar");
  await expect(page.locator(".chord-box .chord-box__string")).toHaveCount(7);
});
