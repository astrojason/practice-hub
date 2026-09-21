import { test, expect } from "./base";

const DAY_MS = 86_400_000;
const now = Date.now();
const daysAgo = (n: number) => now - n * DAY_MS;

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

const isoDay = (n: number) => new Date(daysAgo(n)).toLocaleDateString("en-CA");

let nextId = 1;
function exercise(name: string, practicedDaysAgo: number[]) {
  const id = nextId++;
  return {
    id,
    name,
    order: id,
    resources: null,
    session_type: "exercise",
    parent_exercise_id: null,
    created_timestamp: daysAgo(60),
    updated_timestamp: daysAgo(60),
    child_exercises: [],
    meta: {
      user_exercise: null,
      sessions: practicedDaysAgo.map((d, i) => ({
        id: id * 1000 + i,
        exercise_id: id,
        notes: null,
        rating: "Good",
        bpm: null,
        seconds: 60,
        created_timestamp: daysAgo(d),
        updated_timestamp: daysAgo(d),
      })),
    },
  };
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// 7-day streak, then yesterday and the day before missed, today not yet practiced -> gap is open.
const openGap = exercise("Open Gap", range(3, 9));
// Same shape but only a 6-day streak -> no token earned, gap not eligible.
const shortStreak = exercise("Short Streak", range(3, 8));
// Three days missed -> too late for a token.
const threeMissed = exercise("Three Missed", range(4, 10));
// Live 7-day streak through today: token banked, but no gap to cover.
const banked = exercise("Banked Token", range(0, 6));
// 14 completions -> two tokens accumulated.
const twoTokens = exercise("Two Tokens", range(0, 13));
// Token was spent on a past gap (see uses below): 7 + gap + 1 completion today -> 8, balance 0.
const spentPast = exercise("Spent Past", [0, ...range(3, 9)]);
// Open gap, but its only token was already spent elsewhere -> no button.
const balanceZero = exercise("Balance Zero", range(3, 9));
// Open gap that fails to record.
const failing = exercise("Failing Item", range(3, 9));
// Recorded use covering an open gap keeps the streak alive while today is pending.
const coveredOpen = exercise("Covered Open", range(3, 9));

const mockUses = [
  // Spent Past: covers days 2 and 1 ago.
  { id: 1, item_type: "exercise", item_id: spentPast.id, covered_from: isoDay(2), covered_to: isoDay(1), created_timestamp: daysAgo(0) },
  // Balance Zero: token spent on some earlier, unrelated gap.
  { id: 2, item_type: "exercise", item_id: balanceZero.id, covered_from: isoDay(40), covered_to: isoDay(39), created_timestamp: daysAgo(38) },
  // Covered Open: already covers the currently open gap.
  { id: 3, item_type: "exercise", item_id: coveredOpen.id, covered_from: isoDay(2), covered_to: isoDay(1), created_timestamp: daysAgo(0) },
];

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [openGap, shortStreak, threeMissed, banked, twoTokens, spentPast, balanceZero, failing, coveredOpen],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

let posted: Record<string, unknown>[] = [];

test.beforeEach(async ({ page }) => {
  posted = [];
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
  await page.route("**/user-streak-token", (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ uses: mockUses }) });
    }
    const body = req.postDataJSON();
    if (body.item_id === failing.id) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "A streak token was already used for this gap" }) });
    }
    posted.push(body);
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: 99, created_timestamp: Date.now(), ...body }),
    });
  });
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
});

const card = (page: import("@playwright/test").Page, name: string) => page.locator(".item-card", { hasText: name });
const badge = (page: import("@playwright/test").Page, name: string) => card(page, name).locator(".tag-streak");
const useButton = (page: import("@playwright/test").Page, name: string) =>
  card(page, name).getByRole("button", { name: /use streak token/i });

test("an open two-day gap on a 7+ day streak shows the at-risk streak and a use-token button", async ({ page }) => {
  await expect(badge(page, "Open Gap")).toContainText("🔥 7");
  await expect(badge(page, "Open Gap")).toContainText("🛡️ 1");
  await expect(useButton(page, "Open Gap")).toBeVisible();
});

test("nothing is forgiven automatically: no button and no streak below 7 days", async ({ page }) => {
  await expect(badge(page, "Short Streak")).toHaveCount(0);
  await expect(useButton(page, "Short Streak")).toHaveCount(0);
});

test("no button once a third day has been missed", async ({ page }) => {
  await expect(badge(page, "Three Missed")).toHaveCount(0);
  await expect(useButton(page, "Three Missed")).toHaveCount(0);
});

test("a live streak shows its banked token but no button (no gap to cover)", async ({ page }) => {
  await expect(badge(page, "Banked Token")).toContainText("🔥 7");
  await expect(badge(page, "Banked Token")).toContainText("🛡️ 1");
  await expect(useButton(page, "Banked Token")).toHaveCount(0);
});

test("tokens accumulate: one per 7 completed days", async ({ page }) => {
  await expect(badge(page, "Two Tokens")).toContainText("🔥 14");
  await expect(badge(page, "Two Tokens")).toContainText("🛡️ 2");
});

test("a recorded use forgives its gap so the streak continues (7 -> 8) and spends the token", async ({ page }) => {
  await expect(badge(page, "Spent Past")).toContainText("🔥 8");
  await expect(badge(page, "Spent Past")).not.toContainText("🛡️");
});

test("no button when the item has no token balance left", async ({ page }) => {
  await expect(badge(page, "Balance Zero")).toHaveCount(0);
  await expect(useButton(page, "Balance Zero")).toHaveCount(0);
});

test("a recorded use on the open gap keeps the streak alive and removes the button", async ({ page }) => {
  await expect(badge(page, "Covered Open")).toContainText("🔥 7");
  await expect(useButton(page, "Covered Open")).toHaveCount(0);
});

test("clicking use-token records the covered dates and consumes the token", async ({ page }) => {
  await useButton(page, "Open Gap").click();
  await expect(useButton(page, "Open Gap")).toHaveCount(0);
  await expect(badge(page, "Open Gap")).toContainText("🔥 7");
  await expect(badge(page, "Open Gap")).not.toContainText("🛡️");
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    item_type: "exercise",
    item_id: openGap.id,
    covered_from: isoDay(2),
    covered_to: isoDay(1),
  });
});

test("a failed use-token request surfaces the actual error", async ({ page }) => {
  await useButton(page, "Failing Item").click();
  await expect(page.locator(".error-modal")).toContainText("already used for this gap");
});
