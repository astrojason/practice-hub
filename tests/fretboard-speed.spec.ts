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
      // A short session so a rest comes quickly: 4 rounds of 10 s with 3 s rests.
      localStorage.setItem(
        "ph:fretboard:settings",
        JSON.stringify({ countIn: 0, notesPerBeat: 4, click: false, speed: { minutes: 1, startBpm: 100, targetBpm: 160, workSecs: 10, restSecs: 3, exercise: "scale" } }),
      );
    }
  });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await page.locator(".fb-tab", { hasText: "Speed" }).click();
});

test("setup shows the plan for the session", async ({ page }) => {
  await expect(page.locator(".fb-speed-summary")).toContainText("4 rounds of 10 s with 3 s rests: 100 to 160 bpm");
  await page.locator('select[aria-label="Speed exercise"]').selectOption({ label: "Arpeggio" });
  await expect(page.locator('select[aria-label="Speed chord"]')).toBeVisible();
  await page.locator('select[aria-label="Speed exercise"]').selectOption({ label: "Scale sequence" });
  await expect(page.locator('select[aria-label="Speed pattern"]')).toBeVisible();
  await expect(page.locator(".fb-speed")).toContainText("Plays C Major (Ionian)");
});

test("starting runs round 1 at the start tempo, then rests, and stopping saves the session to the log", async ({ page }) => {
  await page.getByRole("button", { name: /Start session/ }).click();
  await expect(page.locator(".fb-speed-run")).toContainText("Round 1 of 4");
  await expect(page.locator(".fb-speed-run")).toContainText("100 bpm");
  await expect(page.locator(".fb-speed-seg")).toHaveCount(7);
  await expect(page.locator(".fb-note--playing").first()).toBeVisible();
  await expect(page.locator(".fb-speed-run")).toContainText("Rest", { timeout: 14000 });
  await expect(page.locator(".fb-speed-run")).toContainText("next round at 120 bpm");
  await page.getByRole("button", { name: "Stop session" }).click();
  await expect(page.locator(".fb-notice")).toContainText("Session saved");
  await expect(page.locator(".fb-speed-log tbody tr")).toHaveCount(1);
  await expect(page.locator(".fb-speed-log")).toContainText("(stopped)");
  await expect(page.locator(".fb-speed-chart")).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("the log is kept and can be filtered by kind of run", async ({ page }) => {
  await page.getByRole("button", { name: /Start session/ }).click();
  await expect(page.locator(".fb-speed-run")).toContainText("Round 1 of 4");
  await page.getByRole("button", { name: "Stop session" }).click();
  await page.reload();
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await page.locator(".fb-tab", { hasText: "Speed" }).click();
  await expect(page.locator(".fb-speed-log tbody tr")).toHaveCount(1);
  await page.getByRole("radio", { name: "Arpeggio", exact: true }).check();
  await expect(page.locator(".fb-speed-empty")).toBeVisible();
  await page.getByRole("radio", { name: "All runs" }).check();
  await expect(page.locator(".fb-speed-log tbody tr")).toHaveCount(1);
});

test("a session puts what was practised into the Open Session notes", async ({ page }) => {
  await page.getByRole("button", { name: /Start session/ }).click();
  await expect(page.locator(".fb-speed-run")).toContainText("Round 1 of 4");
  await page.getByRole("button", { name: "Stop session" }).click();
  await page.locator("button", { hasText: "Back" }).first().click();
  await page.locator(".btn-open-session-active").click();
  const notes = page.locator(".modal-notes-label textarea");
  await expect(notes).toHaveValue(/Speed trainer: Scale run/);
  await expect(notes).toHaveValue(/100 to 160 bpm/);
  await expect(notes).toHaveValue(/Speed session saved/);
});

test("speed bursts are one setting shared with the Practice page", async ({ page }) => {
  await page.locator('select[aria-label="Speed bursts"]').selectOption("6");
  await page.locator(".fb-tab", { hasText: "Practice" }).click();
  await expect(page.locator('select[aria-label="Speed bursts"]')).toHaveValue("6");
});

test("bursts show a badge during a session", async ({ page }) => {
  await page.locator('select[aria-label="Speed bursts"]').selectOption("4");
  await page.getByRole("button", { name: /Start session/ }).click();
  await expect(page.locator(".fb-pass-badge")).toBeVisible();
  await page.getByRole("button", { name: "Stop session" }).click();
});
