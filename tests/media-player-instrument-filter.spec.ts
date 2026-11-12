import { test, expect, type Page } from "./base";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Filtering instruments out of a local audio/video resource: the file is split
// into Demucs stems (vocals, drums, bass, guitar, piano, other) by a Python
// sidecar, the player shows one toggle per stem, and muting a stem plays a mix
// of only the remaining stems. The muted set is saved per resource.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"];
const STEMS = STEM_NAMES.map((name) => ({ name, path: `/cache/stems/abc/${name}.wav` }));

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

function dashboardWith(url: string, name: string) {
  return {
    scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
    project: { songs: [] },
    exercises: [{
      id: 1, name: "Test Exercise", order: 1, session_type: "exercise", parent_exercise_id: null,
      created_timestamp: 0, updated_timestamp: 0, child_exercises: [],
      resources: [{ name, url, type: "local_file" }],
      meta: { user_exercise: null, sessions: [] },
    }],
    study_materials: [], chord: null, progression: null, interval: null,
  };
}

interface MockOpts {
  cached?: boolean;
  separateError?: string;
  mixError?: string;
}

type Calls = { cmd: string; args: Record<string, unknown> }[];

async function setup(page: Page, kind: "audio" | "video", opts: MockOpts = {}) {
  await page.addInitScript(({ stems, opts }) => {
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    (window as unknown as { __stemCalls: typeof calls }).__stemCalls = calls;
    window.__TAURI_INTERNALS__ = {
      invoke(cmd: string, args?: Record<string, unknown>) {
        if (cmd === "plugin:store|load") return Promise.resolve(1);
        if (cmd === "plugin:store|get") return Promise.resolve([null, false]);
        if (cmd === "plugin:store|has") return Promise.resolve(false);
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        calls.push({ cmd, args: args ?? {} });
        if (cmd === "get_cached_stems") return Promise.resolve(opts.cached ? stems : null);
        if (cmd === "separate_stems") {
          return opts.separateError ? Promise.reject(opts.separateError) : Promise.resolve(stems);
        }
        if (cmd === "mix_stems") {
          if (opts.mixError) return Promise.reject(opts.mixError);
          const muted = (args?.muted as string[]).slice().sort().join("+");
          return Promise.resolve(`/cache/stems/abc/mix-${muted}.wav`);
        }
        return Promise.resolve(null);
      },
      transformCallback() { return Math.random(); },
    } as unknown as typeof window.__TAURI_INTERNALS__;
  }, { stems: STEMS, opts });

  const url = kind === "audio" ? "/path/to/practice.mp3" : "/path/to/practice.mp4";
  const name = kind === "audio" ? "Practice Track" : "Practice Video";
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardWith(url, name)) })
  );

  const videoBuf = fs.readFileSync(path.join(__dirname, "fixtures", "test-video.mp4"));
  await page.route("**/127.0.0.1:17865/**", (route) => {
    const requested = new URL(route.request().url()).searchParams.get("path") ?? "";
    if (!requested.endsWith(".mp4")) {
      return route.fulfill({ status: 200, headers: { "Content-Type": "audio/wav" }, body: makeSilentWav(3) });
    }
    const range = route.request().headers()["range"];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : videoBuf.length - 1;
      return route.fulfill({
        status: 206,
        headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${videoBuf.length}` },
        body: videoBuf.subarray(start, end + 1),
      });
    }
    return route.fulfill({ status: 200, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" }, body: videoBuf });
  });
  await page.goto("/");
  return { url, name };
}

async function openPlayer(page: Page, name: string) {
  await expect(page.locator("h1", { hasText: "Practice Hub" })).toBeVisible();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  await page.locator(".modal-resource-link--local", { hasText: name }).click();
  await expect(page.locator(".media-player")).toBeVisible();
}

function calls(page: Page): Promise<Calls> {
  return page.evaluate(() => (window as unknown as { __stemCalls: Calls }).__stemCalls);
}

function stemToggle(page: Page, name: string) {
  return page.locator(".mp-instruments").getByRole("checkbox", { name: name[0].toUpperCase() + name.slice(1), exact: true });
}

function assetRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("127.0.0.1:17865")) {
      seen.push(new URL(req.url()).searchParams.get("path") ?? "");
    }
  });
  return seen;
}

test("an audio file can be separated into instrument stems from the player", async ({ page }) => {
  const { url, name } = await setup(page, "audio");
  await openPlayer(page, name);
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  const section = page.locator(".mp-instruments");
  await expect(section).toBeVisible();
  await expect(section.getByRole("checkbox")).toHaveCount(0);
  await section.getByRole("button", { name: "Separate instruments" }).click();

  for (const stem of STEM_NAMES) await expect(stemToggle(page, stem)).toBeChecked();
  const c = await calls(page);
  expect(c.find((x) => x.cmd === "get_cached_stems")?.args).toEqual({ filePath: url });
  expect(c.find((x) => x.cmd === "separate_stems")?.args).toEqual({ filePath: url });
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("already-separated stems show as toggles without re-running separation", async ({ page }) => {
  const { name } = await setup(page, "audio", { cached: true });
  await openPlayer(page, name);
  for (const stem of STEM_NAMES) await expect(stemToggle(page, stem)).toBeChecked();
  expect((await calls(page)).some((x) => x.cmd === "separate_stems")).toBe(false);
});

test("muting a stem plays a mix without it, and the choice is restored when the file is reopened", async ({ page }) => {
  const seen = assetRequests(page);
  const { url, name } = await setup(page, "audio", { cached: true });
  await openPlayer(page, name);
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  await stemToggle(page, "guitar").uncheck();
  await expect.poll(() => seen.includes("/cache/stems/abc/mix-guitar.wav")).toBe(true);
  const mix = (await calls(page)).find((x) => x.cmd === "mix_stems");
  expect(mix?.args).toEqual({ filePath: url, muted: ["guitar"] });

  await expect.poll(() =>
    page.evaluate((u) => JSON.parse(localStorage.getItem("practicePlayerPresets") ?? "{}")[u]?.mutedStems, url)
  ).toEqual(["guitar"]);

  // Close and reopen: the muted stem is still muted and the mix is reloaded.
  await page.locator('button[title="Close player"]').click();
  await expect(page.locator(".media-player")).toHaveCount(0);
  seen.length = 0;
  const link = page.locator(".modal-resource-link--local", { hasText: name });
  if (!(await link.isVisible())) {
    await page.locator(".item-card").first().locator('button[title="Log session"]').click();
  }
  await link.click();
  await expect(stemToggle(page, "guitar")).not.toBeChecked();
  await expect(stemToggle(page, "bass")).toBeChecked();
  await expect.poll(() => seen.includes("/cache/stems/abc/mix-guitar.wav")).toBe(true);
});

test("unmuting every stem goes back to the original file", async ({ page }) => {
  const seen = assetRequests(page);
  const { url, name } = await setup(page, "audio", { cached: true });
  await openPlayer(page, name);
  await expect(page.locator(".media-player__time")).toContainText("0:03", { timeout: 10000 });

  await stemToggle(page, "drums").uncheck();
  await expect.poll(() => seen.includes("/cache/stems/abc/mix-drums.wav")).toBe(true);
  seen.length = 0;
  await stemToggle(page, "drums").check();
  await expect.poll(() => seen.includes(url)).toBe(true);
  expect((await calls(page)).filter((x) => x.cmd === "mix_stems")).toHaveLength(1);
});

test("a separation failure is shown in the error modal", async ({ page }) => {
  const { name } = await setup(page, "audio", { separateError: "Demucs isn't installed" });
  await openPlayer(page, name);
  await page.locator(".mp-instruments").getByRole("button", { name: "Separate instruments" }).click();
  await expect(page.locator(".error-modal")).toContainText("Demucs isn't installed");
});

test("a mix failure is shown in the error modal", async ({ page }) => {
  const { name } = await setup(page, "audio", { cached: true, mixError: "numpy missing" });
  await openPlayer(page, name);
  await stemToggle(page, "vocals").uncheck();
  await expect(page.locator(".error-modal")).toContainText("numpy missing");
});

test("muting a stem on a video mutes the video's own audio and plays the mix alongside it", async ({ page }) => {
  const { name } = await setup(page, "video", { cached: true });
  await openPlayer(page, name);
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect(video).toHaveJSProperty("muted", false);

  await stemToggle(page, "guitar").uncheck();
  const stemAudio = page.locator("audio.mp-stem-audio");
  await expect(stemAudio).toHaveAttribute("src", /mix-guitar\.wav/);
  await expect(video).toHaveJSProperty("muted", true);

  await stemToggle(page, "guitar").check();
  await expect(stemAudio).toHaveCount(0);
  await expect(video).toHaveJSProperty("muted", false);
});
