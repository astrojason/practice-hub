import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A minimal valid, decodable WAV file (1 second of silence, 8kHz mono 16-bit)
// so the audio engine reports a real, nonzero duration — marker/loop logic is
// gated on `dur > 0`.
function makeSilentWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
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
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [{
    id: 1, name: "Test Exercise", order: 1, session_type: "exercise", parent_exercise_id: null,
    created_timestamp: 0, updated_timestamp: 0, child_exercises: [],
    resources: [
      { name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file" },
      { name: "Practice Video", url: "/path/to/practice.mp4", type: "local_file" },
    ],
    meta: { user_exercise: null, sessions: [] },
  }],
  study_materials: [], chord: null, progression: null, interval: null,
};

// Clicking a seek button doesn't wait for React to commit the resulting
// currentTime before the next click fires — firing several in a tight loop
// can race ahead of state updates and under-count. Wait for the displayed
// time to actually change after each click so cumulative seeks are reliable.
async function clickAndSettle(button: import("@playwright/test").Locator, timeLabel: import("@playwright/test").Locator, times: number) {
  for (let i = 0; i < times; i++) {
    const before = await timeLabel.textContent();
    await button.click();
    await expect(timeLabel).not.toHaveText(before ?? "");
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.route("**/127.0.0.1:17865/**", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: makeSilentWav(3) }));
  await page.goto("/");
});

test("adding, renaming, navigating, and deleting waveform markers works without crashing", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  // Wait for the audio to decode so duration > 0 (marker/loop actions are gated on it).
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  await expect(page.locator("#waveMarkerLabel")).toContainText("0 markers");

  await page.locator("#waveAddMarkerBtn").click();
  await expect(page.locator("#waveMarkerLabel")).toContainText("1 marker");
  await expect(page.locator("#waveMarkerLabel")).toContainText("1/1 selected");

  // Seek forward so the second marker lands at a genuinely different time —
  // adding at (near-)identical time moves the existing marker instead of adding one.
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator("#waveAddMarkerBtn").click();
  await expect(page.locator("#waveMarkerLabel")).toContainText("2 markers");

  await page.fill("#waveMarkerName", "Chorus");
  await expect(page.locator("#waveMarkerName")).toHaveValue("Chorus");

  await page.locator("#wavePrevMarkerBtn").click();
  await page.locator("#waveNextMarkerBtn").click();

  await page.locator("#waveDeleteMarkerBtn").click();
  await expect(page.locator("#waveMarkerLabel")).toContainText("1 marker");

  await page.locator("#waveClearMarkersBtn").click();
  await expect(page.locator("#waveMarkerLabel")).toContainText("0 markers");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("marker Prev/Next navigate relative to the current playhead, not a stale selection", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
  // Playback auto-starts on load — pause it so seeks below are the only thing
  // moving the playhead (otherwise real-time drift makes the math flaky).
  await page.locator('button[title="Pause"]').click();

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const skipBackward = page.locator('button[title="Skip back 5%"]');
  const label = page.locator("#waveMarkerLabel");
  const timeLabel = page.locator(".media-player__time");

  // M1 at t≈0.
  await page.locator("#waveAddMarkerBtn").click();
  await expect(label).toContainText("1 marker");

  // M2 at t≈0.90 (6 × 5% of a 3s clip).
  await clickAndSettle(skipForward, timeLabel, 6);
  await page.locator("#waveAddMarkerBtn").click();
  await expect(label).toContainText("2 markers");

  // M3 at t≈1.80 — selection is now on M3 (the last-added marker).
  await clickAndSettle(skipForward, timeLabel, 6);
  await page.locator("#waveAddMarkerBtn").click();
  await expect(label).toContainText("3/3 selected");

  // Scrub back to t≈0.30 — strictly between M1 and M2 — without touching markers.
  // Selection is still stale on M3, but the nearest marker AFTER the playhead is M2.
  await clickAndSettle(skipBackward, timeLabel, 10);
  await page.locator("#waveNextMarkerBtn").click();
  await expect(label).toContainText("2/3 selected");

  // Now scrub forward past M3 to t≈2.10, again without touching markers.
  // Selection is stale on M2, but the nearest marker BEFORE the playhead is M3.
  await clickAndSettle(skipForward, timeLabel, 8);
  await page.locator("#wavePrevMarkerBtn").click();
  await expect(label).toContainText("3/3 selected");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

// Video's currentTime is only mirrored into React state by the <video> element's
// `timeupdate` event. If a browser doesn't promptly fire `timeupdate` after a
// programmatic seek while paused (observed on WebKit, which is what Tauri's macOS
// webview uses), marker Prev/Next keeps computing from a stale playhead position
// instead of the real one. This test disables `timeupdate` delivery entirely to
// force that condition deterministically, and checks that Prev/Next still lands on
// the correct marker by reading the live position straight off the video element.
test("marker Prev/Next uses the live video position even if timeupdate never fires", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function (type: string, ...args: unknown[]) {
      if (type === "timeupdate") return;
      // eslint-disable-next-line prefer-spread
      return (orig as any).apply(this, [type, ...args]);
    };
  });
  await page.addInitScript((preset) => {
    localStorage.setItem("practicePlayerPresets", JSON.stringify({ "/path/to/practice.mp4": preset }));
  }, {
    filePath: "/path/to/practice.mp4",
    mediaType: "video",
    playbackSpeed: 1,
    loopStart: "",
    loopEnd: "",
    loopIncreaseBy: "5",
    loopIncreaseAt: "3",
    loopIncreaseEnabled: false,
    loopPlaybackEnabled: false,
    metronomeBpm: 0,
    pitchSemitones: 0,
    pitchCents: 0,
    regions: [],
    markers: [{ time: 3, name: "" }, { time: 6, name: "" }, { time: 9, name: "" }, { time: 11.5, name: "" }],
    updatedAt: Date.now(),
  });

  const videoBuf = fs.readFileSync(path.join(__dirname, "fixtures", "test-video.mp4"));
  await page.route("**/127.0.0.1:17865/**", (route) => {
    const range = route.request().headers()["range"];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : videoBuf.length - 1;
      route.fulfill({
        status: 206,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${videoBuf.length}` },
        body: videoBuf.subarray(start, end + 1),
      });
    } else {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(videoBuf.length) },
        body: videoBuf,
      });
    }
  });

  // The beforeEach already navigated before the addInitScript calls above were
  // registered, so reload to make sure they actually apply.
  await page.reload();
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator("#waveMarkerLabel")).toContainText("4 markers");
  await page.locator('button[title="Pause"]').click();

  const label = page.locator("#waveMarkerLabel");
  const nextBtn = page.locator("#waveNextMarkerBtn");

  // First Next: playhead is genuinely at ~0, so this should land on M1 (3s) either way.
  await nextBtn.click();
  await expect(label).toContainText("1/4 selected");
  await expect.poll(() => page.evaluate(() => document.querySelector("video")!.currentTime)).toBeCloseTo(3, 0);

  // Second Next: with timeupdate blocked, the buggy code still thinks t=0 and
  // re-selects M1 instead of advancing to M2 (6s).
  await nextBtn.click();
  await expect(label).toContainText("2/4 selected");
  await expect.poll(() => page.evaluate(() => document.querySelector("video")!.currentTime)).toBeCloseTo(6, 0);

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

// WebKit (what Tauri's macOS webview uses) silently drops a `<video>` element's
// `currentTime` assignment made before `readyState` reaches HAVE_METADATA — unlike
// Chromium, it does not defer/honor it once metadata loads; playback just
// continues from wherever autoplay left it. This matters in practice because a
// large/non-optimized video can take a moment to establish metadata over the
// local Range-serving file server, and a user clicking marker Next right after
// opening the player (before that completes) would see the seek silently do
// nothing. This test forces that window open by delaying every response from the
// local file server, and checks the marker jump still lands correctly once
// metadata becomes available.
test("marker Next issued before video metadata has loaded still lands on the right marker", async ({ page }) => {
  await page.addInitScript((preset) => {
    localStorage.setItem("practicePlayerPresets", JSON.stringify({ "/path/to/practice.mp4": preset }));
  }, {
    filePath: "/path/to/practice.mp4",
    mediaType: "video",
    playbackSpeed: 1,
    loopStart: "",
    loopEnd: "",
    loopIncreaseBy: "5",
    loopIncreaseAt: "3",
    loopIncreaseEnabled: false,
    loopPlaybackEnabled: false,
    metronomeBpm: 0,
    pitchSemitones: 0,
    pitchCents: 0,
    regions: [],
    markers: [{ time: 3, name: "" }, { time: 6, name: "" }, { time: 9, name: "" }, { time: 11.5, name: "" }],
    updatedAt: Date.now(),
  });

  const videoBuf = fs.readFileSync(path.join(__dirname, "fixtures", "test-video.mp4"));
  await page.route("**/127.0.0.1:17865/**", async (route) => {
    await new Promise(r => setTimeout(r, 1500)); // simulate metadata taking a moment to establish
    const range = route.request().headers()["range"];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : videoBuf.length - 1;
      route.fulfill({
        status: 206,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${videoBuf.length}` },
        body: videoBuf.subarray(start, end + 1),
      });
    } else {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(videoBuf.length) },
        body: videoBuf,
      });
    }
  });

  await page.reload();
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator("#waveMarkerLabel")).toContainText("4 markers");

  // Metadata hasn't loaded yet (readyState 0) — click Next right away.
  await expect(page.evaluate(() => document.querySelector("video")!.readyState)).resolves.toBe(0);
  await page.locator("#waveNextMarkerBtn").click();
  await expect(page.locator("#waveMarkerLabel")).toContainText("1/4 selected");

  // The instant metadata becomes available, currentTime should already reflect
  // the deferred seek to M1 (3s) — not 0 (dropped) and not some later position
  // reached by autoplay running unseeked in the meantime.
  const atReady = await page.evaluate(() => new Promise<number>((resolve) => {
    const v = document.querySelector("video") as HTMLVideoElement;
    if (v.readyState >= 1) { resolve(v.currentTime); return; }
    v.addEventListener("loadedmetadata", () => resolve(v.currentTime), { once: true });
  }));
  expect(atReady).toBeCloseTo(3, 0);

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

// While a seek is still deferred (readyState hasn't reached HAVE_METADATA — see
// above), `vid.currentTime` itself hasn't moved yet. If a second Next click reads
// that unmoved value to compute where to jump next, it recomputes the exact same
// answer as the first click and the user is stuck landing back on marker 1 no
// matter how many times they click — "Next just keeps taking me back to the
// start." getCurrentTime must use the pending seek target, not the stale DOM value,
// so repeated clicks before the video is ready still advance correctly.
test("clicking Next twice before video metadata has loaded advances to the second marker, not back to the first", async ({ page }) => {
  await page.addInitScript((preset) => {
    localStorage.setItem("practicePlayerPresets", JSON.stringify({ "/path/to/practice.mp4": preset }));
  }, {
    filePath: "/path/to/practice.mp4",
    mediaType: "video",
    playbackSpeed: 1,
    loopStart: "",
    loopEnd: "",
    loopIncreaseBy: "5",
    loopIncreaseAt: "3",
    loopIncreaseEnabled: false,
    loopPlaybackEnabled: false,
    metronomeBpm: 0,
    pitchSemitones: 0,
    pitchCents: 0,
    regions: [],
    markers: [{ time: 3, name: "" }, { time: 6, name: "" }, { time: 9, name: "" }, { time: 11.5, name: "" }],
    updatedAt: Date.now(),
  });

  const videoBuf = fs.readFileSync(path.join(__dirname, "fixtures", "test-video.mp4"));
  await page.route("**/127.0.0.1:17865/**", async (route) => {
    await new Promise(r => setTimeout(r, 1500)); // simulate metadata taking a moment to establish
    const range = route.request().headers()["range"];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : videoBuf.length - 1;
      route.fulfill({
        status: 206,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${videoBuf.length}` },
        body: videoBuf.subarray(start, end + 1),
      });
    } else {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(videoBuf.length) },
        body: videoBuf,
      });
    }
  });

  await page.reload();
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator("#waveMarkerLabel")).toContainText("4 markers");

  await expect(page.evaluate(() => document.querySelector("video")!.readyState)).resolves.toBe(0);
  const nextBtn = page.locator("#waveNextMarkerBtn");
  const label = page.locator("#waveMarkerLabel");

  await nextBtn.click();
  await expect(label).toContainText("1/4 selected");
  // Still not ready — the second click must not see the first seek's target as
  // "already there" and recompute from the stale (pre-seek) DOM value.
  await expect(page.evaluate(() => document.querySelector("video")!.readyState)).resolves.toBe(0);
  await nextBtn.click();
  await expect(label).toContainText("2/4 selected");

  const atReady = await page.evaluate(() => new Promise<number>((resolve) => {
    const v = document.querySelector("video") as HTMLVideoElement;
    if (v.readyState >= 1) { resolve(v.currentTime); return; }
    v.addEventListener("loadedmetadata", () => resolve(v.currentTime), { once: true });
  }));
  expect(atReady).toBeCloseTo(6, 0);

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("Alt+ArrowLeft/Right navigate markers via keyboard shortcuts", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  await page.locator("#waveAddMarkerBtn").click();
  await page.locator('button[title="Skip forward 5%"]').click();
  await page.locator("#waveAddMarkerBtn").click();
  await expect(page.locator("#waveMarkerLabel")).toContainText("2/2 selected");

  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator("#waveMarkerLabel")).toContainText("1/2 selected");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator("#waveMarkerLabel")).toContainText("2/2 selected");

  // Shortcuts appear in the palette too.
  await page.locator('button[title="Keyboard shortcuts"]').click();
  const palette = page.locator(".mp-palette");
  await expect(palette.locator(".mp-palette-item", { hasText: "Previous marker" }).locator(".mp-shortcut-key")).toHaveText("Alt+ArrowLeft");
  await expect(palette.locator(".mp-palette-item", { hasText: "Next marker" }).locator(".mp-shortcut-key")).toHaveText("Alt+ArrowRight");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});
