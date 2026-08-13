import { test, expect } from "@playwright/test";

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

const mockCatalogSongs = {
  songs: [
    { id: 1, name: "Test Song", artist_id: 1, artist_name: "TestArtist",
      tuning_id: 1, tuning_name: "Standard", bpm: 120, active: true,
      resources: null, tags: [], seconds: null, session_type: "song",
      created_timestamp: 0, updated_timestamp: 0, meta: {} },
  ],
  total: 1, page: 1, limit: 100,
};

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// These tests pin down the "seen" cache behavior in useGpScanner.ts: a file
// that's been analyzed should never be re-analyzed while unchanged, whether
// or not the user has confirmed/pushed it yet — and a previously-pushed,
// unchanged file shouldn't keep reappearing in the "ready to push" queue.
//
// The store mock below is stateful (unlike a fixture that always returns
// "not found") so that a second scan in the same test can observe what the
// first scan persisted.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const storeRid = 1;
    const storeData: Record<string, unknown> = {};
    let analyzeCallCount = 0;
    (window as unknown as { __analyzeCallCount: () => number }).__analyzeCallCount = () => analyzeCallCount;

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
      invoke: function(cmd: string, args?: Record<string, unknown>) {
        if (cmd === "plugin:store|load") return Promise.resolve(storeRid);
        if (cmd === "plugin:store|get") {
          const key = args?.key as string;
          const exists = Object.prototype.hasOwnProperty.call(storeData, key);
          return Promise.resolve([exists ? storeData[key] : null, exists]);
        }
        if (cmd === "plugin:store|set") {
          const key = args?.key as string;
          storeData[key] = args?.value;
          return Promise.resolve(null);
        }
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:store|has") return Promise.resolve(Object.prototype.hasOwnProperty.call(storeData, args?.key as string));
        if (cmd === "plugin:store|get_store") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd === "scan_gp_directory") return Promise.resolve(scanEntry);
        if (cmd === "analyze_gp_file") {
          analyzeCallCount++;
          return Promise.resolve(analysisResult);
        }
        return Promise.resolve(null);
      },
      transformCallback: function() {
        return Math.random();
      },
    } as unknown as typeof window.__TAURI_INTERNALS__;
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
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 404, body: "not found" })
  );

  await page.goto("/");
});

async function navigateToGpLibrary(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator('button[title="Guitar Pro library scanner"]').click();
  await expect(page.locator("h2", { hasText: "Guitar Pro Library" })).toBeVisible();
}

async function analyzeCallCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as unknown as { __analyzeCallCount: () => number }).__analyzeCallCount());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("a second scan does not re-analyze an unchanged file, even if it was never pushed", async ({ page }) => {
  await navigateToGpLibrary(page);
  await page.fill("#gp-root-path", "/Songs");

  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  expect(await analyzeCallCount(page)).toBe(1);

  // Rescan without ever clicking "Push to Instrumenta" — the file's mtime
  // hasn't changed, so analyze_gp_file must not be invoked again.
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  expect(await analyzeCallCount(page)).toBe(1);
});

test("a previously pushed, unchanged match stops appearing in the ready-to-push queue", async ({ page }) => {
  await navigateToGpLibrary(page);
  await page.fill("#gp-root-path", "/Songs");

  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".confirm-button")).toBeVisible();

  await page.locator(".confirm-button").click();
  await expect(page.locator(".gp-push-status", { hasText: "Done" })).toBeVisible({ timeout: 10000 });

  // Rescan the same unchanged file. It was already pushed, so it should no
  // longer show up as "ready to push" (and analysis still isn't re-run).
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  expect(await analyzeCallCount(page)).toBe(1);
  await expect(page.locator(".confirm-button")).not.toBeVisible();
  await expect(page.locator(".gp-hint", { hasText: "Nothing new to push" })).toBeVisible();
});
