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
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [
    {
      id: 701,
      name: "Metronome Drill",
      order: 1,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      resources: [],
      meta: { user_exercise: null, sessions: [] },
    },
  ],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

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

  await page.goto("/");
});

test("exercise edit blocks save when two resources share the same non-empty name", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let putFired = false;
  await page.route("**/exercise/701", async (route) => {
    if (route.request().method() === "PUT") {
      putFired = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard.exercises[0]) });
    } else {
      await route.continue();
    }
  });

  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Metronome Drill" });
  await expect(card).toBeVisible();
  await card.locator('button[title="Edit"]').click();

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
