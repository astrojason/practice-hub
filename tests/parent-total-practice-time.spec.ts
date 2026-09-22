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

function exSession(id: number, exerciseId: number, seconds: number, daysAgoOffset: number) {
  return {
    id,
    exercise_id: exerciseId,
    notes: null,
    rating: "Good",
    bpm: null,
    seconds,
    created_timestamp: daysAgo(daysAgoOffset),
    updated_timestamp: daysAgo(daysAgoOffset),
  };
}

function exercise(id: number, name: string, parentId: number | null, sessions: unknown[], children: unknown[] = []) {
  return {
    id,
    name,
    order: id,
    resources: null,
    session_type: "exercise",
    parent_exercise_id: parentId,
    created_timestamp: daysAgo(60),
    updated_timestamp: daysAgo(60),
    child_exercises: children,
    meta: { user_exercise: null, sessions },
  };
}

// Parent: 10m of its own + children 20m and 5m -> 35m total.
const parent = exercise(
  1,
  "Course With Time",
  null,
  [exSession(1, 1, 600, 3)],
  [
    exercise(2, "Lesson A", 1, [exSession(2, 2, 900, 2), exSession(3, 2, 300, 1)], []),
    exercise(3, "Lesson B", 1, [exSession(4, 3, 300, 1)], []),
  ]
);

// Childless items don't get a total-time tag.
const solo = exercise(4, "Solo Exercise", null, [exSession(5, 4, 600, 1)]);

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [parent, solo],
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
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
});

test("a parent shows total practice time summed from itself and its children", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Course With Time" }).first();
  await expect(card.locator(".tag-total-time")).toHaveText("⏱ 35m");
});

test("child cards show no total-time tag", async ({ page }) => {
  await page.locator(".item-card", { hasText: "Course With Time" }).first().locator(".btn-collapse").click();
  const child = page.locator(".item-card.child-card", { hasText: "Lesson A" });
  await expect(child).toBeVisible();
  await expect(child.locator(".tag-total-time")).toHaveCount(0);
});

test("an item without children shows no total-time tag", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Solo Exercise" });
  await expect(card.locator(".tag-total-time")).toHaveCount(0);
});
