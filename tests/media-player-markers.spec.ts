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

// Prev/Next step through markers strictly by list order (selectedIdx ± 1), not by
// comparing against the playhead — so scrubbing away from the selected marker
// doesn't change what the next click does, and each button disables itself at
// its end of the list instead of wrapping around.
test("marker Prev/Next always move to the adjacent marker by order and disable at the ends", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
  // Playback auto-starts on load — pause it so seeks below are the only thing
  // moving the playhead (otherwise real-time drift makes the math flaky). Wait
  // for the button to actually flip to "Play" — clicking before autoplay has
  // truly started would toggle it back on instead of pausing it.
  await page.locator('button[title="Pause"]').click();
  await expect(page.locator('button[title="Play"]')).toBeVisible();

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const skipBackward = page.locator('button[title="Skip back 5%"]');
  const label = page.locator("#waveMarkerLabel");
  const timeLabel = page.locator(".media-player__time");
  const prevBtn = page.locator("#wavePrevMarkerBtn");
  const nextBtn = page.locator("#waveNextMarkerBtn");

  // M1 at t≈0 — the only marker so far, so both ends are also the only marker.
  await page.locator("#waveAddMarkerBtn").click();
  await expect(label).toContainText("1/1 selected");
  await expect(prevBtn).toBeDisabled();
  await expect(nextBtn).toBeDisabled();

  // M2 at t≈0.90 (6 × 5% of a 3s clip).
  await clickAndSettle(skipForward, timeLabel, 6);
  await page.locator("#waveAddMarkerBtn").click();
  await expect(label).toContainText("2/2 selected");
  await expect(nextBtn).toBeDisabled(); // newly added marker is selected and is last

  // M3 at t≈1.80 — selection is now on M3 (the last-added marker, last in order).
  await clickAndSettle(skipForward, timeLabel, 6);
  await page.locator("#waveAddMarkerBtn").click();
  await expect(label).toContainText("3/3 selected");
  await expect(nextBtn).toBeDisabled();
  await expect(prevBtn).toBeEnabled();

  // Scrub back near M1, without touching markers — the selection silently
  // follows the playhead back down to M1 (no seek, just the highlighted marker
  // updating), landing at the first marker again.
  await clickAndSettle(skipBackward, timeLabel, 20);
  await expect(label).toContainText("1/3 selected");
  await expect(prevBtn).toBeDisabled();

  // Next always steps to the strictly next marker in order.
  await nextBtn.click();
  await expect(label).toContainText("2/3 selected");
  await expect(prevBtn).toBeEnabled();
  await nextBtn.click();
  await expect(label).toContainText("3/3 selected");
  await expect(nextBtn).toBeDisabled(); // at the last marker now

  // Prev always steps to the strictly previous marker.
  await prevBtn.click();
  await expect(label).toContainText("2/3 selected");
  await prevBtn.click();
  await expect(label).toContainText("1/3 selected");
  await expect(prevBtn).toBeDisabled(); // at the first marker now

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

// Uses video rather than audio: pausing a <video> element is a real native
// operation, whereas the audio engine's SoundTouch worklet keeps advancing its
// internal position in the background even after "pause" disconnects it from
// output (see TODO.md) — that would make the deliberately-real-time wait below
// flaky for reasons unrelated to what this test is actually checking.
test("the selected marker silently follows playback as it advances past each one, with no seek involved", async ({ page }) => {
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

  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card").first();
  await card.locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Video" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:12", { timeout: 10000 });
  await page.locator('button[title="Pause"]').click();
  await expect(page.locator('button[title="Play"]')).toBeVisible();

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const skipBackward = page.locator('button[title="Skip back 5%"]');
  const label = page.locator("#waveMarkerLabel");
  const timeLabel = page.locator(".media-player__time");

  // M1 at t≈1.80, M2 at t≈3.60 (of a 12s clip).
  await clickAndSettle(skipForward, timeLabel, 3);
  await page.locator("#waveAddMarkerBtn").click();
  await clickAndSettle(skipForward, timeLabel, 3);
  await page.locator("#waveAddMarkerBtn").click();
  await expect(label).toContainText("2/2 selected");

  // Rewind to the very start, before either marker — nothing is "current" yet.
  await clickAndSettle(skipBackward, timeLabel, 6);
  await expect(label).toContainText("2 markers");
  await expect(label).not.toContainText("selected");

  // Resume real playback (no button clicks, no seeks) and let it run past both
  // markers on its own — the selection should silently pick each one up in turn.
  await page.locator('button[title="Play"]').click();
  await expect(label).toContainText("1/2 selected", { timeout: 5000 });
  await expect(label).toContainText("2/2 selected", { timeout: 5000 });

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

// WebKit (what Tauri's macOS webview uses) silently drops a `<video>` element's
// `currentTime` assignment made before `readyState` reaches HAVE_METADATA — unlike
// Chromium, it does not defer/honor it once metadata loads; playback just
// continues from wherever autoplay left it. This matters in practice because a
// large/non-optimized video can take a moment to establish metadata over the
// local Range-serving file server, and clicking marker Next right after opening
// the player (before that completes) would seek nowhere. Since Prev/Next now
// jump by list order rather than by playhead position, the *selection* always
// updates immediately regardless of video readiness — what this test actually
// exercises is that the underlying seek is still deferred-and-applied correctly
// (landing on the last-requested marker, not silently dropped or stuck on an
// earlier one) once metadata becomes available, including across two rapid
// clicks issued before the video was ever ready.
test("marker Next clicked twice before video metadata has loaded still ends up seeked to the second marker", async ({ page }) => {
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
  // The first marker (3s) is auto-selected as soon as the preset loads.
  await expect(page.locator("#waveMarkerLabel")).toContainText("4 markers · 1/4 selected");

  await expect(page.evaluate(() => document.querySelector("video")!.readyState)).resolves.toBe(0);
  const nextBtn = page.locator("#waveNextMarkerBtn");
  const label = page.locator("#waveMarkerLabel");

  // Selection advances synchronously regardless of video readiness — both clicks
  // land immediately even though metadata is still loading.
  await nextBtn.click();
  await expect(label).toContainText("2/4 selected");
  await expect(page.evaluate(() => document.querySelector("video")!.readyState)).resolves.toBe(0);
  await nextBtn.click();
  await expect(label).toContainText("3/4 selected");

  // Once metadata becomes available, the actual seek should land on the LAST
  // requested marker (9s, the 3rd) — not silently dropped (0) and not stuck on
  // the first click's target (6s).
  const atReady = await page.evaluate(() => new Promise<number>((resolve) => {
    const v = document.querySelector("video") as HTMLVideoElement;
    if (v.readyState >= 1) { resolve(v.currentTime); return; }
    v.addEventListener("loadedmetadata", () => resolve(v.currentTime), { once: true });
  }));
  expect(atReady).toBeCloseTo(9, 0);

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
