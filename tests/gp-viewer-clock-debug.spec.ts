import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GP_FIXTURE = readFileSync(join(__dirname, "fixtures", "gp-score-fixture.gp"));

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// This exercises the on-screen playback-clock diagnostics added to GpViewer's
// existing debug panel. Cursor/audio-sync bugs reported from the packaged
// Tauri app haven't reproduced in this dev-server/Chromium test environment
// (this codebase has repeated precedent for behavior that only shows up
// under WKWebView's production tauri:// runtime), so the debug panel exists
// to surface the clock's raw inputs (ctx.currentTime, the worklet's last
// reported position, and the resolved cursor position) directly in the
// packaged app, without needing devtools access.

function buildSilentWav(): Buffer {
  const sampleRate = 8000;
  // 4s — long enough that the 500ms diagnostic-log interval has comfortable
  // margin to fire before playback naturally ends (a short fixture races
  // the interval against playback-end, an artifact of the test, not of the
  // logging behavior itself).
  const numSamples = 32000;
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

test("the debug panel logs playback-clock diagnostics while audio is playing", async ({ page }) => {
  await openViewerWithAudio(page);

  await page.locator(".gp-at-play").click();
  // Diagnostics log on a 500ms interval — wait for at least one tick.
  await page.waitForTimeout(700);

  await page.locator(".gp-debug-toggle").click();
  const lines = page.locator(".gp-debug-line");
  await expect(lines.filter({ hasText: "[CLOCK]" }).first()).toBeVisible();

  const clockLine = await lines.filter({ hasText: "[CLOCK]" }).first().textContent();
  expect(clockLine).toMatch(/ctx=\d+\.\d+/);
  expect(clockLine).toMatch(/report=(none|\d+\.\d+)/);
  expect(clockLine).toMatch(/reportCtx=\d+\.\d+/);
  expect(clockLine).toMatch(/resolved=\d+\.\d+/);
});

test("no clock diagnostics are logged while paused/idle", async ({ page }) => {
  await openViewerWithAudio(page);
  await page.waitForTimeout(700);

  await page.locator(".gp-debug-toggle").click();
  const lines = page.locator(".gp-debug-line");
  await expect(lines.filter({ hasText: "[CLOCK]" })).toHaveCount(0);
});
