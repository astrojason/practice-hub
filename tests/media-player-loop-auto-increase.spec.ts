import { test, expect } from "./base";

// A minimal valid, decodable WAV file (silence) so the audio engine reports a
// real, nonzero duration — region actions are gated on `dur > 0`.
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
    resources: [{ name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file" }],
    meta: { user_exercise: null, sessions: [] },
  }],
  study_materials: [], chord: null, progression: null, interval: null,
};

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

async function openPlayerWithShortLoop(page: import("@playwright/test").Page) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });
  await page.locator('button[title="Pause"]').click();

  // Loop 0 → ≈0.45s
  await page.locator('button[title="Set from playhead"]').first().click();
  for (let i = 0; i < 3; i++) {
    const before = await page.locator(".media-player__time").textContent();
    await page.locator('button[title="Skip forward 5%"]').click();
    await expect(page.locator(".media-player__time")).not.toHaveText(before ?? "");
  }
  await page.locator('button[title="Set from playhead"]').nth(1).click();
  await page.locator('button[title="Go to loop start"]').click();
}

test("auto-increase bumps the speed once the loop has repeated the configured number of times (every 1 loop)", async ({ page }) => {
  await openPlayerWithShortLoop(page);

  await page.locator("#loopPlayback").check();
  await page.locator("#loopIncrease").check();
  await page.fill("#loopIncreaseBy", "10");
  await page.fill("#loopIncreaseAt", "1");

  await expect(page.locator("#speedIndicator")).toHaveText("100%");
  await page.locator('button[title="Play"]').click();

  // Each pass through the 0.45s loop should add 10%, so it must climb well past 100%.
  await expect(page.locator("#speedIndicator")).not.toHaveText("100%", { timeout: 8000 });
  await expect.poll(async () => parseInt((await page.locator("#speedIndicator").textContent()) ?? "0"), { timeout: 8000 }).toBeGreaterThan(110);
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("auto-increase can push the speed above 100% (only the 1%-a-day region boost stops at 100%)", async ({ page }) => {
  await openPlayerWithShortLoop(page);

  await page.locator("#loopPlayback").check();
  await page.locator("#loopIncrease").check();
  await page.fill("#loopIncreaseBy", "50");
  await page.fill("#loopIncreaseAt", "1");
  await page.locator('button[title="Play"]').click();

  await expect.poll(async () => parseInt((await page.locator("#speedIndicator").textContent()) ?? "0"), { timeout: 8000 }).toBeGreaterThan(150);
});

test("enabling auto-increase while the loop is already playing takes effect", async ({ page }) => {
  await openPlayerWithShortLoop(page);

  await page.locator("#loopPlayback").check();
  await page.locator('button[title="Play"]').click();
  await expect(page.locator('button[title="Pause"]')).toBeVisible();
  await page.waitForTimeout(1200); // a couple of passes through the loop before it's switched on

  await page.locator("#loopIncrease").check();
  await page.fill("#loopIncreaseBy", "10");
  await page.fill("#loopIncreaseAt", "1");

  await expect.poll(async () => parseInt((await page.locator("#speedIndicator").textContent()) ?? "0"), { timeout: 8000 }).toBeGreaterThan(110);
});

async function retype(page: import("@playwright/test").Page, selector: string, text: string) {
  const input = page.locator(selector);
  await input.click();
  await input.selectText(); // (Ctrl+A moves the caret to line start on macOS instead of selecting)
  await input.press("Backspace"); // a person clears the field first — it must be allowed to sit empty
  await input.pressSequentially(text);
  await expect(input).toHaveValue(text);
}

test("typing '1' into the loops field (after clearing it) means every 1 loop, and it fires", async ({ page }) => {
  await openPlayerWithShortLoop(page);

  await page.locator("#loopPlayback").check();
  await page.locator("#loopIncrease").check();
  await retype(page, "#loopIncreaseBy", "10");
  await retype(page, "#loopIncreaseAt", "1");

  await page.locator('button[title="Play"]').click();
  await expect.poll(async () => parseInt((await page.locator("#speedIndicator").textContent()) ?? "0"), { timeout: 8000 }).toBeGreaterThan(110);
});

test("the loop-break number fields can also be cleared and retyped", async ({ page }) => {
  await openPlayerWithShortLoop(page);
  await page.locator("#loopBreak").check();
  await retype(page, "#loopBreakDuration", "2");
  await retype(page, "#loopBreakAfter", "4");
});

test("leaving a number field empty puts the last valid value back", async ({ page }) => {
  await openPlayerWithShortLoop(page);
  await retype(page, "#loopIncreaseAt", "7");
  const at = page.locator("#loopIncreaseAt");
  await at.selectText();
  await at.press("Backspace");
  await at.blur();
  await expect(at).toHaveValue("7");
});

// Samples the transport clock in-page (no round-trip latency) and reports the
// longest stretch it sat still, plus whether it moved again afterwards.
async function sampleClock(page: import("@playwright/test").Page, ms: number) {
  return page.evaluate(async (total) => {
    const el = document.querySelector(".media-player__time")!;
    const samples: { t: number; v: string }[] = [];
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const id = setInterval(() => {
        samples.push({ t: performance.now() - start, v: el.textContent ?? "" });
        if (performance.now() - start >= total) { clearInterval(id); resolve(); }
      }, 40);
    });
    let longest = 0, longestEnd = 0, runStart = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].v !== samples[i - 1].v) runStart = i;
      const run = samples[i].t - samples[runStart].t;
      if (run > longest) { longest = run; longestEnd = i; }
    }
    const movedAfter = samples.slice(longestEnd + 1).some((s) => s.v !== samples[longestEnd].v);
    return { longest, movedAfter };
  }, ms);
}

test("with a 3-second break every loop, playback really pauses for the break and then resumes", async ({ page }) => {
  await openPlayerWithShortLoop(page);
  await page.locator("#loopPlayback").check();
  await page.locator("#loopBreak").check();
  await retype(page, "#loopBreakDuration", "3");
  await retype(page, "#loopBreakAfter", "1");

  await page.locator('button[title="Play"]').click();
  const { longest, movedAfter } = await sampleClock(page, 9000);

  expect(longest).toBeGreaterThan(2500); // the clock froze for ≈ the 3s break
  expect(movedAfter).toBe(true); // …and playback carried on afterwards
});

test("with the break turned off, the clock never sits still for seconds", async ({ page }) => {
  await openPlayerWithShortLoop(page);
  await page.locator("#loopPlayback").check();
  await page.locator('button[title="Play"]').click();
  const { longest } = await sampleClock(page, 4000);
  expect(longest).toBeLessThan(1000);
});
