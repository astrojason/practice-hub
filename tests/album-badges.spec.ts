import { test, expect } from "./base";

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

const debut = {
  album_id: 1,
  album_name: "Debut",
  artist_id: 1,
  artist_name: "The Band",
  year: 1999,
  awarded_timestamp: 1_700_000_000,
  song_count: 10,
};
const inProgress = {
  album_id: 2,
  album_name: "Second LP",
  artist_id: 1,
  artist_name: "The Band",
  year: 2003,
  learned: 1,
  required: 3,
};

async function setup(page: import("@playwright/test").Page, badgeResponse: () => { status: number; body: unknown }) {
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }),
    })
  );
  await page.route("**/user/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) })
  );
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) })
  );
  await page.route("**/user-album-badge", (route) => {
    const { status, body } = badgeResponse();
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
}

test("a newly awarded album badge pops an unlock celebration that can be dismissed", async ({ page }) => {
  await setup(page, () => ({
    status: 200,
    body: { badges: [debut], in_progress: [], newly_awarded: [debut] },
  }));
  const modal = page.locator(".badge-unlock-modal");
  await expect(modal).toContainText("Album mastered");
  await expect(modal).toContainText("Debut");
  await expect(modal).toContainText("The Band");
  await modal.getByRole("button", { name: /dismiss|nice|close/i }).click();
  await expect(modal).toHaveCount(0);
});

test("no celebration when nothing was newly awarded", async ({ page }) => {
  await setup(page, () => ({
    status: 200,
    body: { badges: [debut], in_progress: [inProgress], newly_awarded: [] },
  }));
  await expect(page.locator(".badge-unlock-modal")).toHaveCount(0);
});

test("the badges view lists earned badges and progress toward the rest", async ({ page }) => {
  await setup(page, () => ({
    status: 200,
    body: { badges: [debut], in_progress: [inProgress], newly_awarded: [] },
  }));
  await page.locator('button[title="Album badges"]').click();

  const earned = page.locator(".badge-card", { hasText: "Debut" });
  await expect(earned).toContainText("The Band");
  await expect(earned).toContainText("1999");

  const progress = page.locator(".badge-progress-item", { hasText: "Second LP" });
  await expect(progress).toContainText("1 / 3");
});

test("the badges view has an empty state", async ({ page }) => {
  await setup(page, () => ({ status: 200, body: { badges: [], in_progress: [], newly_awarded: [] } }));
  await page.locator('button[title="Album badges"]').click();
  await expect(page.locator(".badges-empty")).toBeVisible();
});

test("a failed badge fetch surfaces the real error", async ({ page }) => {
  await setup(page, () => ({ status: 500, body: { error: "badge sync exploded" } }));
  await expect(page.locator(".error-modal")).toContainText("badge sync exploded");
});
