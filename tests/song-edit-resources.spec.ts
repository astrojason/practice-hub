import { test, expect } from "@playwright/test";

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
  to_review: { id: 99, type: 3, name: "Review", session_playlist: false, created_timestamp: 0, updated_timestamp: 0, songs: [] },
  to_learn: { id: 98, type: 4, name: "To Learn", session_playlist: false, created_timestamp: 0, updated_timestamp: 0, songs: [] },
  project: {
    id: 1,
    type: 5,
    name: "Project",
    session_playlist: false,
    created_timestamp: 0,
    updated_timestamp: 0,
    songs: [
      {
        id: 615,
        name: "Nightrain",
        artist_id: 42,
        artist_name: "Guns n' Roses",
        tuning_id: 1,
        tuning_name: "E♭ standard",
        bpm: null,
        active: true,
        resources: [],
        tags: [],
        seconds: null,
        session_type: "song",
        created_timestamp: 0,
        updated_timestamp: 0,
        meta: {
          date_learned: null,
          difficulty: null,
          difficulty_name: null,
          song_lists: [],
          sessions: [],
          sections: [],
        },
      },
    ],
  },
  exercises: [],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

const mockArtists = { artists: [{ id: 42, name: "Guns n' Roses" }] };
const mockTunings = { tunings: [{ id: 1, name: "E♭ standard" }] };

test.beforeEach(async ({ page }) => {
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

  await page.route("**/artist**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockArtists) })
  );

  await page.route("**/tuning**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockTunings) })
  );

  await page.goto("/");
});

test("song edit blocks save when two resources share a blank name, instead of sending a duplicate to the API", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let putFired = false;
  await page.route("**/song/615", async (route) => {
    if (route.request().method() === "PUT") {
      putFired = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard.project.songs[0]) });
    } else {
      await route.continue();
    }
  });

  const songCard = page.locator(".item-card", { hasText: "Nightrain" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();

  // Add two resources, both left with a blank name, only URLs filled in.
  const addButton = page.locator(".edit-resource-header button", { hasText: "Add" });
  await addButton.click();
  await addButton.click();

  const urlInputs = page.locator('.edit-resource-row input[placeholder="https://..."]');
  await urlInputs.nth(0).fill("https://example.com/one");
  await urlInputs.nth(1).fill("https://example.com/two");

  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  // Should surface an inline validation error and must NOT hit the API with duplicate names.
  await expect(page.getByText(/resource.*name/i)).toBeVisible();
  expect(putFired).toBe(false);
});

test("song edit blocks save when two resources share the same non-empty name", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let putFired = false;
  await page.route("**/song/615", async (route) => {
    if (route.request().method() === "PUT") {
      putFired = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard.project.songs[0]) });
    } else {
      await route.continue();
    }
  });

  const songCard = page.locator(".item-card", { hasText: "Nightrain" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();

  const addButton = page.locator(".edit-resource-header button", { hasText: "Add" });
  await addButton.click();
  await addButton.click();

  const nameInputs = page.locator('.edit-resource-row input[placeholder="Name"]');
  await nameInputs.nth(0).fill("Tab");
  await nameInputs.nth(1).fill("Tab");

  const urlInputs = page.locator('.edit-resource-row input[placeholder="https://..."]');
  await urlInputs.nth(0).fill("https://example.com/one");
  await urlInputs.nth(1).fill("https://example.com/two");

  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  await expect(page.getByText(/resource.*name/i)).toBeVisible();
  expect(putFired).toBe(false);
});

test("song edit allows save when resource names are unique and non-empty", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/song/615", async (route) => {
    if (route.request().method() === "PUT") {
      capturedBody = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard.project.songs[0]) });
    } else {
      await route.continue();
    }
  });

  const songCard = page.locator(".item-card", { hasText: "Nightrain" });
  await expect(songCard).toBeVisible();
  await songCard.locator('button[title="Edit"]').click();

  const addButton = page.locator(".edit-resource-header button", { hasText: "Add" });
  await addButton.click();
  await addButton.click();

  const nameInputs = page.locator('.edit-resource-row input[placeholder="Name"]');
  await nameInputs.nth(0).fill("Tab");
  await nameInputs.nth(1).fill("Backing Track");

  const urlInputs = page.locator('.edit-resource-row input[placeholder="https://..."]');
  await urlInputs.nth(0).fill("https://example.com/one");
  await urlInputs.nth(1).fill("https://example.com/two");

  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  expect(capturedBody).not.toBeNull();
  const resources = (capturedBody as { resources: { name: string; url: string }[] }).resources;
  expect(resources).toHaveLength(2);
  expect(resources.map((r) => r.name).sort()).toEqual(["Backing Track", "Tab"]);
});
