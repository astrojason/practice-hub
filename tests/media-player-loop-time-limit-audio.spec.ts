import { test, expect } from "./base";

function wav(seconds: number): Buffer {
  const sr = 8000, n = sr * seconds, ds = n * 2, b = Buffer.alloc(44 + ds);
  b.write("RIFF", 0); b.writeUInt32LE(36 + ds, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(ds, 40); return b;
}
const user = { id: 1, firebase_uid: "u", email: "t@e.com", display_name: "T", daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0, total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5 };
const dash = {
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] }, project: { songs: [] },
  exercises: [{ id: 1, name: "Ex", order: 1, session_type: "exercise", parent_exercise_id: null, created_timestamp: 0, updated_timestamp: 0, child_exercises: [],
    resources: [{ name: "Practice Track", url: "/path/to/practice.mp3", type: "local_file" }], meta: { user_exercise: null, sessions: [] } }],
  study_materials: [], chord: null, progression: null, interval: null,
};

test("an audio loop's time limit is used as soon as it is typed, without leaving the field", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ph:refreshToken", "x"));
  await page.route("**/securetoken.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "t", refresh_token: "r" }) }));
  await page.route("**/user/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/user/dashboard**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dash) }));
  await page.route("**/127.0.0.1:17865/**", (r) => r.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: wav(12) }));
  await page.goto("/");
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: "Practice Track" }).click();
  await expect(page.locator(".media-player")).toBeVisible();
  await page.fill("#loopStart", "0:01");
  await page.locator("#loopStart").blur();
  await page.fill("#loopEnd", "0:02");
  await page.locator("#loopEnd").blur();
  await page.locator("#loopPlayback").check();
  // The file may already be playing on open; make sure it is.
  if (await page.locator('button[title="Play"]').count()) await page.locator('button[title="Play"]').click();
  await expect(page.locator('button[title="Pause"]')).toBeVisible();
  await page.waitForTimeout(500);
  // Typed while playing, never blurred: 2s is reached by the end of the 2nd pass.
  await page.fill("#loopMaxMinutes", "2s");
  await expect(page.locator('button[title="Play"]')).toBeVisible({ timeout: 6000 });
});
