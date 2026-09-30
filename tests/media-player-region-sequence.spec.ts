import { test, expect } from "./base";

// A minimal valid, decodable WAV file (silence) so the audio engine reports a
// real, nonzero duration — region/sequence actions are gated on `dur > 0`.
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

async function openPlayerAndBuildTwoRegions(page: import("@playwright/test").Page) {
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
  const setFromPlayhead = page.locator('button[title="Set from playhead"]');
  const speedInput = page.locator(".media-player__speed-input");
  const timeLabel = page.locator(".media-player__time");

  async function clickAndSettle(button: import("@playwright/test").Locator, times: number) {
    for (let i = 0; i < times; i++) {
      const before = await timeLabel.textContent();
      await button.click();
      await expect(timeLabel).not.toHaveText(before ?? "");
    }
  }

  // Region A: 0 → ~1.20s (8 × 5%), speed 75%.
  await setFromPlayhead.first().click(); // In = 0
  await clickAndSettle(skipForward, 8);
  await setFromPlayhead.nth(1).click(); // Out ≈ 1.20
  await speedInput.fill("0.75");
  await speedInput.blur();
  await page.fill("#regionNameInput", "Verse");
  await page.locator("#addRegionBtn").click();
  await expect(page.locator(".mp-region-item", { hasText: "Verse" })).toBeVisible();

  // Reset speed and loop before building the second region.
  await speedInput.fill("1.00");
  await speedInput.blur();

  // Region B: ~1.50 → ~2.70s, speed 150%.
  await clickAndSettle(skipForward, 2); // now ≈1.50
  await setFromPlayhead.first().click(); // In ≈ 1.50
  await clickAndSettle(skipForward, 8); // now ≈2.70
  await setFromPlayhead.nth(1).click(); // Out ≈ 2.70
  await speedInput.fill("1.50");
  await speedInput.blur();
  await page.fill("#regionNameInput", "Chorus");
  await page.locator("#addRegionBtn").click();
  await expect(page.locator(".mp-region-item", { hasText: "Chorus" })).toBeVisible();

  await speedInput.fill("1.00");
  await speedInput.blur();
}

test("playing a sequence of selected regions auto-advances and applies each region's tempo", async ({ page }) => {
  await openPlayerAndBuildTwoRegions(page);

  const verseCheckbox = page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]');
  const chorusCheckbox = page.locator(".mp-region-item", { hasText: "Chorus" }).locator('input[type="checkbox"]');
  await verseCheckbox.check();
  await chorusCheckbox.check();

  await page.locator("#playSequenceBtn").click();
  // Sequence playback auto-starts — pause so the skip-forward math below is
  // the only thing moving the playhead (real-time drift makes it flaky).
  await page.locator('button[title="Pause"]').click();
  await expect(page.locator("#sequenceStatus")).toContainText("1/2");
  await expect(page.locator("#speedIndicator")).toHaveText("75%");

  // Cross Verse's end (~1.20s) — sequence should advance to Chorus and apply its speed.
  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const timeLabel = page.locator(".media-player__time");
  async function clickAndSettle(times: number) {
    for (let i = 0; i < times; i++) {
      const before = await timeLabel.textContent();
      await skipForward.click();
      await expect(timeLabel).not.toHaveText(before ?? "");
    }
  }
  await clickAndSettle(9);
  await expect(page.locator("#sequenceStatus")).toContainText("2/2");
  await expect(page.locator("#speedIndicator")).toHaveText("150%");

  // Cross Chorus's end (~2.70s) with no loop — sequence should stop. Real-time
  // audio position drift differs slightly across browser engines, so the exact
  // click count needed to reach the boundary (and whether it overshoots into
  // the clip's 3s clamp, where a further skip-forward is a legitimate no-op)
  // varies too. Click enough to comfortably cross it in either engine, pausing
  // briefly after each so clicks don't race ahead of state updates and
  // under-count — what's actually under test is that the sequence stopped,
  // not the exact resulting position.
  for (let i = 0; i < 9; i++) {
    await skipForward.click();
    await page.waitForTimeout(80);
  }
  await expect(page.locator("#playSequenceBtn")).toContainText("Play Sequence");
  await expect(page.locator("#sequenceStatus")).toHaveCount(0);

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("loop sequence wraps back to the first region instead of stopping", async ({ page }) => {
  await openPlayerAndBuildTwoRegions(page);

  const verseCheckbox = page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]');
  const chorusCheckbox = page.locator(".mp-region-item", { hasText: "Chorus" }).locator('input[type="checkbox"]');
  await verseCheckbox.check();
  await chorusCheckbox.check();
  await page.locator("#sequenceLoopToggle").check();

  await page.locator("#playSequenceBtn").click();
  await page.locator('button[title="Pause"]').click();
  await expect(page.locator("#sequenceStatus")).toContainText("1/2");

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const timeLabel = page.locator(".media-player__time");
  async function clickAndSettle(times: number) {
    for (let i = 0; i < times; i++) {
      const before = await timeLabel.textContent();
      await skipForward.click();
      await expect(timeLabel).not.toHaveText(before ?? "");
    }
  }
  await clickAndSettle(9);
  await expect(page.locator("#sequenceStatus")).toContainText("2/2");

  await clickAndSettle(10);
  // Wraps back to Verse instead of stopping.
  await expect(page.locator("#sequenceStatus")).toContainText("1/2");
  await expect(page.locator("#speedIndicator")).toHaveText("75%");
  await expect(page.locator("#playSequenceBtn")).toContainText("Stop Sequence");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("region name and start/end inputs follow the current region during sequence playback, and Update Region edits it", async ({ page }) => {
  await openPlayerAndBuildTwoRegions(page);

  const verseCheckbox = page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]');
  const chorusCheckbox = page.locator(".mp-region-item", { hasText: "Chorus" }).locator('input[type="checkbox"]');
  await verseCheckbox.check();
  await chorusCheckbox.check();

  await page.locator("#playSequenceBtn").click();
  await page.locator('button[title="Pause"]').click();
  await expect(page.locator("#sequenceStatus")).toContainText("1/2");
  await expect(page.locator("#regionNameInput")).toHaveValue("Verse");
  const verseStart = await page.locator("#loopStart").inputValue();
  const verseEnd = await page.locator("#loopEnd").inputValue();

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const timeLabel = page.locator(".media-player__time");
  for (let i = 0; i < 9; i++) {
    const before = await timeLabel.textContent();
    await skipForward.click();
    await expect(timeLabel).not.toHaveText(before ?? "");
  }
  await expect(page.locator("#sequenceStatus")).toContainText("2/2");

  // Inputs now reflect Chorus, not Verse.
  await expect(page.locator("#regionNameInput")).toHaveValue("Chorus");
  await expect(page.locator("#loopStart")).not.toHaveValue(verseStart);
  await expect(page.locator("#loopEnd")).not.toHaveValue(verseEnd);

  // Updating while Chorus is current changes Chorus, leaving Verse untouched.
  const speedInput = page.locator(".media-player__speed-input");
  await speedInput.fill("1.25");
  await speedInput.blur();
  await page.locator("#updateRegionBtn").click();
  await expect(page.locator(".mp-region-item", { hasText: "Chorus" })).toContainText("125%");
  await expect(page.locator(".mp-region-item", { hasText: "Verse" })).toContainText("75%");

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("finishing a sequence and reopening the resource does not restore the last region's bounds", async ({ page }) => {
  await openPlayerAndBuildTwoRegions(page);

  await page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]').check();
  await page.locator(".mp-region-item", { hasText: "Chorus" }).locator('input[type="checkbox"]').check();
  await page.locator("#playSequenceBtn").click();
  await page.locator('button[title="Pause"]').click();
  await expect(page.locator("#sequenceStatus")).toContainText("1/2");

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  for (let i = 0; i < 18; i++) {
    await skipForward.click();
    await page.waitForTimeout(80);
  }
  await expect(page.locator("#sequenceStatus")).toHaveCount(0);

  await page.locator('button[title="Close player"]').click();
  await expect(page.locator(".media-player")).toHaveCount(0);

  // The saved preset must not carry the last step's bounds, or the next load
  // re-selects that region. (Asserted on storage, not the reopened UI: the
  // track auto-plays on load and can legitimately re-enter a checked region.)
  const saved = await page.evaluate(() => {
    const all = Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /preset/i.test(k)) ?? "") ?? "{}")) as Array<{ loopStart: string; loopEnd: string; loopPlaybackEnabled: boolean }>;
    return all[0];
  });
  expect(saved.loopStart).toBe("");
  expect(saved.loopEnd).toBe("");
  expect(saved.loopPlaybackEnabled).toBe(true);

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("loop sequence of a region spanning the whole resource wraps back to the start", async ({ page }) => {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  await page.fill("#regionNameInput", "Whole");
  await page.locator("#addRegionBtn").click();
  const item = page.locator(".mp-region-item", { hasText: "Whole" });
  await expect(item).toBeVisible();
  await item.locator('input[type="checkbox"]').check();
  await page.locator("#sequenceLoopToggle").check();
  await page.locator("#playSequenceBtn").click();
  await expect(page.locator("#sequenceStatus")).toContainText("1/1");

  // The 3s clip must reach its end and wrap: the sequence keeps running and
  // the player is still playing well after one full pass.
  await page.waitForTimeout(4500);
  await expect(page.locator("#playSequenceBtn")).toContainText("Stop Sequence");
  await expect(page.locator('button[title="Pause"]')).toBeVisible();
});

test("a region with count-in on, played at a non-100% speed, pauses for a metronome count-in then resumes", async ({ page }) => {
  await openPlayerAndBuildTwoRegions(page);

  await page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]').check();
  await page.locator(".mp-region-item", { hasText: "Chorus" }).locator('input[type="checkbox"]').check();
  await page.locator(".mp-region-item", { hasText: "Chorus" }).locator('[data-region-action="count-in"]').click();

  await page.locator("#playSequenceBtn").click();
  await page.locator('button[title="Pause"]').click();
  await expect(page.locator("#sequenceStatus")).toContainText("1/2");
  // Verse has no count-in, so none is running.
  await expect(page.locator("#countInIndicator")).toHaveCount(0);

  const skipForward = page.locator('button[title="Skip forward 5%"]');
  const timeLabel = page.locator(".media-player__time");
  for (let i = 0; i < 9; i++) {
    const before = await timeLabel.textContent();
    await skipForward.click();
    await expect(timeLabel).not.toHaveText(before ?? "");
  }
  await expect(page.locator("#sequenceStatus")).toContainText("2/2");
  await expect(page.locator("#countInIndicator")).toBeVisible();
  await expect(page.locator('button[title="Play"]')).toBeVisible();

  // After the count, playback resumes.
  await expect(page.locator("#countInIndicator")).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('button[title="Pause"]')).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("loop In/Out can be nudged in fine steps, by buttons and arrow keys", async ({ page }) => {
  await openPlayerAndBuildTwoRegions(page);
  const secs = (v: string) => { const [m, s] = v.split(":"); return Number(m) * 60 + Number(s); };
  const startInput = page.locator("#loopStart");
  const endInput = page.locator("#loopEnd");
  await page.locator('button[title="Go to loop start"]').click().catch(() => {});
  await page.locator('button[title="Set from playhead"]').first().click();
  for (let i = 0; i < 6; i++) {
    const before = await page.locator(".media-player__time").textContent();
    await page.locator('button[title="Skip forward 5%"]').click();
    await expect(page.locator(".media-player__time")).not.toHaveText(before ?? "");
  }
  await page.locator('button[title="Set from playhead"]').nth(1).click();

  const s0 = secs(await startInput.inputValue());
  await page.locator('[data-loop-nudge="start:+0.1"]').click();
  await expect.poll(async () => secs(await startInput.inputValue())).toBeCloseTo(s0 + 0.1, 2);
  await page.locator('[data-loop-nudge="start:-0.01"]').click();
  await expect.poll(async () => secs(await startInput.inputValue())).toBeCloseTo(s0 + 0.09, 2);

  const e0 = secs(await endInput.inputValue());
  await page.locator('[data-loop-nudge="end:-0.1"]').click();
  await expect.poll(async () => secs(await endInput.inputValue())).toBeCloseTo(e0 - 0.1, 2);
  await endInput.focus();
  await endInput.press("ArrowUp");
  await expect.poll(async () => secs(await endInput.inputValue())).toBeCloseTo(e0 - 0.09, 2);

  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("the count-in indicator shows in the transport bpm row", async ({ page }) => {
  await openPlayerAndBuildTwoRegions(page);
  await page.locator(".mp-region-item", { hasText: "Verse" }).locator('input[type="checkbox"]').check();
  await page.locator(".mp-region-item", { hasText: "Verse" }).locator('[data-region-action="count-in"]').click();
  await page.locator("#playSequenceBtn").click();
  await expect(page.locator(".media-player__bpm-row #countInIndicator")).toBeVisible();
});

test("all regions can be opened in a modal and their names, starts and ends edited together", async ({ page }) => {
  await openPlayerAndBuildTwoRegions(page);

  await page.locator("#editRegionsBtn").click();
  const modal = page.locator('[data-testid="regions-modal"]');
  await expect(modal).toBeVisible();
  const rows = modal.locator("[data-regions-modal-row]");
  await expect(rows).toHaveCount(2);

  // An end at or before the start is rejected inline and nothing is saved.
  await rows.nth(0).locator('[data-field="end"]').fill("0:00");
  await modal.locator("#saveRegionsModalBtn").click();
  await expect(modal.locator(".regions-modal__error")).toBeVisible();
  await expect(modal).toBeVisible();

  await rows.nth(0).locator('[data-field="name"]').fill("Intro");
  await rows.nth(0).locator('[data-field="end"]').fill("0:01");
  await rows.nth(1).locator('[data-field="start"]').fill("0:01.25");
  await modal.locator("#saveRegionsModalBtn").click();
  await expect(modal).toHaveCount(0);

  const intro = page.locator(".mp-region-item", { hasText: "Intro" });
  await expect(intro).toContainText("0:01");
  await expect(page.locator(".mp-region-item", { hasText: "Chorus" })).toContainText("0:01.25");
  await expect(page.locator(".mp-region-item", { hasText: "Verse" })).toHaveCount(0);

  // Escape closes without saving.
  await page.locator("#editRegionsBtn").click();
  await modal.locator("[data-regions-modal-row]").nth(0).locator('[data-field="name"]').fill("Discarded");
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".mp-region-item", { hasText: "Discarded" })).toHaveCount(0);
  await expect(page.locator(".error-modal")).toHaveCount(0);
});
