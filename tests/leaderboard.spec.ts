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

function board(period: string, overrides: Record<string, unknown> = {}) {
  return {
    period,
    opted_in: true,
    window_start: 1_788_000_000,
    window_end: 1_788_086_400,
    entries: [
      { rank: 1, display_name: "Sam", seconds: 3900, is_me: false },
      { rank: 2, display_name: "Me Myself", seconds: 900, is_me: true },
    ],
    me: { rank: 2, seconds: 900 },
    ...overrides,
  };
}

let profile: { opted_in: boolean; display_name: string | null };
let profilePuts: Record<string, unknown>[];
let periodsRequested: string[];
let boardFor: (period: string) => { status: number; body: unknown };
let putResult: { status: number; body?: unknown } | null;

test.beforeEach(async ({ page }) => {
  profile = { opted_in: true, display_name: "Me Myself" };
  profilePuts = [];
  periodsRequested = [];
  boardFor = (period) => ({ status: 200, body: board(period) });
  putResult = null;

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
  await page.route("**/leaderboard/profile", (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      profilePuts.push(body);
      if (putResult && putResult.status !== 200) {
        return route.fulfill({ status: putResult.status, contentType: "application/json", body: JSON.stringify(putResult.body) });
      }
      profile = {
        opted_in: body.opted_in ?? profile.opted_in,
        display_name: body.display_name ?? profile.display_name,
      };
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
  });
  await page.route("**/leaderboard?**", (route) => {
    const period = new URL(route.request().url()).searchParams.get("period") ?? "";
    periodsRequested.push(period);
    const { status, body } = boardFor(period);
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
});

const open = (page: import("@playwright/test").Page) => page.locator('button[title="Leaderboard"]').click();

test("someone who hasn't opted in sees a join form, not the board", async ({ page }) => {
  profile = { opted_in: false, display_name: null };
  await open(page);
  await expect(page.locator("#lb-name")).toBeVisible();
  await expect(page.locator(".lb-row")).toHaveCount(0);
});

test("joining saves the display name, opts in, and shows the board", async ({ page }) => {
  profile = { opted_in: false, display_name: null };
  await open(page);
  await page.locator("#lb-name").fill("Guitar Hero");
  await page.getByRole("button", { name: /join leaderboard/i }).click();
  await expect(page.locator(".lb-row").first()).toBeVisible();
  expect(profilePuts).toEqual([{ opted_in: true, display_name: "Guitar Hero" }]);
});

test("the daily board shows ranks, names and formatted durations, highlighting the viewer", async ({ page }) => {
  await open(page);
  const first = page.locator(".lb-row").nth(0);
  await expect(first).toContainText("1");
  await expect(first).toContainText("Sam");
  await expect(first).toContainText("1h 05m");
  const mine = page.locator(".lb-row--me");
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("Me Myself");
  await expect(mine).toContainText("15m");
  expect(periodsRequested[0]).toBe("daily");
});

test("the tabs load the weekly, monthly and all-time boards", async ({ page }) => {
  await open(page);
  await expect(page.locator(".lb-row").first()).toBeVisible();
  for (const [label, period] of [["Weekly", "weekly"], ["Monthly", "monthly"], ["All time", "all_time"]]) {
    await page.getByRole("tab", { name: label }).click();
    await expect.poll(() => periodsRequested.includes(period)).toBe(true);
  }
});

test("the all-time board explains it only counts practice since you joined", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "All time" }).click();
  await expect(page.locator(".lb-note")).toContainText(/since you joined/i);
});

test("the viewer's own rank is shown when they fall outside the listed entries", async ({ page }) => {
  boardFor = (period) => ({
    status: 200,
    body: board(period, {
      entries: [{ rank: 1, display_name: "Sam", seconds: 3900, is_me: false }],
      me: { rank: 30, seconds: 120 },
    }),
  });
  await open(page);
  await expect(page.locator(".lb-me-summary")).toContainText("#30");
  await expect(page.locator(".lb-me-summary")).toContainText("2m");
});

test("an empty board has a friendly empty state", async ({ page }) => {
  boardFor = (period) => ({ status: 200, body: board(period, { entries: [], me: { rank: null, seconds: 0 } }) });
  await open(page);
  await expect(page.locator(".lb-empty")).toBeVisible();
});

test("leaving the leaderboard opts out and returns to the join form", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /leave leaderboard/i }).click();
  await expect(page.locator("#lb-name")).toBeVisible();
  expect(profilePuts).toEqual([{ opted_in: false }]);
});

test("a failed board fetch surfaces the real error", async ({ page }) => {
  boardFor = () => ({ status: 500, body: { error: "leaderboard exploded" } });
  await open(page);
  await expect(page.locator(".error-modal")).toContainText("leaderboard exploded");
});

test("a rejected display name surfaces the server's message", async ({ page }) => {
  profile = { opted_in: false, display_name: null };
  putResult = { status: 409, body: { error: "That display name is taken" } };
  await open(page);
  await page.locator("#lb-name").fill("Sam");
  await page.getByRole("button", { name: /join leaderboard/i }).click();
  await expect(page.locator(".error-modal")).toContainText("That display name is taken");
});
