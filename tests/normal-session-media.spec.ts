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
  // Guitar Pro files now open via the OS's default handler (the real Guitar
  // Pro app) instead of an in-app viewer — invoked through the same
  // open_with_default Tauri command the GP library scanner's "Open in
  // Guitar Pro" button already used. Recorded on window so the test can
  // assert it was called with the right path without actually launching
  // anything.
  await page.addInitScript(() => {
    (window as unknown as { __openWithDefaultCalls: string[] }).__openWithDefaultCalls = [];
    window.__TAURI_INTERNALS__ = {
      invoke: function (cmd: string, args?: Record<string, unknown>) {
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        if (cmd === "plugin:store|get") return Promise.resolve([null, false]);
        if (cmd === "plugin:store|set") return Promise.resolve(null);
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:store|has") return Promise.resolve(false);
        if (cmd === "plugin:store|get_store") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd === "open_with_default") {
          (window as unknown as { __openWithDefaultCalls: string[] }).__openWithDefaultCalls.push(
            String(args?.path)
          );
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      },
      transformCallback: function () {
        return Math.random();
      },
    } as unknown as typeof window.__TAURI_INTERNALS__;
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

  await page.goto("/");
});

test("opening a GP resource during a normal (non-sequential) session opens Guitar Pro externally without stopping the timer or closing the session modal", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();

  const card = page.locator(".item-card", { hasText: "Solo Exercise" }).first();
  await expect(card).toBeVisible();

  // Start the timer directly (this is a normal single-item session, not sequential).
  await card.locator('button[title="Start timer"]').click();

  const elapsedBtn = card.locator(".item-elapsed");
  await expect(elapsedBtn).toBeVisible();

  // Let the timer accumulate a couple of seconds before opening the resource.
  await page.waitForTimeout(2200);

  // Open the GP resource from within the session modal.
  await page.locator(".modal-resource-link--local", { hasText: "Tab" }).click();

  // Guitar Pro opened externally with the right path — no in-app viewer.
  await expect
    .poll(async () =>
      page.evaluate(() => (window as unknown as { __openWithDefaultCalls: string[] }).__openWithDefaultCalls)
    )
    .toEqual(["/path/to/tab.gp5"]);
  await expect(page.locator(".gp-viewer")).toHaveCount(0);

  // Opening an external app is fire-and-forget: the session modal stays
  // open and the timer keeps running uninterrupted throughout.
  await expect(page.locator(".modal-card")).toBeVisible();
  await page.waitForTimeout(1500);
  const elapsedAfter = await elapsedBtn.textContent();
  expect(elapsedAfter).not.toBe("0:00");
});
