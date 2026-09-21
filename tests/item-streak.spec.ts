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
    exercise_id: 0,
    notes: null,
    rating: "Good",
    bpm: null,
    seconds: 60,
    created_timestamp: daysAgo(daysAgoOffset),
    updated_timestamp: daysAgo(daysAgoOffset),
  };
}

function smSession(id: number, daysAgoOffset: number) {
  return {
    id,
    study_material_id: 0,
    notes: null,
    rating: "Good",
    bpm: null,
    seconds: 300,
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

// Same shape, but the streaking child isn't one the user has added to their
// active list (meta.user_exercise is null). All child items count toward the
// parent's streak, not just the ones in the user's exercises/study materials.
const parentWithUnlistedStreakingChild = {
  id: 7,
  name: "Course With Unlisted Streaking Child",
  order: 7,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(60),
  updated_timestamp: daysAgo(60),
  child_exercises: [
    {
      id: 8,
      name: "Lesson 1 (not added)",
      order: 1,
      resources: null,
      session_type: "exercise",
      parent_exercise_id: 7,
      created_timestamp: daysAgo(60),
      updated_timestamp: daysAgo(60),
      child_exercises: [],
      meta: {
        user_exercise: null,
        sessions: [session(14, 0), session(15, 1), session(16, 2)],
      },
    },
  ],
  meta: { user_exercise: null, sessions: [] },
};

// Practiced today, 2 days ago, 3 days ago, and 4 days ago, but missed
// yesterday — a single missed day shouldn't break the streak ("don't miss
// twice"), so it should still count all 4 practiced days.
const singleMissedDayExercise = {
  id: 9,
  name: "One Skipped Day",
  order: 9,
  resources: null,
  session_type: "exercise",
  parent_exercise_id: null,
  created_timestamp: daysAgo(30),
  updated_timestamp: daysAgo(30),
  child_exercises: [],
  meta: {
    user_exercise: null,
    sessions: [session(17, 0), session(18, 2), session(19, 3), session(20, 4)],
  },
};

// A 9-day course where a different child is the user's active one each day —
// yesterday's child gets removed from the user's list the moment today's is
// added. The dashboard's own study_materials list only ever includes the
// currently-active child (this is what the real /user/dashboard endpoint
// does — it drops de-listed children entirely, not just their membership
// flag), so the parent's streak has to come from the full course detail
// fetched separately, not from the dashboard payload alone.
const swappedChildrenAllDays = Array.from({ length: 9 }, (_, i) => {
  const dayNumber = 9 - i;
  const daysAgoOffset = i;
  return {
    id: 335 + i,
    name: `Day ${dayNumber}`,
    url: null,
    instrument: null,
    parent_study_material_id: 334,
    session_type: "study_material",
    created_timestamp: daysAgo(60),
    updated_timestamp: daysAgo(60),
    child_study_materials: [],
    meta: {
      user_study_material: i === 0 ? { user_id: 1, study_material_id: 335 } : null,
      sessions: [smSession(101 + i, daysAgoOffset)],
    },
  };
});

const swappedChildrenParent = {
  id: 334,
  name: "30-Day Downpicking Course - Bernth",
  url: null,
  instrument: null,
  parent_study_material_id: null,
  session_type: "study_material",
  created_timestamp: daysAgo(60),
  updated_timestamp: daysAgo(60),
  // The dashboard only carries today's active child (Day 9) — the other 8
  // days' children were each removed from the user's list once swapped out.
  child_study_materials: [swappedChildrenAllDays[0]],
  meta: { user_study_material: null, sessions: [] },
};

// Full course detail as returned by GET /study-material/334 — every child the
// course has ever had, each carrying its own session, regardless of whether
// it's still in the user's active list today.
const swappedChildrenFullDetail = {
  ...swappedChildrenParent,
  child_study_materials: swappedChildrenAllDays,
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
    parentWithUnlistedStreakingChild,
    singleMissedDayExercise,
  ],
  study_materials: [swappedChildrenParent],
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
  await page.route("**/study-material/334", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(swappedChildrenFullDetail) })
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

test("a parent inherits a streak from a child that isn't in the user's active list", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "Course With Unlisted Streaking Child" }).first();
  await expect(card.locator(".tag-streak")).toHaveText("🔥 3");
});

test("a single missed day doesn't break the streak (don't miss twice)", async ({ page }) => {
  const card = page.locator(".item-card", { hasText: "One Skipped Day" });
  await expect(card.locator(".tag-streak")).toHaveText("🔥 4");
});

test("a parent's streak reflects the full course history even when a different child is active each day", async ({ page }) => {
  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "30-Day Downpicking Course - Bernth" }).first();
  await expect(card.locator(".tag-streak")).toContainText("🔥 9");
});
