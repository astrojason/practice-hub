import { test, expect, type Page } from "@playwright/test";

// ─── Mock fixtures ────────────────────────────────────────────────────────────
//
// Phase 2 (Ratings & Difficulty Engine) part 1: the analyzer sidecar now
// returns separate rhythm/lead per-track difficulty breakdowns alongside the
// existing overall score. These tests pin down that:
//   - the scanner surfaces both in the review table when the analyzer finds
//     distinct rhythm/lead tracks;
//   - a song with no separate lead part shows "no lead score" rather than a
//     bogus number;
//   - a computed rhythm/lead value is never shown for an aspect an admin has
//     already locked as the song's canonical value (Song.rhythm_difficulty_manual/
//     lead_difficulty_manual — not UserSongMeta, which has no manual flag).

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

const fileA = {
  path: "/Songs/TestArtist-Test Song-01-01-2024.gp",
  filename: "TestArtist-Test Song-01-01-2024.gp",
  modified_ms: 1704067200000,
  size_bytes: 12345,
};

function vector(overall: number) {
  return { speed: overall, fret_complexity: overall, pick_complexity: overall, rhythm_complexity: overall, technique_density: overall, stamina: overall, overall };
}

async function setupPage(
  page: Page,
  opts: { analysisResult: unknown; songOverrides?: Record<string, unknown> }
) {
  await page.addInitScript((analysisResult) => {
    const storeRid = 1;
    const storeData: Record<string, unknown> = {};

    window.__TAURI_INTERNALS__ = {
      invoke: function (cmd: string, args?: Record<string, unknown>) {
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
        if (cmd === "scan_gp_directory") {
          return Promise.resolve(JSON.stringify([
            { path: "/Songs/TestArtist-Test Song-01-01-2024.gp", filename: "TestArtist-Test Song-01-01-2024.gp", modified_ms: 1704067200000, size_bytes: 12345 },
          ]));
        }
        if (cmd === "analyze_gp_file") {
          return Promise.resolve(JSON.stringify(analysisResult));
        }
        return Promise.resolve(null);
      },
      transformCallback: function () {
        return Math.random();
      },
    } as unknown as typeof window.__TAURI_INTERNALS__;
  }, opts.analysisResult);

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

  // A specific song-detail route, registered after the generic catalog
  // wildcard above, so Playwright tries it first for GET /song/1.
  if (opts.songOverrides !== undefined) {
    await page.route("**/127.0.0.1:8080/api/v2/song/1", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1, name: "Test Song", artist_id: 1, artist_name: "TestArtist",
          tuning_id: 1, tuning_name: "Standard", bpm: 120, has_lead: true, has_singing: false,
          active: true, resources: [], tags: [], seconds: null, session_type: "song",
          created_timestamp: 0, updated_timestamp: 0,
          rhythm_difficulty: null, rhythm_difficulty_name: null,
          lead_difficulty: null, lead_difficulty_name: null,
          rhythm_difficulty_manual: false, lead_difficulty_manual: false,
          meta: {
            date_learned: null, rhythm_difficulty: null, lead_difficulty: null,
            singing_difficulty: null, singing_difficulty_name: null,
          },
          ...opts.songOverrides,
        }),
      })
    );
  }

  await page.goto("/");
}

async function navigateToGpLibrary(page: Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator('button[title="Guitar Pro library scanner"]').click();
  await expect(page.locator("h2", { hasText: "Guitar Pro Library" })).toBeVisible();
}

async function scanAndWait(page: Page) {
  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("shows separate rhythm and lead difficulty scores for a file with distinct tracks", async ({ page }) => {
  const analysisResult = {
    difficulty_score: 60,
    vector: vector(60),
    title: "Test Song", artist: "TestArtist", tempo_bpm: 120.0, tracks: [],
    rhythm: { difficulty_score: 42.5, vector: vector(42.5), track_name: "Rhythm Guitar" },
    lead: { difficulty_score: 78.3, vector: vector(78.3), track_name: "Lead Guitar" },
  };
  await setupPage(page, { analysisResult });
  await navigateToGpLibrary(page);
  await scanAndWait(page);

  const row = page.locator("tr", { hasText: "TestArtist-Test Song-01-01-2024.gp" });
  await expect(row.locator(".gp-aspect-cell").nth(0)).toContainText("42.5");
  await expect(row.locator(".gp-aspect-cell").nth(1)).toContainText("78.3");
});

test("shows no lead score when the file has no separate lead track", async ({ page }) => {
  const analysisResult = {
    difficulty_score: 42.5,
    vector: vector(42.5),
    title: "Test Song", artist: "TestArtist", tempo_bpm: 120.0, tracks: [],
    rhythm: { difficulty_score: 42.5, vector: vector(42.5), track_name: "Guitar" },
    lead: null,
  };
  await setupPage(page, { analysisResult });
  await navigateToGpLibrary(page);
  await scanAndWait(page);

  const row = page.locator("tr", { hasText: "TestArtist-Test Song-01-01-2024.gp" });
  await expect(row.locator(".gp-aspect-cell").nth(0)).toContainText("42.5");
  await expect(row.locator(".gp-aspect-cell").nth(1)).toHaveText("—");
});

test("never shows a computed rhythm score for a song an admin has already locked as canonical", async ({ page }) => {
  const analysisResult = {
    difficulty_score: 60,
    vector: vector(60),
    title: "Test Song", artist: "TestArtist", tempo_bpm: 120.0, tracks: [],
    rhythm: { difficulty_score: 42.5, vector: vector(42.5), track_name: "Rhythm Guitar" },
    lead: { difficulty_score: 78.3, vector: vector(78.3), track_name: "Lead Guitar" },
  };
  await setupPage(page, { analysisResult, songOverrides: { rhythm_difficulty_manual: true, rhythm_difficulty: 55 } });
  await navigateToGpLibrary(page);
  await scanAndWait(page);

  const row = page.locator("tr", { hasText: "TestArtist-Test Song-01-01-2024.gp" });
  // Rhythm is locked as the song's canonical value — the computed 42.5 must never surface.
  await expect(row.locator(".gp-aspect-cell").nth(0)).toHaveText("—");
  // Lead has no manual flag set — its computed score still shows.
  await expect(row.locator(".gp-aspect-cell").nth(1)).toContainText("78.3");
});

test("expanding a matched row shows separate Rhythm and Lead vector breakdowns", async ({ page }) => {
  const analysisResult = {
    difficulty_score: 60,
    vector: vector(60),
    title: "Test Song", artist: "TestArtist", tempo_bpm: 120.0, tracks: [],
    rhythm: { difficulty_score: 42.5, vector: vector(42.5), track_name: "Rhythm Guitar" },
    lead: { difficulty_score: 78.3, vector: vector(78.3), track_name: "Lead Guitar" },
  };
  await setupPage(page, { analysisResult });
  await navigateToGpLibrary(page);
  await scanAndWait(page);

  const row = page.locator("tr", { hasText: "TestArtist-Test Song-01-01-2024.gp" });
  await row.locator(".gp-expand-btn").click();

  await expect(page.locator(".gp-vector-breakdown-label", { hasText: "Rhythm" })).toBeVisible();
  await expect(page.locator(".gp-vector-breakdown-label", { hasText: "Lead" })).toBeVisible();
});
