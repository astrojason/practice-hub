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
      id: 1,
      name: "Test Exercise",
      order: 1,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      resources: [
        { name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file" },
      ],
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

  // The player-preset key specifically fails to persist (e.g. storage quota
  // exceeded) — everything else in localStorage keeps working normally.
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "practicePlayerPresets") {
        throw new Error("QuotaExceededError: localStorage is full");
      }
      return originalSetItem.call(this, key, value);
    };
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
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "audio/mpeg" }, body: Buffer.from([]) })
  );

  await page.goto("/");
});

test("a failed player-preset save surfaces the real error instead of silently losing loop/speed settings", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();

  await expect(page.locator(".media-player")).toBeVisible();

  await expect(page.locator(".error-modal")).toHaveCount(0);

  // Changing speed schedules a debounced preset save.
  const speedInput = page.locator(".media-player__speed-input");
  await speedInput.fill("1.5");
  await speedInput.blur();

  await expect(page.locator(".error-modal")).toBeVisible();
  await expect(page.getByText(/QuotaExceededError/i)).toBeVisible();
});
