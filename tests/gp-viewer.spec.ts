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

const mockScanEntry = {
  path: "/Songs/TestArtist-Test Song-01-01-2024.gp",
  filename: "TestArtist-Test Song-01-01-2024.gp",
  modified_ms: 1704067200000,
  size_bytes: 12345,
};

const mockAnalysis = JSON.stringify({
  difficulty_score: 45.5,
  vector: { speed: 50, fret_complexity: 40, pick_complexity: 45, rhythm_complexity: 35, technique_density: 50, stamina: 40, overall: 45.5 },
  title: "Test Song", artist: "TestArtist", tempo_bpm: 120.0, tracks: [],
});

const mockViewData = JSON.stringify({
  title: "Test Song",
  artist: "TestArtist",
  tempo_bpm: 120.0,
  tracks: [
    {
      name: "Guitar 1",
      instrument: "Electric Guitar",
      string_count: 6,
      bar_count: 2,
      measures: [
        {
          index: 0, time_sig: "4/4", beats_per_bar: 4.0,
          beats: [
            { position: 0.0, duration: 1.0, is_rest: false, notes: [{ string: 1, fret: 5, techniques: [] }] },
            { position: 1.0, duration: 1.0, is_rest: false, notes: [{ string: 2, fret: 7, techniques: ["h"] }] },
          ],
        },
        {
          index: 1, time_sig: "4/4", beats_per_bar: 4.0,
          beats: [],
        },
      ],
    },
    {
      name: "Bass",
      instrument: "Electric Bass",
      string_count: 4,
      bar_count: 2,
      measures: [
        { index: 0, time_sig: "4/4", beats_per_bar: 4.0, beats: [] },
      ],
    },
  ],
});

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Mock Tauri IPC bridge (no TypeScript annotations — runs in browser context).
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
    const viewResult = JSON.stringify({
      title: "Test Song",
      artist: "TestArtist",
      tempo_bpm: 120.0,
      tracks: [
        {
          name: "Guitar 1", instrument: "Electric Guitar",
          string_count: 6, bar_count: 2,
          measures: [{
            index: 0, time_sig: "4/4", beats_per_bar: 4.0,
            beats: [{ position: 0.0, duration: 1.0, is_rest: false, notes: [{ string: 1, fret: 5, techniques: [] }] }],
          }],
        },
        {
          name: "Bass", instrument: "Electric Bass",
          string_count: 4, bar_count: 2,
          measures: [{ index: 0, time_sig: "4/4", beats_per_bar: 4.0, beats: [] }],
        },
      ],
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
        if (cmd === "parse_gp_file") return Promise.resolve(viewResult);
        return Promise.resolve(null);
      },
      transformCallback: function(fn, once) {
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

  await page.goto("/");
});

async function navigateToGpLibrary(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator('button[title="Guitar Pro library scanner"]').click();
  await expect(page.locator("h2", { hasText: "Guitar Pro Library" })).toBeVisible();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("View button appears on GP file rows after scan", async ({ page }) => {
  await navigateToGpLibrary(page);

  // Enter a path and scan
  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();

  // Wait for scan to complete
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });

  // A "View" button should appear on the matched file row
  await expect(page.locator('button[title="View tab"]')).toBeVisible();
});

test("View button opens GP viewer modal with song info", async ({ page }) => {
  await navigateToGpLibrary(page);

  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });

  // Click the View button
  await page.locator('button[title="View tab"]').first().click();

  // GP viewer modal should appear
  await expect(page.locator(".gp-viewer")).toBeVisible();

  // Song info should be shown
  await expect(page.locator(".gp-viewer")).toContainText("Test Song");
  await expect(page.locator(".gp-viewer")).toContainText("120");
});

test("GP viewer shows track selector for multi-track files", async ({ page }) => {
  await navigateToGpLibrary(page);

  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="View tab"]').first().click();

  // Track selector should be visible (2 tracks: Guitar 1, Bass)
  await expect(page.locator(".gp-viewer-track-select")).toBeVisible();
  await expect(page.locator(".gp-viewer-track-select option")).toHaveCount(2);
});

test("GP viewer renders tab content for selected track", async ({ page }) => {
  await navigateToGpLibrary(page);

  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="View tab"]').first().click();

  // Tab SVG content should be rendered
  await expect(page.locator(".gp-tab-system")).toBeVisible();
});

test("GP viewer closes when close button is clicked", async ({ page }) => {
  await navigateToGpLibrary(page);

  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="View tab"]').first().click();

  await expect(page.locator(".gp-viewer")).toBeVisible();

  await page.locator(".gp-viewer-close").click();
  await expect(page.locator(".gp-viewer")).not.toBeVisible();
});

test("GP viewer closes when Escape key is pressed", async ({ page }) => {
  await navigateToGpLibrary(page);

  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="View tab"]').first().click();

  await expect(page.locator(".gp-viewer")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".gp-viewer")).not.toBeVisible();
});
