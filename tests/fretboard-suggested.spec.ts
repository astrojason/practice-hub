import { test, expect } from "./base";

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

const dashboard = (over: Record<string, unknown>) => ({
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] }, exercises: [], study_materials: [], chord: null, progression: null, interval: null,
  ...over,
});

async function open(page: import("@playwright/test").Page, dash: unknown) {
  await page.addInitScript(() => localStorage.setItem("ph:refreshToken", "fake-refresh-token"));
  await page.route("**/securetoken.googleapis.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "t", refresh_token: "r" }) }));
  await page.route("**/user/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dash) }));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await expect(page.locator(".fretboard-view")).toBeVisible();
}

test("the key and scale cards on the dashboard are where the trainer starts", async ({ page }) => {
  await open(page, dashboard({
    key_signature: { id: 11, name: "E&#9837;", sharps: 0, flats: 3, notes: [] },
    scale: { id: 5, name: "Dorian", formula: "", tonality: "minor", description: "", resources: [] },
  }));
  await expect(page.locator(".fb-key.active")).toHaveText("Eb");
  await expect(page.locator('select[aria-label="Scale"] option:checked')).toHaveText("Dorian");
  await expect(page.locator(".fretboard-title")).toContainText("Eb Dorian");
});

test("Instrumenta's scale names are matched to the trainer's", async ({ page }) => {
  await open(page, dashboard({ scale: { id: 1, name: "Aeolean (natural minor)", formula: "", tonality: "", description: "", resources: [] } }));
  await expect(page.locator('select[aria-label="Scale"] option:checked')).toHaveText("Natural Minor (Aeolian)");
});

test("the chord card is the chord on the Arpeggios page", async ({ page }) => {
  await open(page, dashboard({ chord: { id: 3, name: "Dominant 7th", formula: "", resources: [] } }));
  await page.locator(".fb-tab", { hasText: "Arpeggios" }).click();
  await expect(page.locator('select[aria-label="Chord type"] option:checked')).toHaveText("Dominant 7");
});

test("the progression card is the progression on the Progressions page", async ({ page }) => {
  await open(page, dashboard({
    key_signature: { id: 2, name: "G", sharps: 1, flats: 0, notes: [] },
    progression: { id: 2, name: "ii - V - I", chords: ["ii", "V", "I"] },
  }));
  await page.locator(".fb-tab", { hasText: "Progressions" }).click();
  const cards = page.locator(".fb-chord-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Am");
  await expect(cards.nth(1)).toContainText("D");
  await expect(cards.nth(2)).toContainText("G");
  await expect(page.locator('input[aria-label="Progression name"]')).toHaveValue("ii - V - I");
});

test("with no suggestions the trainer starts at C Major as before", async ({ page }) => {
  await open(page, dashboard({}));
  await expect(page.locator(".fb-key.active")).toHaveText("C");
  await expect(page.locator('select[aria-label="Scale"] option:checked')).toHaveText("Major (Ionian)");
});
