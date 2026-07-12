import { test, expect } from "@playwright/test";

// ─── Mock fixtures ────────────────────────────────────────────────────────────
//
// A separate script (cleanup_duplicates.py) copies the newest dated GP file
// to an undated "current" alias in the same folder, then trashes older dated
// duplicates once a newer version arrives. That means a resource path pinned
// to a specific dated filename (e.g. "...-04-20-2026.gp") will eventually
// 404 once cleanup trashes it in favor of a newer version — the undated
// alias (e.g. "...gp", no date suffix) is the only stable long-term path.
// These tests pin down that the scanner prefers the undated alias as the
// resource path (for opening / viewing / eventually pushing to Instrumenta)
// whenever it exists alongside the dated file, while still using the dated
// file's embedded date for version tracking.

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const storeRid = 1;
    // Both the dated working file and the undated "current" alias
    // cleanup_duplicates.py keeps pointed at it live in the same folder.
    const scanEntry = JSON.stringify([
      {
        path: "/Songs/TestArtist-Test Song-01-01-2024.gp",
        filename: "TestArtist-Test Song-01-01-2024.gp",
        modified_ms: 1704067200000,
        size_bytes: 12345,
      },
      {
        path: "/Songs/TestArtist-Test Song.gp",
        filename: "TestArtist-Test Song.gp",
        modified_ms: 1704067200000,
        size_bytes: 12345,
      },
    ]);
    const analysisResult = JSON.stringify({
      difficulty_score: 45.5,
      vector: { speed: 50, fret_complexity: 40, pick_complexity: 45, rhythm_complexity: 35, technique_density: 50, stamina: 40, overall: 45.5 },
      title: "Test Song", artist: "TestArtist", tempo_bpm: 120.0, tracks: [],
    });

    window.__TAURI_INTERNALS__ = {
      invoke: function(cmd: string) {
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

// ─── Tests ────────────────────────────────────────────────────────────────────

test("scan resolves to a single match using the undated alias as the resource, not the dated file", async ({ page }) => {
  await navigateToGpLibrary(page);
  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });

  // Only one match for this song (the dated file and its undated alias
  // must collapse into a single row, not appear as two separate entries).
  await expect(page.locator(".gp-filename-link")).toHaveCount(1);

  // The displayed/openable filename is the undated alias, not the dated one.
  await expect(page.locator(".gp-filename-link")).toHaveText("TestArtist-Test Song.gp");
});
