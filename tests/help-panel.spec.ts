import { test, expect } from "@playwright/test";

// ─── Mock fixtures ────────────────────────────────────────────────────────────

const mockUser = {
  id: 1,
  firebase_uid: "test-uid",
  email: "test@example.com",
  display_name: "Test User",
  daily_minutes_goal: 30,
  timezone: "America/New_York",
  time_practiced_today: 0,
  total_time_practiced: 0,
  max_days_no_review: 7,
  min_days_between_reviews: 1,
  num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id_token: "fake-id-token",
        refresh_token: "fake-refresh-token",
      }),
    })
  );

  await page.route("**/user/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockUser),
    })
  );

  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockDashboard),
    })
  );

  await page.goto("/");
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("Help nav button is visible in session view", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await expect(page.locator("button", { hasText: "Help" })).toBeVisible();
});

test("Help button opens a modal listing tutorials", async ({ page }) => {
  await page.locator("button", { hasText: "Help" }).click();

  await expect(page.locator(".help-modal")).toBeVisible();
  await expect(
    page.locator(".help-modal-list-item", { hasText: "Calendar & Practice Plans" })
  ).toBeVisible();
});

test("Selecting a tutorial shows its content", async ({ page }) => {
  await page.locator("button", { hasText: "Help" }).click();
  await page.locator(".help-modal-list-item", { hasText: "Calendar & Practice Plans" }).click();

  await expect(
    page.locator(".help-modal-content", { hasText: "Using the Practice Calendar" })
  ).toBeVisible();
  await expect(
    page.locator(".help-modal-content", { hasText: "Opening the Calendar" })
  ).toBeVisible();
});

test("Escape closes the Help modal", async ({ page }) => {
  await page.locator("button", { hasText: "Help" }).click();
  await expect(page.locator(".help-modal")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".help-modal")).not.toBeVisible();
});

const otherTutorials = [
  { title: "GP Library", heading: "Guitar Pro Library" },
  { title: "Browse", heading: "Browse" },
  { title: "Sessions & Practice Timer", heading: "Sessions & the Practice Timer" },
  { title: "Metronome", heading: "Metronome" },
];

for (const { title, heading } of otherTutorials) {
  test(`Help modal lists and shows the "${title}" tutorial`, async ({ page }) => {
    await page.locator("button", { hasText: "Help" }).click();

    await expect(
      page.locator(".help-modal-list-item", { hasText: title })
    ).toBeVisible();

    await page.locator(".help-modal-list-item", { hasText: title }).click();

    await expect(
      page.locator(".help-modal-content", { hasText: heading })
    ).toBeVisible();
  });
}
