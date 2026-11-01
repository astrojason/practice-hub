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

const challenge = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  period: "daily",
  title: "Clean up the bridge of Song Ten",
  description: "Your notes say the bridge is sloppy.",
  goal_type: "item_minutes",
  item_type: "song",
  item_id: 10,
  item_name: "Song Ten",
  session_type: null,
  target: 15,
  current: 5,
  unit: "minutes",
  measurable: true,
  completed: false,
  status: "active",
  start_timestamp: 1,
  end_timestamp: 2,
  completed_timestamp: null,
  ...overrides,
});

const manual = challenge({
  id: 3,
  period: "monthly",
  title: "Record a take of the solo",
  goal_type: "manual",
  measurable: false,
  unit: null,
  target: 1,
  current: 0,
});

async function setup(
  page: import("@playwright/test").Page,
  listResponse: () => { status: number; body: unknown },
) {
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
  await page.route("**/user-ai-challenge", (route) => {
    const { status, body } = listResponse();
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
}

test("shows the current AI challenges with their progress", async ({ page }) => {
  await setup(page, () => ({
    status: 200,
    body: {
      current: [
        challenge(),
        challenge({ id: 2, period: "weekly", title: "Learn a new song", goal_type: "learn_songs",
          unit: "songs", target: 1, current: 0, item_name: null }),
        manual,
      ],
      recent: [],
    },
  }));

  const panel = page.locator(".ai-challenges");
  await expect(panel).toBeVisible();
  const daily = panel.locator('[data-challenge-id="1"]');
  await expect(daily).toContainText("Today");
  await expect(daily).toContainText("Clean up the bridge of Song Ten");
  await expect(daily).toContainText("Your notes say the bridge is sloppy.");
  await expect(daily).toContainText("5 / 15 minutes");
  await expect(panel.locator('[data-challenge-id="2"]')).toContainText("This week");
  await expect(panel.locator('[data-challenge-id="3"]')).toContainText("This month");
  await expect(daily.getByRole("button", { name: "Mark done" })).toHaveCount(0);
});

test("a manual challenge can be marked done and undone", async ({ page }) => {
  let current = manual;
  const puts: unknown[] = [];
  await page.route("**/user-ai-challenge/3", async (route) => {
    const body = route.request().postDataJSON();
    puts.push(body);
    const completed = body.action === "complete";
    current = { ...manual, completed, current: completed ? 1 : 0, status: completed ? "completed" : "active" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ challenge: current }) });
  });
  await setup(page, () => ({ status: 200, body: { current: [current], recent: [] } }));

  const row = page.locator('[data-challenge-id="3"]');
  await row.getByRole("button", { name: "Mark done" }).click();
  await expect(row).toContainText("Done");
  await row.getByRole("button", { name: "Undo" }).click();
  await expect(row.getByRole("button", { name: "Mark done" })).toBeVisible();
  expect(puts).toEqual([{ action: "complete" }, { action: "reopen" }]);
});

test("a failed check-off shows the server's error", async ({ page }) => {
  await page.route("**/user-ai-challenge/3", (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This challenge has ended" }) })
  );
  await setup(page, () => ({ status: 200, body: { current: [manual], recent: [] } }));

  await page.locator('[data-challenge-id="3"]').getByRole("button", { name: "Mark done" }).click();
  await expect(page.locator(".error-modal")).toContainText("This challenge has ended");
});

test("a failed load shows the error instead of failing silently", async ({ page }) => {
  await setup(page, () => ({ status: 500, body: { error: "AI challenges exploded" } }));

  await expect(page.locator(".error-modal")).toContainText("AI challenges exploded");
});

test("nothing is shown when there are no challenges yet", async ({ page }) => {
  await setup(page, () => ({ status: 200, body: { current: [], recent: [] } }));

  await expect(page.locator(".session-view")).toBeVisible();
  await expect(page.locator(".ai-challenges")).toHaveCount(0);
});
