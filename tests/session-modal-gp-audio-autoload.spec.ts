import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GP_FIXTURE = readFileSync(join(__dirname, "fixtures", "gp-score-fixture.gp"));

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// SessionModal already has a `findAudioPath(resources)` helper that resolves
// an already-associated audio resource and passes it as GpViewer's
// initialAudioPath — but only for the `local_file` and `guitar_pro` resource
// branches. The `local_folder` branch (a folder holding both the tab and its
// recording together, the most common real layout) called onGpView with no
// audio path at all, forcing a manual "Load audio" click even when the
// recording sits right next to the tab. This fixes that: a GP file opened
// from within an expanded local folder should prefer an audio file from that
// same folder listing, falling back to any top-level audio resource.

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

function dashboardWithProjectSong(resources: { name: string; url: string; type: string }[]) {
  return {
    scale: null, key_signature: null, overdue: [],
    to_review: { songs: [] }, to_learn: { songs: [] },
    project: {
      songs: [
        {
          id: 1, name: "Project Song", artist_id: 1, artist_name: "Some Artist",
          tuning_id: 1, tuning_name: "Standard", bpm: 120, active: true,
          resources, tags: [], seconds: null, session_type: "song",
          created_timestamp: 0, updated_timestamp: 0, meta: { sessions: [], song_lists: [] },
        },
      ],
    },
    exercises: [], study_materials: [], chord: null, progression: null, interval: null,
  };
}

async function setUpCommon(page: import("@playwright/test").Page, folderFiles: { path: string; filename: string }[]) {
  await page.addInitScript((folderFiles) => {
    window.__TAURI_INTERNALS__ = {
      invoke: function (cmd) {
        if (cmd === "list_local_folder") return Promise.resolve(JSON.stringify(folderFiles));
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        if (cmd === "plugin:store|get") return Promise.resolve([null, false]);
        if (cmd === "plugin:store|set") return Promise.resolve(null);
        if (cmd === "plugin:store|save") return Promise.resolve(null);
        if (cmd === "plugin:store|has") return Promise.resolve(false);
        if (cmd === "plugin:store|get_store") return Promise.resolve(null);
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        return Promise.resolve(null);
      },
      transformCallback: function (_fn, _once) {
        return Math.random();
      },
    };
  }, folderFiles);

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
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/octet-stream", body: GP_FIXTURE })
  );
}

async function openProjectSongModal(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Project" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Project Song" }).first();
  await expect(card).toBeVisible();
  await card.locator('button[title="Start timer"]').click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("opening a GP file from within an expanded local folder auto-loads an audio sibling from that same folder", async ({ page }) => {
  await setUpCommon(page, [
    { path: "/local/folder/song.gp", filename: "song.gp" },
    { path: "/local/folder/backing.mp3", filename: "backing.mp3" },
  ]);
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(dashboardWithProjectSong([
        { name: "Session Files", url: "/local/folder", type: "local_folder" },
      ])),
    })
  );

  await page.goto("/");
  await openProjectSongModal(page);
  await page.locator(".modal-resource-link", { hasText: "Session Files" }).click();
  await page.locator(".modal-resource-folder-file", { hasText: "song.gp" }).click();

  await expect(page.locator(".gp-viewer")).toBeVisible();
  await expect(page.locator(".gp-audio-load")).toContainText("backing.mp3");
});

test("falls back to a top-level audio resource when the folder has no audio file of its own", async ({ page }) => {
  await setUpCommon(page, [
    { path: "/local/folder/song.gp", filename: "song.gp" },
  ]);
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(dashboardWithProjectSong([
        { name: "Session Files", url: "/local/folder", type: "local_folder" },
        { name: "Backing Track", url: "/other/backing.wav", type: "local_file" },
      ])),
    })
  );

  await page.goto("/");
  await openProjectSongModal(page);
  await page.locator(".modal-resource-link", { hasText: "Session Files" }).click();
  await page.locator(".modal-resource-folder-file", { hasText: "song.gp" }).click();

  await expect(page.locator(".gp-viewer")).toBeVisible();
  await expect(page.locator(".gp-audio-load")).toContainText("backing.wav");
});
