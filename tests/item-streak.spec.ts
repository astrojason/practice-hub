import { test, expect } from "@playwright/test";

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

function session(id: number, daysAgoOffset: number) {
  return {
    id,
    exercise_id: 0,
    notes: null,
    rating: "Good",
    bpm: null,
    seconds: 60,
    created_timestamp: daysAgo(daysAgoOffset),
    updated_timestamp: daysAgo(daysAgoOffset),
  };
}

// Practiced today, yesterday, and the day before -> current streak of 3.
const threeDayStreakExercise = {
  id: 1,
  name: "Daily Scales",
  order: 1,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(30),
  updated_timestamp: daysAgo(30),
  child_exercises: [],
  meta: {
    user_exercise: null,
    sessions: [session(1, 0), session(2, 1), session(3, 2)],
  },
};

// Practiced yesterday and the day before, but not yet today — streak is
// still alive (today isn't over) and should keep showing 2.
const streakAliveNotYetPracticedTodayExercise = {
  id: 2,
  name: "Almost Today",
  order: 2,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(30),
  updated_timestamp: daysAgo(30),
  child_exercises: [],
  meta: {
    user_exercise: null,
    sessions: [session(4, 1), session(5, 2)],
  },
};

// Practiced today only — a single day isn't shown as a "streak".
const singleDayExercise = {
  id: 3,
  name: "Just Today",
  order: 3,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(30),
  updated_timestamp: daysAgo(30),
  child_exercises: [],
  meta: {
    user_exercise: null,
    sessions: [session(6, 0)],
  },
};

// Practiced today and 3 days ago, but with a gap in between — the streak is
// broken, so only today counts (below the display threshold).
const brokenStreakExercise = {
  id: 4,
  name: "Gappy Practice",
  order: 4,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(30),
  updated_timestamp: daysAgo(30),
  child_exercises: [],
  meta: {
    user_exercise: null,
    sessions: [session(7, 0), session(8, 3), session(9, 4), session(10, 5)],
  },
};

// Parent has no sessions of its own, but its added child has a 3-day streak —
// the parent should inherit it, same as staleness does.
const parentWithStreakingChild = {
  id: 5,
  name: "Course With Streaking Child",
  order: 5,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(60),
  updated_timestamp: daysAgo(60),
  child_exercises: [
    {
      id: 6,
      name: "Lesson 1",
      order: 1,
      resources: null,
      session_type: "exercise",
      parent_exercise_id: 5,
      created_timestamp: daysAgo(60),
      updated_timestamp: daysAgo(60),
      child_exercises: [],
      meta: {
        user_exercise: { id: 1, exercise_id: 6, user_id: 1, randomize_sub_exercises: false, use_keys: false, use_scales: false },
        sessions: [session(11, 0), session(12, 1), session(13, 2)],
      },
    },
  ],
  meta: { user_exercise: null, sessions: [] },
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [
    threeDayStreakExercise,
    streakAliveNotYetPracticedTodayExercise,
    singleDayExercise,
    brokenStreakExercise,
    parentWithStreakingChild,
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
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
});

test("an item practiced 3 consecutive days shows a streak of 3", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Daily Scales" });
  await expect(card.locator(".tag-streak")).toHaveText("🔥 3");
});

test("a streak stays alive (not yet broken) before today's practice happens", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Almost Today" });
  await expect(card.locator(".tag-streak")).toHaveText("🔥 2");
});

test("a single day of practice does not show a streak badge", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Just Today" });
  await expect(card.locator(".tag-streak")).toHaveCount(0);
});

test("a broken streak only counts the unbroken run and hides the badge below threshold", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Gappy Practice" });
  await expect(card.locator(".tag-streak")).toHaveCount(0);
});

test("a parent with no sessions of its own inherits its added child's streak", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Course With Streaking Child" }).first();
  await expect(card.locator(".tag-streak")).toHaveText("🔥 3");
});
