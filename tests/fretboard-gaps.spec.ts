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
});

type P = import("@playwright/test").Page;
const tab = (page: P, name: string) => page.locator(".fb-tab", { hasText: name }).click();

test("the side panel names every note of the scale as a chip you can click to hear, with the steps between them", async ({ page }) => {
  const chips = page.locator(".fb-tone-chip");
  await expect(chips).toHaveCount(7);
  await expect(chips.first()).toContainText("1");
  await expect(chips.first()).toContainText("C");
  await expect(chips.nth(2)).toHaveAttribute("title", /Major 3rd — E/);
  await chips.nth(2).click();
  await expect(page.locator(".error-modal")).toHaveCount(0);
  await expect(page.locator(".fb-steps")).toHaveText("Steps: W – W – H – W – W – W – H");
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Harmonic Minor" });
  await expect(page.locator(".fb-steps")).toContainText("W+H");
});

test("a 12-step strip shows which half steps belong to the scale, with their degrees, and plays them when clicked", async ({ page }) => {
  const cells = page.locator(".fb-strip-cell");
  await expect(cells).toHaveCount(13);
  await expect(page.locator(".fb-strip-cell--in")).toHaveCount(8); // 7 notes plus the octave
  await expect(cells.nth(4)).toHaveClass(/fb-strip-cell--in/);
  await expect(cells.nth(4)).toContainText("3");
  await expect(cells.nth(4)).toContainText("E");
  await expect(cells.nth(1)).not.toHaveClass(/fb-strip-cell--in/);
  await cells.nth(4).click();
  await expect(page.locator(".error-modal")).toHaveCount(0);
  // Where the scale differs from major, a marker shows it.
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Dorian" });
  await expect(page.locator(".fb-strip-cell--in").nth(5)).toContainText("6");
  await expect(page.locator(".fb-strip-marker")).toHaveCount(1);
});

test("a circle of the 12 notes shows the scale as a shape", async ({ page }) => {
  await expect(page.locator(".fb-circle")).toBeVisible();
  await expect(page.locator(".fb-circle__node")).toHaveCount(12);
  await expect(page.locator(".fb-circle__node--in")).toHaveCount(7);
  await expect(page.locator(".fb-circle__scale")).toBeVisible();
});

test("the whole neck is a position choice, and Play uses every note", async ({ page }) => {
  const sel = page.locator('select[aria-label="Position"]');
  const count = await sel.locator("option").count();
  await sel.selectOption({ index: count - 1 });
  await expect(sel.locator("option:checked")).toHaveText("Whole neck");
  expect(await page.locator('.fb-note[data-in-position="true"]').count()).toBeGreaterThan(60);
  await expect(page.locator('.fb-note[data-in-position="false"]')).toHaveCount(0);
  await page.getByTestId("fb-play").click();
  await expect(page.locator(".fb-note--playing").first()).toBeVisible();
  await page.getByTestId("fb-play").click();
});

test("previous and next buttons step through positions, and the shown neighbours have their own colours", async ({ page }) => {
  await page.getByRole("button", { name: "Next position", exact: true }).click();
  await expect(page.locator('select[aria-label="Position"] option:checked')).toContainText("Position 2");
  await page.getByRole("button", { name: "Previous position", exact: true }).click();
  await expect(page.locator('select[aria-label="Position"] option:checked')).toContainText("Position 1");
  await page.locator('select[aria-label="Position"]').selectOption({ index: 2 });
  await page.getByRole("button", { name: "Show next position" }).click();
  await page.getByRole("button", { name: "Show previous position" }).click();
  await expect(page.locator(".fb-note--prev").first()).toBeAttached();
  await expect(page.locator(".fb-note--next").first()).toBeAttached();
});

test("a position can be connected to any other position along chosen strings", async ({ page }) => {
  await page.locator('select[aria-label="Connect to"]').selectOption({ label: "Position 4" });
  await page.locator('button[aria-label="Connect along string 2"]').click();
  expect(await page.locator('.fb-note[data-link="true"]').count()).toBeGreaterThan(0);
  await page.locator('select[aria-label="Connect to"]').selectOption({ label: "Nothing" });
  await expect(page.locator('.fb-note[data-link="true"]')).toHaveCount(0);
});

test("chords in this key can be shown as 7th chords", async ({ page }) => {
  await expect(page.locator(".fb-chord-chip").first()).toContainText("C");
  await page.locator("label", { hasText: "7ths" }).locator("input").check();
  await expect(page.locator(".fb-chord-chip").first()).toContainText("Cmaj7");
  await expect(page.locator(".fb-chord-chip").nth(4)).toContainText("G7");
});

test("while a progression plays, a NOW panel names the chord, its tones and its shape, and the shape can be strummed", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "ii – V – I (jazz)" });
  await expect(page.locator('select[aria-label="Preset"] option:checked')).toHaveText("ii – V – I (jazz)");
  await page.locator(".fb-chord-card").nth(0).click();
  const now = page.locator(".fb-now-panel");
  await expect(now).toContainText("NOW");
  await expect(now).toContainText("Dm7");
  await expect(now.locator(".fb-tone-chip")).toHaveCount(4);
  await expect(now.locator(".chord-box")).toBeVisible();
  await expect(now).toContainText("Over the scale: C Major (Ionian)");
  await now.locator(".chord-box").click();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("the chord shape box can be clicked to strum", async ({ page }) => {
  await tab(page, "Chords");
  await expect(page.locator(".chord-box").first()).toHaveAttribute("aria-label", /click to strum/i);
  await page.locator(".chord-box").first().click();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("when two scales are blended a legend explains the marks", async ({ page }) => {
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Minor Pentatonic" });
  await page.locator('select[aria-label="Blend with"]').selectOption({ label: "Major Pentatonic" });
  const legend = page.locator(".fb-blend-legend");
  await expect(legend).toContainText("In both scales");
  await expect(legend).toContainText("Only in Minor Pentatonic");
  await expect(legend).toContainText("Only in Major Pentatonic");
});

test("the tonality is a badge, and each change from major or minor is a chip", async ({ page }) => {
  await page.locator('select[aria-label="Scale"]').selectOption({ label: "Dorian" });
  await expect(page.locator(".fb-tonality-badge")).toHaveText(/Minor tonality/i);
  await expect(page.locator(".fb-change-chip")).toHaveCount(1);
  await expect(page.locator(".fb-change-chip")).toContainText("natural 6");
  await expect(page.locator(".fb-change-chip")).toContainText("▲");
});

test("a preset is recognised when the progression matches it", async ({ page }) => {
  await tab(page, "Progressions");
  await page.locator('select[aria-label="Preset"]').selectOption({ label: "12-bar blues" });
  await expect(page.locator('select[aria-label="Preset"] option:checked')).toHaveText("12-bar blues");
  await page.locator(".fb-chord-card").first().click();
  await page.locator('.fb-chord-editor select[aria-label="Chord type"]').selectOption({ label: "Minor" });
  await expect(page.locator('select[aria-label="Preset"] option:checked')).toHaveText("Choose a preset…");
});

test("a SoundFont dropped on the window is added; other files are refused with a reason", async ({ page }) => {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["not a soundfont"], "notes.txt"));
    document.querySelector(".fretboard-view")!.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".error-modal-message")).toContainText(/only \.sf2/i);
  await page.locator(".error-modal button", { hasText: "Dismiss" }).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["broken"], "my-guitar.sf2"));
    document.querySelector(".fretboard-view")!.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  // The file is added to the list; this one isn't a real SoundFont, so the reason is shown.
  await expect(page.locator(".error-modal")).toBeVisible({ timeout: 20000 });
});

test("the list of outputs can be looked up again", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Choosing an output needs setSinkId, which this webview may not have");
  await page.locator('button[aria-label="Fretboard settings"]').click();
  const dlg = page.locator('[role="dialog"][aria-label="Fretboard settings"]');
  await dlg.getByRole("button", { name: "Look for outputs again" }).click();
  await expect(page.locator(".error-modal:not(.fb-settings)")).toHaveCount(0);
});

test("when the sound output changes the trainer reconnects and says so", async ({ page }) => {
  await page.getByTestId("fb-play").click();
  await expect(page.locator(".fb-note--playing").first()).toBeVisible();
  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
  await expect(page.locator(".fb-notice")).toContainText("sound output changed");
  await expect(page.getByTestId("fb-play")).toHaveText("Play");
  // Playing again works on the new output.
  await page.getByTestId("fb-play").click();
  await expect(page.locator(".fb-note--playing").first()).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);
  await page.getByTestId("fb-play").click();
});
