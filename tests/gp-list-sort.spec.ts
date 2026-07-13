import { test, expect, type Page } from "@playwright/test";

// ─── Mock fixtures ────────────────────────────────────────────────────────────
//
// Three matched files, deliberately scanned in an order that differs from
// every sort order below (title/artist/date/difficulty all disagree with the
// raw scan order), so that clicking a column header is the only thing that
// can produce the sorted arrangement asserted in each test.

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
    { id: 1, name: "Zebra Song", artist_id: 1, artist_name: "ZedArtist",
      tuning_id: 1, tuning_name: "Standard", bpm: 120, active: true,
      resources: null, tags: [], seconds: null, session_type: "song",
      created_timestamp: 0, updated_timestamp: 0, meta: {} },
    { id: 2, name: "Apple Song", artist_id: 2, artist_name: "AardvarkArtist",
      tuning_id: 1, tuning_name: "Standard", bpm: 120, active: true,
      resources: null, tags: [], seconds: null, session_type: "song",
      created_timestamp: 0, updated_timestamp: 0, meta: {} },
    { id: 3, name: "Middle Song", artist_id: 3, artist_name: "MiddleArtist",
      tuning_id: 1, tuning_name: "Standard", bpm: 120, active: true,
      resources: null, tags: [], seconds: null, session_type: "song",
      created_timestamp: 0, updated_timestamp: 0, meta: {} },
  ],
  total: 3, page: 1, limit: 100,
};

// Difficulty: Middle=50, Zebra=80, Apple=20
// Date:       Middle=03-10-2024, Zebra=01-01-2024, Apple=06-15-2024
// Raw scan order: Middle, Zebra, Apple (matches none of the sort orders below)
const fileMiddle = {
  path: "/Songs/MiddleArtist-Middle Song-03-10-2024.gp",
  filename: "MiddleArtist-Middle Song-03-10-2024.gp",
  modified_ms: 1710028800000,
  size_bytes: 10000,
};
const fileZebra = {
  path: "/Songs/ZedArtist-Zebra Song-01-01-2024.gp",
  filename: "ZedArtist-Zebra Song-01-01-2024.gp",
  modified_ms: 1704067200000,
  size_bytes: 20000,
};
const fileApple = {
  path: "/Songs/AardvarkArtist-Apple Song-06-15-2024.gp",
  filename: "AardvarkArtist-Apple Song-06-15-2024.gp",
  modified_ms: 1718409600000,
  size_bytes: 30000,
};

const scoreByPath: Record<string, number> = {
  [fileMiddle.path]: 50,
  [fileZebra.path]: 80,
  [fileApple.path]: 20,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ entries, scores }) => {
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
          if (cmd === "scan_gp_directory") return Promise.resolve(JSON.stringify(entries));
          if (cmd === "analyze_gp_file") {
            const filePath = args?.filePath as string;
            const score = (scores as Record<string, number>)[filePath] ?? 0;
            return Promise.resolve(
              JSON.stringify({
                difficulty_score: score,
                vector: { speed: score, fret_complexity: score, pick_complexity: score, rhythm_complexity: score, technique_density: score, stamina: score, overall: score },
                title: "x", artist: "y", tempo_bpm: 120.0, tracks: [],
              })
            );
          }
          return Promise.resolve(null);
        },
        transformCallback: function () {
          return Math.random();
        },
      } as unknown as typeof window.__TAURI_INTERNALS__;
    },
    { entries: [fileMiddle, fileZebra, fileApple], scores: scoreByPath }
  );

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

function columnTexts(page: Page, nth: number) {
  return page.locator(`.gp-table tbody tr td:nth-child(${nth})`).allTextContents();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("clicking the Song header sorts matches by title, toggling asc/desc", async ({ page }) => {
  await navigateToGpLibrary(page);
  await scanAndWait(page);

  // Default (unsorted) order follows the raw scan order: Middle, Zebra, Apple.
  await expect.poll(() => columnTexts(page, 3)).toEqual(["Middle Song", "Zebra Song", "Apple Song"]);

  await page.locator(".gp-table th", { hasText: "Song" }).first().click();
  await expect.poll(() => columnTexts(page, 3)).toEqual(["Apple Song", "Middle Song", "Zebra Song"]);

  await page.locator(".gp-table th", { hasText: "Song" }).first().click();
  await expect.poll(() => columnTexts(page, 3)).toEqual(["Zebra Song", "Middle Song", "Apple Song"]);
});

test("clicking the Artist header sorts matches by artist name", async ({ page }) => {
  await navigateToGpLibrary(page);
  await scanAndWait(page);

  await page.locator(".gp-table th", { hasText: "Artist" }).first().click();
  await expect.poll(() => columnTexts(page, 4)).toEqual(["AardvarkArtist", "MiddleArtist", "ZedArtist"]);

  await page.locator(".gp-table th", { hasText: "Artist" }).first().click();
  await expect.poll(() => columnTexts(page, 4)).toEqual(["ZedArtist", "MiddleArtist", "AardvarkArtist"]);
});

test("clicking the Date header sorts matches by date added", async ({ page }) => {
  await navigateToGpLibrary(page);
  await scanAndWait(page);

  await page.locator(".gp-table th", { hasText: "Date" }).first().click();
  await expect.poll(() => columnTexts(page, 5)).toEqual(["01-01-2024", "03-10-2024", "06-15-2024"]);

  await page.locator(".gp-table th", { hasText: "Date" }).first().click();
  await expect.poll(() => columnTexts(page, 5)).toEqual(["06-15-2024", "03-10-2024", "01-01-2024"]);
});

test("clicking the Difficulty header sorts matches by score", async ({ page }) => {
  await navigateToGpLibrary(page);
  await scanAndWait(page);

  await page.locator(".gp-table th", { hasText: "Difficulty" }).first().click();
  await expect.poll(() => columnTexts(page, 7)).toEqual(["20.0", "50.0", "80.0"]);

  await page.locator(".gp-table th", { hasText: "Difficulty" }).first().click();
  await expect.poll(() => columnTexts(page, 7)).toEqual(["80.0", "50.0", "20.0"]);
});
