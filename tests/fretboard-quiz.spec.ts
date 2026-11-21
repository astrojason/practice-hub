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

const STD = [40, 45, 50, 55, 59, 64];
type P = import("@playwright/test").Page;
const quiz = async (page: P) => page.locator(".fb-tab", { hasText: "Quiz" }).click();
const start = async (page: P) => page.getByRole("button", { name: /Start/ }).first().click();
const choices = (page: P) => page.locator(".fb-quiz-choice");
const kind = (page: P, name: string) => page.locator(".fb-quiz-kind", { hasText: name }).click();

/** The pitch class of the lit note on the neck, read from where it sits. */
async function litPitchClass(page: P) {
  const el = page.locator('.fb-note[data-quiz="true"]').first();
  const s = parseInt((await el.getAttribute("data-string")) ?? "0");
  const f = parseInt((await el.getAttribute("data-fret")) ?? "0");
  return (STD[s] + f) % 12;
}

test("the quiz offers six kinds and waits for Start", async ({ page }) => {
  await quiz(page);
  await expect(page.locator(".fb-quiz-kind")).toHaveCount(6);
  await expect(page.locator(".fb-quiz-intro")).toContainText("Press Start");
  await expect(choices(page)).toHaveCount(0);
});

test("name the note: a note lights up, both names are offered, and a right answer scores", async ({ page }) => {
  await quiz(page);
  await start(page);
  await expect(choices(page)).toHaveCount(12);
  await expect(choices(page).nth(1)).toHaveText(/C#\/Db/);
  await expect(page.locator('.fb-note[data-quiz="true"]')).toHaveCount(1);
  const pc = await litPitchClass(page);
  await choices(page).nth(pc).click();
  await expect(page.locator(".fb-quiz-feedback")).toContainText("Correct!");
  await expect(page.locator(".fb-quiz-score")).toHaveText("1 / 1");
  await expect(page.locator(".fb-quiz-feedback")).toContainText("String");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-quiz-feedback")).toHaveCount(0);
  const pc2 = await litPitchClass(page);
  await choices(page).nth((pc2 + 1) % 12).click();
  await expect(page.locator(".fb-quiz-feedback")).toContainText("Not quite.");
  await expect(page.locator(".fb-quiz-score")).toHaveText("1 / 2");
});

test("answers have keys: 1 to 9, 0, Q, W; Space moves on", async ({ page }) => {
  await quiz(page);
  await start(page);
  await page.keyboard.press("1");
  await expect(page.locator(".fb-quiz-feedback")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(".fb-quiz-feedback")).toHaveCount(0);
  await page.keyboard.press("w");
  await expect(page.locator(".fb-quiz-feedback")).toBeVisible();
  await expect(choices(page).first().locator(".fb-quiz-key")).toHaveText("1");
});

test("degrees are asked in the chosen key and scale, with the note beside each degree", async ({ page }) => {
  await quiz(page);
  await kind(page, "Find the scale degree");
  await start(page);
  await expect(choices(page)).toHaveCount(7);
  await expect(choices(page).first()).toHaveText(/1\s+\(C\)/);
  await expect(page.locator(".fb-quiz-side")).toContainText("C Major (Ionian)");
});

test("intervals and ear quizzes have their own answer lists; ear questions hide the notes until answered", async ({ page }) => {
  await quiz(page);
  await kind(page, "Name the interval");
  await start(page);
  await expect(choices(page)).toHaveCount(12);
  await expect(page.locator('.fb-note[data-quiz="true"]')).toHaveCount(2);
  await kind(page, "Ear: hear the interval");
  await expect(choices(page)).toHaveCount(12);
  await expect(page.locator('.fb-note[data-quiz="true"]')).toHaveCount(0);
  await choices(page).first().click();
  await expect(page.locator('.fb-note[data-quiz="true"]')).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Hear it/ })).toBeVisible();
  await kind(page, "Ear: chord quality");
  await expect(choices(page)).toHaveCount(7);
  await expect(choices(page).nth(4)).toHaveText(/Dominant 7/);
});

test("the fret limit keeps every question inside the chosen frets", async ({ page }) => {
  await quiz(page);
  await page.locator(".fb-quiz-side label", { hasText: "0–5" }).locator("input").check();
  await start(page);
  for (let i = 0; i < 12; i++) {
    const fret = parseInt((await page.locator('.fb-note[data-quiz="true"]').first().getAttribute("data-fret")) ?? "99");
    expect(fret).toBeLessThanOrEqual(5);
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
  }
});

test("stopping shows a summary, and the history is kept between visits", async ({ page }) => {
  await quiz(page);
  await start(page);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".modal-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".fb-quiz-summary")).toContainText("Last session");
  await expect(page.locator(".fb-quiz-summary")).toContainText("of 3 right");
  await page.reload();
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await quiz(page);
  await expect(page.locator(".fb-quiz-saved")).toContainText("3 answers from 1 session");
});

test("the report shows totals and tables, and clearing the history asks first", async ({ page }) => {
  await quiz(page);
  await start(page);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".modal-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open the report" }).first().click();
  const report = page.locator('[role="dialog"][aria-label="Quiz report"]');
  await expect(report).toContainText("Answered");
  await expect(report).toContainText("4");
  await expect(report).toContainText("Slowest to answer");
  await expect(report).toContainText("Missed most often");
  await expect(report).toContainText("By quiz");
  await report.getByRole("button", { name: /Clear history/ }).click();
  await page.locator(".confirm-modal button", { hasText: "Cancel" }).click();
  await expect(report).toContainText("Answered");
  await report.getByRole("button", { name: /Clear history/ }).click();
  await page.locator(".confirm-modal button", { hasText: "Clear" }).click();
  await expect(report).toContainText("No answers saved yet");
});

test("resetting the score asks first", async ({ page }) => {
  await quiz(page);
  await start(page);
  await page.keyboard.press("1");
  await expect(page.locator(".fb-quiz-score")).toHaveText(/^\d \/ 1$/);
  await page.getByRole("button", { name: /Reset score/ }).click();
  await page.locator(".confirm-modal button", { hasText: "Cancel" }).click();
  await expect(page.locator(".fb-quiz-score")).toHaveText(/^\d \/ 1$/);
  await page.getByRole("button", { name: /Reset score/ }).click();
  await page.locator(".confirm-modal button", { hasText: "Reset" }).click();
  await expect(page.locator(".fb-quiz-score")).toHaveText("0 / 0");
});

test("starting a quiz puts it in the Open Session notes", async ({ page }) => {
  await quiz(page);
  await start(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".modal-card textarea")).toHaveValue(/Quiz: Name the note/);
});

// ── weak spots ──

const weakHistory = () => {
  const rec = (kind: number, item: string, correct: boolean, ms: number, key: number | null, spot: [number, number] | null) => ({ when: 1, session: 1, kind, item, correct, ms, key, spot });
  const h = [];
  for (let i = 0; i < 10; i++) h.push(rec(1, "5", true, 1500, 10, [1, 0]));
  h.push(rec(1, "4", false, 5000, 10, [0, 11]), rec(1, "4", false, 4500, 10, [2, 1]), rec(1, "4", true, 4000, 10, [3, 8]));
  return h;
};

test.describe("weak spots", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((h) => localStorage.setItem("ph:fretboard:quiz-history", JSON.stringify(h)), weakHistory());
    await page.reload();
    await page.locator("button", { hasText: "Theory Training" }).first().click();
    await page.locator(".fb-key", { hasText: /^Bb$/ }).click();
  });

  test("the 4th in Bb is marked on the neck, with the reason on hover, and listed in the side panel", async ({ page }) => {
    await expect(page.locator('.fb-note[data-degree="4"] [data-weak]').first()).toBeAttached();
    await expect(page.locator('.fb-note[data-degree="5"] [data-weak]')).toHaveCount(0);
    await expect(page.locator('.fb-note[data-degree="4"] [data-weak] title').first()).toContainText("1 of 3 right");
    await expect(page.locator(".fb-weak-card")).toContainText("The 4 in Bb");
    await expect(page.locator(".fb-weak-card")).toContainText("3 more quick right answers");
    // Degrees count per key: nothing in C.
    await page.locator(".fb-key", { hasText: /^C$/ }).click();
    await expect(page.locator(".fb-note [data-weak]")).toHaveCount(0);
  });

  test("the marks can be switched off in settings", async ({ page }) => {
    await page.locator('button[aria-label="Theory Training settings"]').click();
    const dlg = page.locator('[role="dialog"][aria-label="Theory Training settings"]');
    await dlg.locator("label", { hasText: "Mark my weak spots" }).locator("input").uncheck();
    await dlg.locator("button", { hasText: "Done" }).click();
    await expect(page.locator(".fb-note [data-weak]")).toHaveCount(0);
    await expect(page.locator(".fb-weak-card")).toHaveCount(0);
  });

  test("Quiz me on these starts a quiz that focuses on them", async ({ page }) => {
    await page.getByRole("button", { name: "Quiz me on these" }).click();
    await expect(page.locator(".fb-tab.active")).toHaveText("Quiz");
    await expect(page.locator(".fb-quiz-kind.active")).toHaveText("Find the scale degree");
    await expect(page.locator(".fb-quiz-side label", { hasText: "Focus on my weak spots" }).locator("input")).toBeChecked();
    await expect(choices(page).first()).toBeVisible();
  });
});

// ── the weakness rules (same cases as the Craft app's tests) ──

test("weakness rules: weak after misses, per-key degrees, clears after three quick right answers, pace from the median", async ({ page }) => {
  const result = await page.evaluate(async (hist) => {
    const { Weakness, MIN_ANSWERS, SLOW } = await import("/src/lib/fretboard/weakness.ts");
    const rec = (kind: number, item: string, correct: boolean, ms: number, key: number | null, spot: [number, number] | null) => ({ when: 1, session: 1, kind, item, correct, ms, key, spot });
    const w = new Weakness(hist as never);
    const out: Record<string, unknown> = {};
    out.weak4 = w.isWeak(w.degree.get("10:4"));
    out.weak5 = w.isWeak(w.degree.get("10:5"));
    out.weak4InC = w.isWeak(w.degree.get("0:4"));
    out.reason = w.reasons(10, "4", 3, [3, 8]);
    out.median = w.avgByKind.get(1);
    out.pace = w.paceMs(1);
    out.paceExpected = 1500 * SLOW;
    out.unjudged = w.paceSource(3);
    out.minAnswers = MIN_ANSWERS;
    // Two quick right answers aren't enough; a slow one doesn't count; three clear it.
    const quick = (h: unknown[]) => h.push(rec(1, "4", true, 1600, 10, null));
    const h2 = [...(hist as unknown[])];
    quick(h2);
    quick(h2);
    const w2 = new Weakness(h2 as never);
    out.stillWeak = w2.isWeak(w2.degree.get("10:4"));
    out.toClear = w2.toClear(w2.degree.get("10:4")!);
    h2.push(rec(1, "4", true, 6000, 10, null));
    const w3 = new Weakness(h2 as never);
    out.slowDoesntCount = w3.isWeak(w3.degree.get("10:4"));
    quick(h2);
    quick(h2);
    quick(h2);
    const w4 = new Weakness(h2 as never);
    out.cleared = !w4.isWeak(w4.degree.get("10:4"));
    // A note name is weak everywhere.
    const h5 = [...(hist as unknown[])];
    for (let i = 0; i < 3; i++) h5.push(rec(0, "Eb", false, 4000, 0, [4, 4]));
    const w5 = new Weakness(h5 as never);
    out.bothReasons = w5.reasons(10, "4", 3, [0, 0]).length;
    out.onlyName = w5.reasons(0, "b3", 3, [0, 0]).length;
    out.otherKeyNone = w5.reasons(5, "4", 10, [0, 0]).length;
    return out;
  }, weakHistory());
  expect(result.weak4).toBe(true);
  expect(result.weak5).toBe(false);
  expect(result.weak4InC).toBe(false);
  expect((result.reason as string[]).some((r) => r.includes("4 in Bb") && r.includes("1 of 3 right") && r.includes("3 more quick right answers"))).toBe(true);
  expect(result.median).toBe(1500);
  expect(result.pace).toBeCloseTo(result.paceExpected as number, 3);
  expect(result.unjudged).toEqual({ ms: null, need: 10 });
  expect(result.stillWeak).toBe(true);
  expect(result.toClear).toBe(1);
  expect(result.slowDoesntCount).toBe(true);
  expect(result.cleared).toBe(true);
  expect(result.bothReasons).toBe(2);
  expect(result.onlyName).toBe(1);
  expect(result.otherKeyNone).toBe(0);
});

test("the usual pace can be a fixed time, set in settings", async ({ page }) => {
  await page.locator('button[aria-label="Theory Training settings"]').click();
  const dlg = page.locator('[role="dialog"][aria-label="Theory Training settings"]');
  await dlg.getByRole("radio", { name: /A fixed time/ }).check();
  await dlg.locator('input[aria-label="Fixed pace (seconds)"]').fill("2");
  await expect(dlg.getByRole("radio", { name: /A fixed time/ })).toBeChecked();
  await dlg.locator("button", { hasText: "Done" }).click();
  await page.reload();
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await page.locator('button[aria-label="Theory Training settings"]').click();
  await expect(page.getByRole("radio", { name: /A fixed time/ })).toBeChecked();
});

test("stopping a quiz opens the Open Session save form with the time and notes filled in; nothing is saved automatically", async ({ page }) => {
  await quiz(page);
  await start(page);
  await page.keyboard.press("1");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const form = page.locator(".modal-card");
  await expect(form).toContainText("Open Session");
  await expect(form.locator('input[type="number"]')).toBeVisible();
  await expect(form.locator("textarea")).toHaveValue(/Quiz: Name the note/);
  await expect(form.getByRole("button", { name: "Log Session" })).toBeVisible();
  // Closing it without logging keeps you in the trainer, with the summary.
  await page.keyboard.press("Escape");
  await expect(page.locator(".fb-quiz-summary")).toBeVisible();
  await expect(page.locator(".fretboard-view")).toBeVisible();
});

test("leaving Theory Training, or changing what is being studied, ends the session with the save form", async ({ page }) => {
  await quiz(page);
  await start(page);
  await page.keyboard.press("1");
  await page.locator(".fb-tab", { hasText: "Scales" }).click();
  await expect(page.locator(".modal-card")).toContainText("Open Session");
  await expect(page.locator(".modal-card textarea")).toHaveValue(/Quiz: Name the note/);
  await expect(page.locator(".fretboard-view")).toBeVisible();
  await page.keyboard.press("Escape");
  // Start again, then leave: the session view shows, with the form open.
  await page.getByTestId("fb-play").click();
  await page.locator("button", { hasText: "Back" }).first().click();
  await expect(page.locator(".fretboard-view")).toHaveCount(0);
  await expect(page.locator(".modal-card")).toContainText("Open Session");
});

test("nothing is asked when no session was started", async ({ page }) => {
  await page.locator(".fb-tab", { hasText: "Arpeggios" }).click();
  await page.locator('.fb-note[data-in-position="true"]').first().click();
  await page.locator(".fb-tab", { hasText: "Chords" }).click();
  await expect(page.locator(".modal-card")).toHaveCount(0);
  await page.locator("button", { hasText: "Back" }).first().click();
  await expect(page.locator(".fretboard-view")).toHaveCount(0);
  await expect(page.locator(".modal-card")).toHaveCount(0);
});

test("the quiz results go into the Open Session notes", async ({ page }) => {
  await quiz(page);
  await start(page);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("1");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const notes = page.locator(".modal-card textarea");
  await expect(notes).toHaveValue(/Quiz result: Name the note: \d of 3 right \(\d+%\), average \d+\.\d s, fastest right \d+\.\d s/);
  await expect(notes).toHaveValue(/slowest: /);
});

test("the Find the note results include the strings picked", async ({ page }) => {
  await quiz(page);
  await page.locator(".fb-quiz-kind", { hasText: "Find the note" }).click();
  await start(page);
  await page.locator('.fb-note[data-pickable="true"][data-string="1"]').first().dispatchEvent("click");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".modal-card textarea")).toHaveValue(/Quiz result: Find the note: \d of 1 right.*strings picked: A 1/);
});
