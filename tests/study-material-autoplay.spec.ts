import { test, expect } from "./base";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [{
    id: 1, name: "Test Exercise", order: 1, session_type: "exercise", parent_exercise_id: null,
    created_timestamp: 0, updated_timestamp: 0, child_exercises: [],
    resources: [{ name: "Practice Video", url: "/path/to/practice.mp4", type: "local_file" }],
    meta: { user_exercise: null, sessions: [] },
  }],
  study_materials: [], chord: null, progression: null, interval: null,
};

test.use({ viewport: { width: 1100, height: 700 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  const videoBuf = fs.readFileSync(path.join(__dirname, "fixtures", "test-video.mp4"));
  await page.route("**/127.0.0.1:17865/**", (route) => {
    const range = route.request().headers()["range"];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : videoBuf.length - 1;
      return route.fulfill({
        status: 206,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${videoBuf.length}` },
        body: videoBuf.subarray(start, end + 1),
      });
    }
    return route.fulfill({ status: 200, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" }, body: videoBuf });
  });
  await page.goto("/");
});

async function addRegion(page: import("@playwright/test").Page, name: string, start: string, end: string) {
  await page.fill("#loopStart", start);
  await page.fill("#loopEnd", end);
  await page.fill("#regionNameInput", name);
  await page.locator("#addRegionBtn").click();
  await expect(page.locator(".mp-region-item", { hasText: name })).toBeVisible();
}

async function openVideo(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:12", { timeout: 10000 });
}


const materialDashboard = {
  ...mockDashboard,
  exercises: [],
  study_materials: [{
    id: 801, name: "Lesson Video", url: "/path/to/practice.mp4", type: "local_file", instrument: null,
    parent_study_material_id: null, bpm: null, session_type: "study_material",
    created_timestamp: 0, updated_timestamp: 0, child_study_materials: [],
    meta: { user_study_material: null, sessions: [] },
  }],
};

async function openMaterialVideo(page: import("@playwright/test").Page) {
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(materialDashboard) }));
  await page.route("**/study-material/801", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(materialDashboard.study_materials[0]) })
      : route.fallback());
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Study Materials" }).locator(".item-group-header").click();
  await page.locator(".item-card", { hasText: "Lesson Video" }).locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local").first().click();
  await expect(page.locator("video")).toBeVisible();
}

test("a study material's edit form from the player has the Auto-start setting, applied on next open", async ({ page }) => {
  await openMaterialVideo(page);
  await page.locator('[data-testid="player-edit-resource"]').click();
  await expect(page.locator('label[for="sm-ef-autoplay"]')).toHaveText("Auto-start");
  await page.locator(".edit-resource-autoplay").selectOption("none");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".edit-form")).toHaveCount(0);
  // Remembered for this file...
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ph:resourceAutoplay") ?? "{}"));
  expect(stored["/path/to/practice.mp4"]).toBe("none");
  // ...and reopening the edit form shows it.
  await page.locator('[data-testid="player-edit-resource"]').click();
  await expect(page.locator(".edit-resource-autoplay")).toHaveValue("none");
});

test("a study material that isn't a local file has no Auto-start setting", async ({ page }) => {
  await openMaterialVideo(page);
  await page.locator('[data-testid="player-edit-resource"]').click();
  await page.locator("#sm-ef-type").selectOption("url");
  await expect(page.locator("#sm-ef-autoplay")).toHaveCount(0);
});
