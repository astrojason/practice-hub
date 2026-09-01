import { test, expect, type Page } from "@playwright/test";

const mockUser = {
  id: 1,
  firebase_uid: "test-uid",
  email: "test@example.com",
  display_name: "Test User",
  daily_minutes_goal: 30,
  timezone: "America/Los_Angeles",
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

const mockCatalog = {
  songs: [{
    id: 1, name: "Test Song", artist_id: 1, artist_name: "TestArtist",
    tuning_id: 1, tuning_name: "Standard", bpm: 120, active: true,
    resources: null, tags: [], seconds: null, session_type: "song",
    created_timestamp: 0, updated_timestamp: 0, meta: {},
  }],
  total: 1, page: 1, limit: 100,
};

const analysisResult = {
  difficulty_score: 60,
  vector: null,
  tempo_bpm: 120,
  rhythm: { difficulty_score: 42.5, vector: null, track_name: "Rhythm Guitar" },
  lead: { difficulty_score: 78.3, vector: null, track_name: "Lead Guitar" },
};

async function setupPage(
  page: Page,
  options: { rhythmManual?: boolean; writeError?: string } = {}
) {
  await page.addInitScript(({ result, writeError }) => {
    const storeData: Record<string, unknown> = {};
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    (window as unknown as { __tursoWriteCalls: typeof calls }).__tursoWriteCalls = calls;

    window.__TAURI_INTERNALS__ = {
      invoke(cmd: string, args?: Record<string, unknown>) {
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        if (cmd === "plugin:store|get") {
          const key = args?.key as string;
          const exists = Object.prototype.hasOwnProperty.call(storeData, key);
          return Promise.resolve([exists ? storeData[key] : null, exists]);
        }
        if (cmd === "plugin:store|set") {
          storeData[args?.key as string] = args?.value;
          return Promise.resolve(null);
        }
        if (cmd === "plugin:store|delete") {
          delete storeData[args?.key as string];
          return Promise.resolve(null);
        }
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:store|has") {
          return Promise.resolve(Object.prototype.hasOwnProperty.call(storeData, args?.key as string));
        }
        if (cmd === "plugin:store|get_store") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd === "scan_gp_directory") {
          return Promise.resolve(JSON.stringify([{
            path: "/Songs/TestArtist-Test Song-01-01-2024.gp",
            filename: "TestArtist-Test Song-01-01-2024.gp",
            modified_ms: 1704067200000,
            size_bytes: 12345,
          }]));
        }
        if (cmd === "analyze_gp_file") return Promise.resolve(JSON.stringify(result));
        if (cmd === "write_song_difficulty") {
          calls.push({ cmd, args });
          return writeError
            ? Promise.reject(writeError)
            : Promise.resolve(JSON.stringify({ rhythm_written: true, lead_written: true }));
        }
        return Promise.resolve(null);
      },
      transformCallback() { return Math.random(); },
    } as unknown as typeof window.__TAURI_INTERNALS__;
  }, { result: analysisResult, writeError: options.writeError });

  await page.addInitScript(() => localStorage.setItem("ph:refreshToken", "fake-refresh-token"));
  await page.route("**/securetoken.googleapis.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }),
  }));
  await page.route("**/user/me", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(mockUser),
  }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard),
  }));
  await page.route("**/127.0.0.1:8080/api/v2/song**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(mockCatalog),
  }));
  await page.route("**/127.0.0.1:8080/api/v2/song/1", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 200, body: "{}" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...mockCatalog.songs[0],
        has_lead: true,
        has_singing: false,
        rhythm_difficulty_manual: options.rhythmManual ?? false,
        lead_difficulty_manual: false,
        meta: {},
      }),
    });
  });
  await page.route("**/127.0.0.1:17865/**", (route) => route.fulfill({ status: 404, body: "not found" }));
  await page.goto("/");
}

async function scan(page: Page, withCredentials = true) {
  await page.locator('button[title="Guitar Pro library scanner"]').click();
  await expect(page.locator("h2", { hasText: "Guitar Pro Library" })).toBeVisible();
  await page.fill("#gp-root-path", "/Songs");
  if (withCredentials) {
    await page.fill("#gp-turso-db-url", "libsql://practice-test.turso.io");
    await page.fill("#gp-turso-auth-token", "secret-token");
  }
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible();
}

async function push(page: Page) {
  await page.getByRole("button", { name: /Push to Instrumenta/ }).click();
}

test("push writes both computed rhythm and lead scores directly to Turso", async ({ page }) => {
  await setupPage(page);
  await scan(page);
  await push(page);

  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __tursoWriteCalls: unknown[] }
  ).__tursoWriteCalls)).toEqual([{
    cmd: "write_song_difficulty",
    args: {
      dbUrl: "libsql://practice-test.turso.io",
      authToken: "secret-token",
      songId: 1,
      rhythm: 42.5,
      lead: 78.3,
    },
  }]);
});

test("push omits a rhythm score that was suppressed by its manual lock", async ({ page }) => {
  await setupPage(page, { rhythmManual: true });
  await scan(page);
  await push(page);

  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __tursoWriteCalls: unknown[] }
  ).__tursoWriteCalls)).toEqual([{
    cmd: "write_song_difficulty",
    args: {
      dbUrl: "libsql://practice-test.turso.io",
      authToken: "secret-token",
      songId: 1,
      lead: 78.3,
    },
  }]);
});

test("a direct Turso write failure shows the actual error in ErrorModal", async ({ page }) => {
  await setupPage(page, { writeError: "Turso connection refused" });
  await scan(page);
  await push(page);

  await expect(page.getByRole("alertdialog")).toContainText("Turso connection refused");
});

test("missing Turso credentials blocks the push before invoking the write command", async ({ page }) => {
  await setupPage(page);
  await scan(page, false);
  await push(page);

  await expect(page.getByRole("alertdialog")).toContainText(
    "Turso credentials not set — configure them in the scan settings"
  );
  expect(await page.evaluate(() => (
    window as unknown as { __tursoWriteCalls: unknown[] }
  ).__tursoWriteCalls)).toEqual([]);
});
