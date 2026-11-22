import { test, expect } from "./base";

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

const dashboard = (resources: unknown[]) => ({
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] }, project: { songs: [] },
  exercises: [{
    id: 1, name: "Test Exercise", order: 1, session_type: "exercise", parent_exercise_id: null,
    created_timestamp: 0, updated_timestamp: 0, child_exercises: [], resources,
    meta: { user_exercise: null, sessions: [] },
  }],
  study_materials: [], chord: null, progression: null, interval: null,
});

async function openLinks(page: import("@playwright/test").Page, resources: unknown[]) {
  await page.addInitScript(() => localStorage.setItem("ph:refreshToken", "fake-refresh-token"));
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "t", refresh_token: "r" }) }));
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboard(resources)) }));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await expect(page.locator(".modal-resource-links")).toBeVisible();
}

test("a Lick Library link with no name is labelled \"Lick Library\"", async ({ page }) => {
  await openLinks(page, [{ name: "", url: "https://www.licklibrary.com/lesson/123", type: "url" }]);
  await expect(page.locator(".modal-resource-link")).toHaveText("Lick Library");
});

test("a Lick Library link with only spaces for a name is labelled \"Lick Library\"", async ({ page }) => {
  await openLinks(page, [{ name: "   ", url: "https://licklibrary.com/x", type: "url" }]);
  await expect(page.locator(".modal-resource-link")).toHaveText("Lick Library");
});

test("a Lick Library link that has a name keeps it", async ({ page }) => {
  await openLinks(page, [{ name: "Blues Lead 101", url: "https://www.licklibrary.com/lesson/123", type: "url" }]);
  await expect(page.locator(".modal-resource-link")).toHaveText("Blues Lead 101");
});

test("another site's link with no name shows its site rather than an empty button", async ({ page }) => {
  await openLinks(page, [{ name: "", url: "https://example.com/some/page", type: "url" }]);
  await expect(page.locator(".modal-resource-link")).toHaveText("example.com");
});
