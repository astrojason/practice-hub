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


test("open media fills the window between the header and footer", async ({ page }) => {
  await openVideo(page);
  const box = async (sel: string) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  const header = await box(".session-header");
  const footer = await box(".app-footer");
  const player = await box(".media-player");
  expect(Math.abs(player.top - header.bottom)).toBeLessThan(2);
  expect(Math.abs(player.bottom - footer.top)).toBeLessThan(2);
  await expect(page.locator(".session-main")).toBeHidden();
});

test("header tabs put the media behind the app while it keeps playing", async ({ page }) => {
  await openVideo(page);
  await expect(page.locator('[data-testid="header-tab-media"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-testid="header-tab-app"]').click();
  await expect(page.locator(".session-main")).toBeVisible();
  await expect(page.locator(".media-player")).toBeHidden();
  await expect(page.locator("video")).toHaveCount(1);
  await page.locator('[data-testid="header-tab-media"]').click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".session-main")).toBeHidden();
});

test("a playing video keeps playing while the media tab is behind the app", async ({ page }) => {
  await openVideo(page);
  await page.locator("video").evaluate((v: HTMLVideoElement) => { v.muted = true; v.loop = true; return v.play(); });
  await page.locator('[data-testid="header-tab-app"]').click();
  await page.waitForTimeout(300);
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
});

test("no header tabs without media; closing the player removes them", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await expect(page.locator('[data-testid="header-tab-app"]')).toHaveCount(0);
  await openVideo(page);
  await page.locator(".media-player__close").click();
  await expect(page.locator('[data-testid="header-tab-app"]')).toHaveCount(0);
  await expect(page.locator(".session-main")).toBeVisible();
});

test("both control columns stretch down to the footer, Playback and Regions taking the slack", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1300 });
  await openVideo(page);
  const r = await page.evaluate(() => {
    const footerTop = document.querySelector(".app-footer")!.getBoundingClientRect().top;
    const cols = [...document.querySelectorAll(".media-player__col")].map(c => footerTop - c.getBoundingClientRect().bottom);
    const lastSections = [...document.querySelectorAll(".media-player__col")].map(c => footerTop - c.querySelector(".mp-section:last-child")!.getBoundingClientRect().bottom);
    return { cols, lastSections, fill: document.querySelectorAll(".mp-section--fill").length };
  });
  expect(r.fill).toBe(2);
  for (const g of [...r.cols, ...r.lastSections]) expect(Math.abs(g)).toBeLessThan(3);
});

test("the open resource can be edited from the player without stopping playback", async ({ page }) => {
  let putBody: any = null;
  await page.route("**/exercise/1", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    putBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...mockDashboard.exercises[0], resources: putBody.resources }) });
  });
  await openVideo(page);
  await page.locator("video").evaluate((v: HTMLVideoElement) => { v.muted = true; v.loop = true; return v.play(); });
  await page.locator('[data-testid="player-edit-resource"]').click();
  await page.locator(".edit-resource-autoplay").selectOption("sequence");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".edit-form")).toHaveCount(0);
  expect(putBody.resources[0].autoplay).toBe("sequence");
  await expect(page.locator("video")).toHaveCount(1);
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
});

test("a failed resource save from the player shows the error", async ({ page }) => {
  await page.route("**/exercise/1", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "boom-edit" }) })
      : route.fallback());
  await openVideo(page);
  await page.locator('[data-testid="player-edit-resource"]').click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/boom-edit|500/).first()).toBeVisible();
});
