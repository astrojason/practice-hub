import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "gp-score-fixture.gp");
const ARTICULATIONS_FIXTURE_PATH = join(__dirname, "fixtures", "gp-articulations-fixture.gp");

// ─── Mock fixtures ────────────────────────────────────────────────────────────

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
  scale: null, key_signature: null, overdue: [],
  to_review: { songs: [] }, to_learn: { songs: [] }, project: { songs: [] },
  exercises: [], study_materials: [], chord: null, progression: null, interval: null,
};

const mockCatalogSongs = { songs: [], total: 0, page: 1, limit: 100 };

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// Phase 3 of the custom tab renderer: TabCanvas.tsx is wired into GpViewer.tsx
// behind a "New renderer (preview)" toggle (additive — alphaTab's own
// rendering/cursor is untouched). Unlike tests/gp-viewer.spec.ts, this file
// serves the *real* fixture bytes from the file-server route so the new
// parser/layout/render pipeline gets exercised end to end.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const storeRid = 1;
    const scanEntry = JSON.stringify([{
      path: "/Songs/TestArtist-Test Song-01-01-2024.gp",
      filename: "TestArtist-Test Song-01-01-2024.gp",
      modified_ms: 1704067200000,
      size_bytes: 12345,
    }]);
    const analysisResult = JSON.stringify({
      difficulty_score: 45.5,
      vector: { speed: 50, fret_complexity: 40, pick_complexity: 45, rhythm_complexity: 35, technique_density: 50, stamina: 40, overall: 45.5 },
      title: "Test Song", artist: "TestArtist", tempo_bpm: 120.0, tracks: [],
    });

    window.__TAURI_INTERNALS__ = {
      invoke: function(cmd) {
        if (cmd === "plugin:store|load") return Promise.resolve(storeRid);
        if (cmd === "plugin:store|get") return Promise.resolve([null, false]);
        if (cmd === "plugin:store|set") return Promise.resolve(null);
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:store|has") return Promise.resolve(false);
        if (cmd === "plugin:store|get_store") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd === "scan_gp_directory") return Promise.resolve(scanEntry);
        if (cmd === "analyze_gp_file") return Promise.resolve(analysisResult);
        return Promise.resolve(null);
      },
      transformCallback: function(_fn, _once) {
        return Math.random();
      },
    };
  });

  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
  });

  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }),
    })
  );
  await page.route("**/user/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) })
  );
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) })
  );
  await page.route("**/127.0.0.1:8080/api/v2/song**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockCatalogSongs) })
  );

  const fixtureBytes = readFileSync(FIXTURE_PATH);
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/octet-stream", body: fixtureBytes })
  );

  await page.goto("/");
});

async function openViewer(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator('button[title="Guitar Pro library scanner"]').click();
  await expect(page.locator("h2", { hasText: "Guitar Pro Library" })).toBeVisible();
  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="View tab"]').first().click();
  await expect(page.locator(".gp-viewer")).toBeVisible();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("the new-renderer toggle shows a populated tab canvas for a real GP file", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  await openViewer(page);
  await page.locator(".gp-new-renderer-toggle").click();

  const canvas = page.locator('[data-testid="tab-canvas"]');
  await expect(canvas).toBeVisible();

  // The fixture has 2 bars of 4 quarter notes each at pixelsPerMs=0.12; width
  // should comfortably exceed the left margin + a couple bars' worth of content.
  const width = await canvas.evaluate((el: HTMLCanvasElement) => el.width);
  const height = await canvas.evaluate((el: HTMLCanvasElement) => el.height);
  expect(width).toBeGreaterThan(200);
  expect(height).toBeGreaterThan(100);

  // The app has a pre-existing, unrelated console warning (GpLibraryView list
  // keys) independent of this change; only assert the new renderer itself
  // didn't throw or warn.
  const newRendererErrors = consoleErrors.filter((e) => /TabCanvas|tabLayout|tabGeometry|gpScore/i.test(e));
  expect(newRendererErrors).toEqual([]);
});

test("the cursor mounts and sits at the deterministic x position for the current playback time", async ({ page }) => {
  await openViewer(page);
  await page.locator(".gp-new-renderer-toggle").click();

  const cursor = page.locator('[data-testid="tab-cursor"]');
  await expect(cursor).toBeAttached();

  // No audio is loaded in this test, so getCurrentTimeMs() reads the audio
  // engine's paused-at-zero state — the cursor should settle at x=0 (plus
  // the canvas's left margin for clef/key signature), computed by the same
  // timeToX the notes themselves are laid out with.
  await expect
    .poll(async () => Number((await cursor.getAttribute("data-cursor-x")) ?? "-1"))
    .toBeGreaterThanOrEqual(0);

  const cursorX = Number(await cursor.getAttribute("data-cursor-x"));
  const expectedX = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const tabLayout = await import("/src/lib/tabLayout.ts");
    const geo = await import("/src/components/tab/tabGeometry.ts");
    const score = await gpScore.loadScoreFromFile("/Songs/whatever.gp");
    const timing = gpScore.buildBeatTiming(score);
    const layout = tabLayout.buildTrackLayout(score, 0, timing);
    return tabLayout.timeToX(layout, 0) + geo.LEFT_MARGIN_PX;
  });
  expect(cursorX).toBeCloseTo(expectedX, 3);
});

test("the new-renderer toggle switches back to the alphaTab view", async ({ page }) => {
  await openViewer(page);
  await page.locator(".gp-new-renderer-toggle").click();
  await expect(page.locator('[data-testid="tab-canvas"]')).toBeVisible();

  await page.locator(".gp-new-renderer-toggle").click();
  await expect(page.locator('[data-testid="tab-canvas"]')).not.toBeVisible();
  await expect(page.locator(".gp-alphatab-container")).toBeVisible();
});

test("the tab canvas actually draws non-background pixels (something was rendered)", async ({ page }) => {
  await openViewer(page);
  await page.locator(".gp-new-renderer-toggle").click();
  const canvas = page.locator('[data-testid="tab-canvas"]');
  await expect(canvas).toBeVisible();

  const hasInk = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d")!;
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    // Background is #1a1a24 (26, 26, 36); look for pixels clearly different
    // from it — i.e. something was actually drawn, not just the fill.
    for (let i = 0; i < data.length; i += 4) {
      const dr = Math.abs(data[i] - 26);
      const dg = Math.abs(data[i + 1] - 26);
      const db = Math.abs(data[i + 2] - 36);
      if (data[i + 3] > 0 && (dr > 20 || dg > 20 || db > 20)) return true;
    }
    return false;
  });
  expect(hasInk).toBe(true);
});

// ─── Phase 5: articulation glyphs (bend, hammer/pull, vibrato, dead, palm mute) ─

test("a fixture with bends, hammer-ons, vibrato, dead notes, and palm mute renders without throwing", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const fixtureBytes = readFileSync(ARTICULATIONS_FIXTURE_PATH);
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/octet-stream", body: fixtureBytes })
  );

  await openViewer(page);
  await page.locator(".gp-new-renderer-toggle").click();

  const canvas = page.locator('[data-testid="tab-canvas"]');
  await expect(canvas).toBeVisible();

  const hasInk = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d")!;
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    for (let i = 0; i < data.length; i += 4) {
      const dr = Math.abs(data[i] - 26);
      const dg = Math.abs(data[i + 1] - 26);
      const db = Math.abs(data[i + 2] - 36);
      if (data[i + 3] > 0 && (dr > 20 || dg > 20 || db > 20)) return true;
    }
    return false;
  });
  expect(hasInk).toBe(true);

  const newRendererErrors = consoleErrors.filter((e) => /TabCanvas|tabLayout|tabGeometry|gpScore|TabCursor/i.test(e));
  expect(newRendererErrors).toEqual([]);
});
