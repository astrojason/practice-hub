import { test, expect } from "./base";

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};
const mockDashboard = {
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] }, exercises: [], study_materials: [], chord: null, progression: null, interval: null,
};
const catalogExercise = { id: 55, name: "Metronome Drill", order: 1, resources: null, parent_exercise_id: null, child_exercises: [] };
const catalogMaterial = { id: 66, name: "Modes Course", order: 1, url: null, type: null, bpm: null, resources: null, parent_study_material_id: null, child_study_materials: [] };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ph:refreshToken", "fake-refresh-token"));
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "t", refresh_token: "r" }) }));
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.route("**/song?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ songs: [], total: 0, page: 1, limit: 25 }) }));
  await page.route("**/study-material?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ study_material: [catalogMaterial], total: 1, page: 1, limit: 25 }) }));
  await page.route("**/exercise?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ exercises: [catalogExercise], total: 1, page: 1, limit: 25 }) }));
  await page.route("**/user-exercise-session**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user_exercise_sessions: [], total: 0, page: 1, limit: 50 }) }));
  await page.route("**/user-study-material-session**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user_study_material_sessions: [], total: 0, page: 1, limit: 50 }) }));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
});

test("adding an exercise expands Additional and starts a session with it", async ({ page }) => {
  await page.locator(".session-header-actions button", { hasText: "Quick add" }).click();
  await page.locator(".quick-add-search").fill("Metronome");
  await page.locator(".qa-row", { hasText: "Metronome Drill" }).locator(".qa-row-add").click();

  // The picker is gone, the group is open, the timer runs and the session window is up.
  await expect(page.locator(".quick-add-search")).toHaveCount(0);
  await expect(page.locator(".modal-card .modal-title")).toContainText("Metronome Drill");
  await page.locator(".modal-close").click();
  await expect(page.locator(".item-card.active", { hasText: "Metronome Drill" })).toBeVisible();
});

test("adding a study material does the same", async ({ page }) => {
  await page.locator(".session-header-actions button", { hasText: "Quick add" }).click();
  await page.locator(".quick-add-search").fill("Modes");
  await page.locator(".qa-row", { hasText: "Modes Course" }).locator(".qa-row-add").click();
  await expect(page.locator(".modal-card .modal-title")).toContainText("Modes Course");
  await page.locator(".modal-close").click();
  await expect(page.locator(".item-card.active", { hasText: "Modes Course" })).toBeVisible();
});
