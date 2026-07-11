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
      name: "Solo Exercise",
      order: 1,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      resources: [
        { name: "Tab", url: "/path/to/tab.gp5", type: "guitar_pro" },
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
  // Mock the Tauri IPC bridge so GpViewer's plugin calls (store/event) resolve
  // instead of throwing in a browser-only test context.
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = {
      invoke: function (cmd: string) {
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        if (cmd === "plugin:store|get") return Promise.resolve([null, false]);
        if (cmd === "plugin:store|set") return Promise.resolve(null);
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:store|has") return Promise.resolve(false);
        if (cmd === "plugin:store|get_store") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        return Promise.resolve(null);
      },
      transformCallback: function () {
        return Math.random();
      },
    };
  });

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
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 404, body: "not found" })
  );

  await page.goto("/");
});

test("opening a GP resource during a normal (non-sequential) session does not stop the timer or kill the session modal", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();

  const card = page.locator(".item-card", { hasText: "Solo Exercise" }).first();
  await expect(card).toBeVisible();

  // Start the timer directly (this is a normal single-item session, not sequential).
  await card.locator('button[title="Start timer"]').click();

  const elapsedBtn = card.locator(".item-elapsed");
  await expect(elapsedBtn).toBeVisible();

  // Let the timer accumulate a couple of seconds before opening media.
  await page.waitForTimeout(2200);

  // Open the GP resource from within the session modal.
  await page.locator(".modal-resource-link--local", { hasText: "Tab" }).click();
  await expect(page.locator(".gp-viewer")).toBeVisible();

  // The timer must keep running in the background while the GP viewer is open.
  await page.waitForTimeout(1500);
  const elapsedWhileOpen = await elapsedBtn.textContent();
  expect(elapsedWhileOpen).not.toBe("0:00");

  // Close the GP viewer.
  await page.locator(".gp-viewer-close").click();
  await expect(page.locator(".gp-viewer")).not.toBeVisible();

  // The session modal must reopen automatically, and the elapsed time must not
  // have been reset — the underlying session/timer was never cancelled.
  await expect(page.locator(".modal-card")).toBeVisible();
  await expect(page.locator(".modal-elapsed-display")).not.toHaveText("0:00");
});
