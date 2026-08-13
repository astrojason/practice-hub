import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GP_FIXTURE = readFileSync(join(__dirname, "fixtures", "gp-score-fixture.gp"));

// A minimal but genuinely decodable WAV file (PCM, mono, 8kHz, 16-bit, 0.5s
// of silence) — real audio bytes so useAudioEngine's decodeAudioData
// actually succeeds and audioState.status reaches "ready", which is what
// gates the Space-bar shortcut and the play controls.
function buildSilentWav(): Buffer {
  const sampleRate = 8000;
  const numSamples = 4000;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};
const mockDashboard = {
  scale: null, key_signature: null, overdue: [],
  to_review: { songs: [] }, to_learn: { songs: [] }, project: { songs: [] },
  exercises: [], study_materials: [], chord: null, progression: null, interval: null,
};
const mockCatalogSongs = { songs: [], total: 0, page: 1, limit: 100 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const storeRid = 1;
    const scanEntry = JSON.stringify([{
      path: "/Songs/TestArtist-Test Song-01-01-2024.gp",
      filename: "TestArtist-Test Song-01-01-2024.gp",
      modified_ms: 1704067200000, size_bytes: 12345,
    }]);
    window.__TAURI_INTERNALS__ = {
      invoke: function (cmd) {
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        if (cmd === "plugin:store|get") return Promise.resolve([null, false]);
        if (cmd === "plugin:store|set") return Promise.resolve(null);
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:store|has") return Promise.resolve(false);
        if (cmd === "plugin:store|get_store") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd === "scan_gp_directory") return Promise.resolve(scanEntry);
        if (cmd === "analyze_gp_file") return Promise.resolve(null);
        if (cmd === "plugin:dialog|open") return Promise.resolve("/Songs/backing.wav");
        return Promise.resolve(null);
      },
      transformCallback: function (_fn, _once) { return Math.random(); },
    };
  });
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
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

  const wavBytes = buildSilentWav();
  await page.route("**/127.0.0.1:17865/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    if (path.endsWith(".wav")) {
      route.fulfill({ status: 200, contentType: "audio/wav", body: wavBytes });
    } else {
      route.fulfill({ status: 200, contentType: "application/octet-stream", body: GP_FIXTURE });
    }
  });

  await page.goto("/");
});

async function openViewerWithAudio(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator('button[title="Guitar Pro library scanner"]').click();
  await page.fill("#gp-root-path", "/Songs");
  await page.locator(".scan-button").click();
  await expect(page.locator(".gp-status-message", { hasText: "Done" })).toBeVisible({ timeout: 10000 });
  await page.locator('button[title="View tab"]').first().click();
  await expect(page.locator(".gp-viewer")).toBeVisible();
  await page.locator(".gp-audio-load").click();
  await expect(page.locator(".gp-at-play")).toBeVisible({ timeout: 10000 });
}

test("pressing Space toggles playback once audio is loaded", async ({ page }) => {
  await openViewerWithAudio(page);

  const playButton = page.locator(".gp-at-play");
  await expect(playButton).toHaveText("▶");

  await page.keyboard.press("Space");
  await expect(playButton).toHaveText("⏸");

  await page.keyboard.press("Space");
  await expect(playButton).toHaveText("▶");
});

test("Space still toggles playback when focus is lingering on the Load Audio button (the actual reported bug)", async ({ page }) => {
  await openViewerWithAudio(page);
  // openViewerWithAudio clicks ".gp-audio-load" to trigger the file picker;
  // focus naturally remains on that button afterward, exactly like a real
  // user's browser would leave it. Space must still toggle playback, not
  // reactivate the Load Audio button (which would reopen the file dialog).
  const playButton = page.locator(".gp-at-play");
  await expect(playButton).toHaveText("▶");

  await page.keyboard.press("Space");
  await expect(playButton).toHaveText("⏸");
});
