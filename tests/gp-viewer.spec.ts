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
  // Intercept the file server (not running in tests) to avoid unhandled errors
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

async function openViewer(page: import("@playwright/test").Page) {
  await navigateToGpLibrary(page);
  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="View tab"]').first().click();
  await expect(page.locator(".gp-viewer")).toBeVisible();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("View button appears on GP file rows after scan", async ({ page }) => {
  await navigateToGpLibrary(page);
  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('button[title="View tab"]')).toBeVisible();
});

test("GP viewer opens and shows pitch controls", async ({ page }) => {
  await openViewer(page);
  // Pitch controls are always visible regardless of file load state
  await expect(page.locator(".gp-pitch-controls")).toBeVisible();
  // Audio shift controls
  await expect(page.locator(".gp-pitch-audio-semitones")).toBeVisible();
  // Tab shift controls
  await expect(page.locator(".gp-pitch-tab-semitones")).toBeVisible();
  // Link checkbox
  await expect(page.locator(".gp-pitch-link-check")).toBeVisible();
  // Fine tune control
  await expect(page.locator(".gp-pitch-cents")).toBeVisible();
});

test("Audio semitone control increments and decrements", async ({ page }) => {
  await openViewer(page);
  const audioGroup = page.locator(".gp-pitch-audio-semitones");
  const valueEl = audioGroup.locator(".gp-pitch-value");
  await expect(valueEl).toContainText("0");

  await audioGroup.locator("button").nth(1).click(); // increment
  await expect(valueEl).toContainText("+1");

  await audioGroup.locator("button").nth(0).click(); // decrement
  await audioGroup.locator("button").nth(0).click(); // decrement again
  await expect(valueEl).toContainText("-1");
});

test("Tab semitone control increments and decrements", async ({ page }) => {
  await openViewer(page);
  const tabGroup = page.locator(".gp-pitch-tab-semitones");
  const valueEl = tabGroup.locator(".gp-pitch-value");
  await expect(valueEl).toContainText("0");

  await tabGroup.locator("button").nth(1).click(); // increment
  await expect(valueEl).toContainText("+1");
});

test("Linked mode syncs audio and tab semitones", async ({ page }) => {
  await openViewer(page);
  const linkCheck = page.locator(".gp-pitch-link-check");
  await linkCheck.check();

  const audioGroup = page.locator(".gp-pitch-audio-semitones");
  await audioGroup.locator("button").nth(1).click(); // increment audio
  // Tab should also increment
  const tabGroup = page.locator(".gp-pitch-tab-semitones");
  await expect(tabGroup.locator(".gp-pitch-value")).toContainText("+1");
});

test("Pitch settings persist to localStorage and reload on reopen", async ({ page }) => {
  await openViewer(page);
  const audioGroup = page.locator(".gp-pitch-audio-semitones");
  await audioGroup.locator("button").nth(1).click(); // set +1
  await audioGroup.locator("button").nth(1).click(); // set +2
  await expect(audioGroup.locator(".gp-pitch-value")).toContainText("+2");

  // Close and reopen
  await page.locator(".gp-viewer-close").click();
  await expect(page.locator(".gp-viewer")).not.toBeVisible();

  await page.locator('button[title="View tab"]').first().click();
  await expect(page.locator(".gp-viewer")).toBeVisible();
  const audioGroup2 = page.locator(".gp-pitch-audio-semitones");
  await expect(audioGroup2.locator(".gp-pitch-value")).toContainText("+2");
});

test("GP viewer closes when close button is clicked", async ({ page }) => {
  await openViewer(page);
  await page.locator(".gp-viewer-close").click();
  await expect(page.locator(".gp-viewer")).not.toBeVisible();
});

test("GP viewer closes when Escape key is pressed", async ({ page }) => {
  await openViewer(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".gp-viewer")).not.toBeVisible();
});

test("Audio player section is visible with load button", async ({ page }) => {
  await openViewer(page);
  await expect(page.locator(".gp-audio-player")).toBeVisible();
  await expect(page.locator(".gp-audio-load")).toBeVisible();
});

test("Cancelled file dialog keeps audio player in idle state", async ({ page }) => {
  await openViewer(page);
  // Default mock returns null for plugin:dialog|open (cancelled)
  await page.locator(".gp-audio-load").click();
  // Player should still show load button (not loading/error state)
  await expect(page.locator(".gp-audio-load")).toBeVisible();
  await expect(page.locator(".gp-audio-error")).not.toBeVisible();
});

test("Audio player shows error when file server returns 404", async ({ page }) => {
  await openViewer(page);
  // Override dialog to return a file path
  await page.evaluate(() => {
    const orig = (window as { __TAURI_INTERNALS__: { invoke: (cmd: string, ...a: unknown[]) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    (window as { __TAURI_INTERNALS__: { invoke: (cmd: string, ...a: unknown[]) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke = function(cmd, ...args) {
      if (cmd === "plugin:dialog|open") return Promise.resolve("/Songs/test.mp3");
      return orig(cmd, ...args);
    };
  });
  await page.locator(".gp-audio-load").click();
  // File server is mocked to 404, so load should fail and show error
  await expect(page.locator(".gp-audio-error")).toBeVisible({ timeout: 5000 });
});
