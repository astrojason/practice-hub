import { test, expect } from "./base";
import type { Locator, Page } from "@playwright/test";

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
  await page.route("**/127.0.0.1:17865/**", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "audio/mpeg" }, body: Buffer.from([]) }));
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
});

async function openStandalone(page: Page): Promise<Locator> {
  await page.locator("button", { hasText: "Metronome" }).click();
  const input = page.locator(".metronome-panel__bpm-input");
  await expect(input).toBeVisible();
  return input;
}

async function openInPlayer(page: Page): Promise<Locator> {
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  const input = page.locator("#metronomeBpm");
  await expect(input).toBeVisible();
  return input;
}

async function clear(input: Locator) {
  await input.click();
  await input.selectText(); // (Ctrl+A moves the caret to line start on macOS instead of selecting)
  await input.press("Backspace");
}

const fields: [string, (p: Page) => Promise<Locator>][] = [
  ["standalone metronome", openStandalone],
  ["metronome inside the media player", openInPlayer],
];

for (const [label, open] of fields) {
  test.describe(label, () => {
    test("clearing the BPM and typing a new one gives exactly what was typed", async ({ page }) => {
      const input = await open(page);
      await clear(input);
      await input.pressSequentially("90");
      await expect(input).toHaveValue("90");

      await clear(input);
      await input.pressSequentially("172");
      await expect(input).toHaveValue("172");
    });

    test("a half-typed BPM below the minimum isn't jammed to 40 while typing", async ({ page }) => {
      const input = await open(page);
      await clear(input);
      await input.pressSequentially("9");
      await expect(input).toHaveValue("9"); // on its way to 90 / 95 / 96…
      await input.blur();
      await expect(input).toHaveValue("40"); // …but if left there, it's held to the 40 minimum
    });

    test("an out-of-range BPM is held to 260 on blur", async ({ page }) => {
      const input = await open(page);
      await clear(input);
      await input.pressSequentially("300");
      await input.blur();
      await expect(input).toHaveValue("260");
    });

    test("leaving the field empty puts the last valid BPM back", async ({ page }) => {
      const input = await open(page);
      await clear(input);
      await input.pressSequentially("140");
      await clear(input);
      await input.blur();
      await expect(input).toHaveValue("140");
    });
  });
}
