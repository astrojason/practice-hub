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
    if (!localStorage.getItem("ph:fretboard:settings")) localStorage.setItem("ph:fretboard:settings", JSON.stringify({ countIn: 0 }));
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
const STD = [40, 45, 50, 55, 59, 64];
const pickables = (page: P) => page.locator('.fb-note[data-pickable="true"]');

async function startFind(page: P) {
  await page.locator(".fb-tab", { hasText: "Quiz" }).click();
  await page.locator(".fb-quiz-kind", { hasText: "Find the note" }).click();
  await page.getByRole("button", { name: /Start/ }).first().click();
}
const targetPc = async (page: P) => parseInt((await page.locator(".fb-find-prompt").getAttribute("data-pc")) ?? "0");

/** A spot on the neck (string, fret) that is the note, or isn't. */
async function spot(page: P, wantRight: boolean, onString?: number) {
  const pc = await targetPc(page);
  const all = await pickables(page).evaluateAll((els) => els.map((e) => [parseInt(e.getAttribute("data-string")!), parseInt(e.getAttribute("data-fret")!)]));
  const found = all.find(([s, f]) => ((STD[s] + f) % 12 === pc) === wantRight && (onString === undefined || s === onString));
  if (!found) throw new Error("no spot");
  return found as [number, number];
}
const click = (page: P, [s, f]: [number, number]) => page.locator(`.fb-note[data-string="${s}"][data-fret="${f}"]`).dispatchEvent("click");

test("Find the note names a note and lets you click it anywhere on the neck", async ({ page }) => {
  await startFind(page);
  await expect(page.locator(".fb-find-prompt")).toContainText("Find");
  await expect(page.locator(".fb-quiz-choice")).toHaveCount(0);
  await expect(pickables(page)).toHaveCount(6 * 23);
  await click(page, await spot(page, true));
  await expect(page.locator(".fb-quiz-feedback")).toContainText("Correct!");
  await expect(page.locator(".fb-quiz-score")).toHaveText("1 / 1");
  await expect(pickables(page)).toHaveCount(0);
  await expect(page.locator(".fb-note--right")).toHaveCount(1);
});

test("a wrong pick is marked, and every right spot is shown", async ({ page }) => {
  await startFind(page);
  await click(page, await spot(page, false));
  await expect(page.locator(".fb-quiz-feedback")).toContainText("Not quite.");
  await expect(page.locator(".fb-note--wrong")).toHaveCount(1);
  expect(await page.locator(".fb-note--answer").count()).toBeGreaterThan(3);
  await expect(page.locator(".fb-quiz-score")).toHaveText("0 / 1");
  // A second click on the neck after answering does nothing.
  await expect(page.locator(".fb-quiz-score")).toHaveText("0 / 1");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-quiz-feedback")).toHaveCount(0);
  await expect(pickables(page)).toHaveCount(6 * 23);
});

test("the strings you pick are tracked, in the session and in the report", async ({ page }) => {
  await startFind(page);
  await click(page, await spot(page, true, 1));
  await page.keyboard.press("Enter");
  await click(page, await spot(page, false, 1));
  await page.keyboard.press("Enter");
  await click(page, await spot(page, true, 4));
  const rows = page.locator(".fb-pick-string");
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(1)).toContainText("2 (50% right)");
  await expect(rows.nth(4)).toContainText("1 (100% right)");
  await expect(rows.nth(0)).toHaveAttribute("data-picks", "0");
  // Saved with each answer: the string and fret that were clicked.
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("ph:fretboard:quiz-history") ?? "[]"));
  expect(records).toHaveLength(3);
  expect(records.every((r: { kind: number }) => r.kind === 5)).toBe(true);
  expect(records[0].spot[0]).toBe(1);
  expect(records[2].spot[0]).toBe(4);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".modal-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open the report" }).first().click();
  const report = page.locator('[role="dialog"][aria-label="Quiz report"]');
  await expect(report).toContainText("Strings you pick");
  await expect(report.locator(".fb-report__strings tbody tr")).toHaveCount(6);
  await expect(report.locator(".fb-report__strings tbody tr").nth(1)).toContainText("2");
});

test("the fret limit keeps the clickable neck inside the chosen frets", async ({ page }) => {
  await page.locator(".fb-tab", { hasText: "Quiz" }).click();
  await page.locator(".fb-quiz-kind", { hasText: "Find the note" }).click();
  await page.locator(".fb-quiz-side label", { hasText: "0–5" }).locator("input").check();
  await page.getByRole("button", { name: /Start/ }).first().click();
  await expect(pickables(page)).toHaveCount(6 * 6);
  const frets = await pickables(page).evaluateAll((els) => els.map((e) => parseInt(e.getAttribute("data-fret")!)));
  expect(Math.max(...frets)).toBe(5);
});

test("Find the note counts as a Quiz session in the Open Session notes", async ({ page }) => {
  await startFind(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".modal-card textarea")).toHaveValue(/Quiz: Find the note/);
});

test("how well each note is found feeds the weak spots", async ({ page }) => {
  await page.addInitScript(() => {
    const rec = (item: string, correct: boolean, ms: number) => ({ when: 1, session: 1, kind: 5, item, correct, ms, key: 0, spot: [0, 3] });
    const h = [rec("Eb", false, 4000), rec("Eb", false, 4000), rec("Eb", false, 4000)];
    localStorage.setItem("ph:fretboard:quiz-history", JSON.stringify(h));
  });
  await page.reload();
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await expect(page.locator(".fb-weak-card")).toContainText("Naming D#/Eb");
});
