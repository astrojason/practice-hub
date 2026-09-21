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

function session(id: number, daysAgoOffset: number) {
  return {
    id,
    exercise_id: 1,
    notes: null,
    rating: "Good",
    bpm: null,
    seconds: 60,
    created_timestamp: daysAgo(daysAgoOffset),
    updated_timestamp: daysAgo(daysAgoOffset),
  };
}

// Practiced yesterday and the day before, not yet today -> a live streak of 2.
const twoDayStreakExercise = {
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
    sessions: [session(1, 1), session(2, 2)],
  },
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [twoDayStreakExercise],
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
  await page.route("**/user-exercise-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 999,
        exercise_id: 1,
        bpm: null,
        rating: "Good",
        seconds: 60,
        notes: null,
        created_timestamp: now,
        updated_timestamp: now,
        daily_practice_time: 60,
        update_log: "",
      }),
    })
  );

  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
});

test("logging a session that extends the streak updates the badge live and flashes it", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Daily Scales" });
  await expect(card.locator(".tag-streak")).toHaveText("🔥 2");

  await card.locator('button[title="Log session"]').click();
  await page.getByLabel("Duration (sec)").fill("60");
  await page.locator('button[type="submit"]', { hasText: "Log Session" }).click();

  // No reload — the badge should update immediately, and briefly flash.
  await expect(card.locator(".tag-streak")).toHaveText("🔥 3");
  await expect(card.locator(".tag-streak")).toHaveClass(/tag-streak--bump/);
  await expect(card.locator(".tag-streak")).not.toHaveClass(/tag-streak--bump/, { timeout: 3000 });
});
