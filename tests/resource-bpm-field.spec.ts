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
  exercises: [
    {
      id: 701,
      name: "Metronome Drill",
      order: 1,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      resources: [
        { name: "Backing Track", url: "/path/to/track.mp3", type: "local_file", bpm: 120 },
        { name: "Tab", url: "https://example.com/tab", type: "url" },
      ],
      meta: { user_exercise: null, sessions: [] },
    },
  ],
  study_materials: [
    {
      id: 801,
      name: "Lesson Video",
      url: "/path/to/lesson.mp4",
      type: "local_file",
      instrument: null,
      parent_study_material_id: null,
      bpm: 90,
      session_type: "study_material",
      created_timestamp: 0,
      updated_timestamp: 0,
      child_study_materials: [],
      meta: { user_study_material: null, sessions: [] },
    },
  ],
  chord: null,
  progression: null,
  interval: null,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) })
  );
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) })
  );
  await page.goto("/");
});

test("exercise edit shows a bpm field for a local_file resource, pre-filled, and saves it", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/exercise/701", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    capturedBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard.exercises[0]) });
  });

  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Metronome Drill" });
  await card.locator('button[title="Edit"]').click();

  const rows = page.locator(".edit-resource-row");
  const localFileRow = rows.filter({ hasText: "" }).nth(0);
  // First row is Backing Track (local_file) per mock order.
  await expect(localFileRow.locator('input[placeholder="BPM"]')).toHaveValue("120");
  // Second row (url type) has no bpm field at all.
  await expect(rows.nth(1).locator('input[placeholder="BPM"]')).toHaveCount(0);

  await localFileRow.locator('input[placeholder="BPM"]').fill("100");
  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  expect(capturedBody).not.toBeNull();
  const resources = (capturedBody as { resources: { name: string; bpm?: number | null }[] }).resources;
  const backingTrack = resources.find((r) => r.name === "Backing Track");
  expect(backingTrack?.bpm).toBe(100);
});

test("study material edit shows a bpm field for a local_file material, pre-filled, and saves it", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/study-material/801", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    capturedBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard.study_materials[0]) });
  });

  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Lesson Video" });
  await card.locator('button[title="Edit"]').click();

  const bpmInput = page.locator('input[placeholder="BPM"]');
  await expect(bpmInput).toHaveValue("90");
  await bpmInput.fill("80");
  await page.locator('button[type="submit"]', { hasText: "Save" }).click();

  expect(capturedBody).not.toBeNull();
  expect((capturedBody as { bpm?: number | null }).bpm).toBe(80);
});

test("study material edit hides the bpm field for a url-type material", async ({ page }) => {
  const dashboardWithUrlMaterial = {
    ...mockDashboard,
    study_materials: [{ ...mockDashboard.study_materials[0], type: "url", url: "https://example.com/notes" }],
  };
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardWithUrlMaterial) })
  );
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();

  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Lesson Video" });
  await card.locator('button[title="Edit"]').click();

  await expect(page.locator('input[placeholder="BPM"]')).toHaveCount(0);
});
