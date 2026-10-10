import { test, expect } from "./base";

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

test("elapsed and total time have fixed widths wide enough for 00:00.000", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  const time = page.locator(".media-player__time");
  await expect(time).toContainText("0:03", { timeout: 10000 });

  const elapsed = page.locator(".media-player__time-elapsed");
  const total = page.locator(".media-player__time-total");
  const widthOf = (l: import("@playwright/test").Locator) => l.evaluate((el) => el.getBoundingClientRect().width);
  const w0 = await widthOf(elapsed);
  const t0 = await widthOf(total);

  // Wide enough for "00:00.000" in the same font.
  const needed = await elapsed.evaluate((el) => {
    const probe = document.createElement("span");
    probe.textContent = "00:00.000";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
    const cs = getComputedStyle(el);
    probe.style.font = cs.font;
    probe.style.fontVariantNumeric = cs.fontVariantNumeric;
    el.parentElement!.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  });
  expect(w0).toBeGreaterThanOrEqual(needed - 0.5);
  expect(t0).toBeGreaterThanOrEqual(needed - 0.5);

  // Width doesn't change as the playhead moves.
  const before = await time.textContent();
  await page.locator('button[title="Skip forward 5%"]').click();
  await expect(time).not.toHaveText(before ?? "");
  expect(await widthOf(elapsed)).toBeCloseTo(w0, 1);
  expect(await widthOf(total)).toBeCloseTo(t0, 1);
});
