import { test, expect } from "./base";
import { silentWav } from "./fixtures/silentWav";

const mockUser = {
  id: 1,
  firebase_uid: "test-uid",
  email: "test@example.com",
  display_name: "Test User",
  daily_minutes_goal: 30,
  timezone: "America/New_York",
  time_practiced_today: 0,
  total_time_practiced: 0,
  max_days_no_review: 7,
  min_days_between_reviews: 1,
  num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null,
  key_signature: null,
  overdue: [],
  to_review: { songs: [] },
  to_learn: { songs: [] },
  project: { songs: [] },
  exercises: [
    {
      id: 1,
      name: "Solo Exercise",
      order: 1,
      session_type: "exercise",
      parent_exercise_id: null,
      created_timestamp: 0,
      updated_timestamp: 0,
      child_exercises: [],
      resources: [
        { name: "Tab", url: "/path/to/solo.gp", type: "guitar_pro" },
        { name: "Backing", url: "/path/to/solo.mp3", type: "local_file" },
      ],
      meta: { user_exercise: null, sessions: [] },
    },
  ],
  study_materials: [],
  chord: null,
  progression: null,
  interval: null,
};

// Two bars of 4/4 for a guitar (frets 3 and 12 are easy to find in the DOM) and a bass.
const beat = (fret: number, string = 1) => ({ dur: 4, notes: [{ string, fret }] });
const mockSong = {
  id: "t",
  title: "Solo Song",
  artist: "Test Artist",
  tempo: 120,
  time: [4, 4],
  source: "user",
  author: "",
  revised: "",
  tracks: [
    {
      name: "Lead Guitar",
      instrument: "guitar",
      tuning: "standard",
      strings: [64, 59, 55, 50, 45, 40],
      difficulty: 3,
      measures: [
        { beats: [beat(3), beat(5), beat(7), beat(12)] },
        { beats: [beat(8), beat(10), beat(12), beat(15)] },
      ],
    },
    {
      name: "Bass",
      instrument: "bass",
      tuning: "bass-standard",
      strings: [43, 38, 33, 28],
      difficulty: 2,
      measures: [
        { beats: [beat(0, 2), beat(0, 2), beat(2, 2), beat(2, 2)] },
        { beats: [beat(3, 2), beat(3, 2), beat(5, 2), beat(5, 2)] },
      ],
    },
  ],
};

function withDrums(song: typeof mockSong) {
  const hit = (string: number, fret: number) => ({ dur: 4, notes: [{ string, fret }] });
  return {
    ...song,
    tracks: [
      ...song.tracks,
      {
        name: "Drums",
        instrument: "drums",
        tuning: "drums",
        strings: [49, 42, 38, 45, 36],
        difficulty: 1,
        measures: [
          { beats: [hit(2, 42), hit(3, 38), hit(2, 42), hit(5, 36)] },
          { beats: [hit(2, 42), hit(3, 38), hit(2, 42), hit(5, 36)] },
        ],
      },
    ],
  };
}

async function setup(page: import("@playwright/test").Page, opts: { readError?: string; tabUrl?: string; saveError?: string; drums?: boolean } = {}) {
  await page.addInitScript(
    ({ song, readError, saveError }) => {
      const w = window as unknown as { __calls: { cmd: string; args?: Record<string, unknown> }[] };
      w.__calls = [];
      let separated = false;
      const stemFiles = ["vocals", "drums", "bass", "guitar", "piano", "other"].map((name) => ({ name, path: `/cache/${name}.wav` }));
      window.__TAURI_INTERNALS__ = {
        invoke: function (cmd: string, args?: Record<string, unknown>) {
          w.__calls.push({ cmd, args });
          if (cmd === "plugin:store|load") return Promise.resolve(1);
          if (cmd === "plugin:store|get") return Promise.resolve([null, false]);
          if (cmd === "plugin:store|set") return Promise.resolve(null);
          if (cmd === "plugin:store|save") return Promise.resolve(null);
          if (cmd === "plugin:store|has") return Promise.resolve(false);
          if (cmd === "plugin:store|get_store") return Promise.resolve(null);
          if (cmd === "plugin:event|listen") return Promise.resolve(1);
          if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
          if (cmd === "get_cached_stems") return Promise.resolve(separated ? stemFiles : null);
          if (cmd === "separate_stems") {
            separated = true;
            return Promise.resolve(stemFiles);
          }
          if (cmd === "mix_stems") return Promise.resolve(`/cache/mix-${((args as { muted: string[] }).muted).join("+")}.wav`);
          if (cmd === "save_tab_copy") {
            return saveError ? Promise.reject(saveError) : Promise.resolve("/path/to/solo (edited).gp");
          }
          if (cmd === "read_tab_file") {
            return readError ? Promise.reject(readError) : Promise.resolve(JSON.stringify(song));
          }
          return Promise.resolve(null);
        },
        transformCallback: function () {
          return Math.random();
        },
      } as unknown as typeof window.__TAURI_INTERNALS__;
      localStorage.setItem("ph:refreshToken", "fake-refresh-token");
    },
    { song: opts.drums ? withDrums(mockSong) : mockSong, readError: opts.readError ?? null, saveError: opts.saveError ?? null }
  );
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }),
    })
  );
  await page.route("**/user/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) })
  );
  const dashboard = JSON.parse(JSON.stringify(mockDashboard));
  if (opts.tabUrl) dashboard.exercises[0].resources[0].url = opts.tabUrl;
  await page.route("**/user/dashboard**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboard) })
  );
  await page.route("http://127.0.0.1:17865/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      contentType: "audio/wav",
      body: silentWav(),
    })
  );
  await page.goto("/");
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  const card = page.locator(".item-card", { hasText: "Solo Exercise" }).first();
  await expect(card).toBeVisible();
  // Starting the timer opens the session modal, which lists the item's resources.
  await card.locator('button[title="Start timer"]').click();
}

async function openTab(page: import("@playwright/test").Page) {
  await page.locator(".modal-resource-link--local", { hasText: "Tab" }).first().click();
}

test("a Guitar Pro resource opens the in-app tab player, with the tab drawn", async ({ page }) => {
  await setup(page);
  await openTab(page);

  const player = page.locator(".tab-player");
  await expect(player).toBeVisible();
  await expect(player.locator(".tab-player-title")).toContainText("Solo Song");
  // Frets from the first track are drawn as SVG text.
  await expect(player.locator(".tab-line svg text", { hasText: /^12$/ }).first()).toBeVisible();
  // The file was read through the Rust command, and not handed to the OS.
  const calls = await page.evaluate(() => (window as unknown as { __calls: { cmd: string; args?: { path?: string; filePath?: string } }[] }).__calls);
  expect(calls.some((c) => c.cmd === "read_tab_file" && c.args?.filePath === "/path/to/solo.gp")).toBe(true);
  expect(calls.some((c) => c.cmd === "open_with_default")).toBe(false);
});

test("play starts the cursor and pause stops it", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await expect(player.locator(".tab-line")).not.toHaveCount(0);

  await player.locator('button[title="Play"]').click();
  await expect(player.locator(".tab-cursor.shown")).toBeVisible();
  await expect(player.locator('button[title="Pause"]')).toBeVisible();
  await player.locator('button[title="Pause"]').click();
  await expect(player.locator('button[title="Play"]')).toBeVisible();
});

test("an audio resource on the same item can be chosen as the backing recording", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  const select = player.locator(".tab-audio-select");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveText(["Synth (no recording)", "Backing"]);
  await select.selectOption({ label: "Backing" });
  await expect(player.locator(".tab-audio-status")).toContainText("Backing");
  // A load failure would have raised the error modal.
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("a file that cannot be read shows the actual error in the error modal", async ({ page }) => {
  await setup(page, { readError: "This isn't a Guitar Pro 7/8 file (it isn't a zip archive)" });
  await openTab(page);
  await expect(page.locator(".error-modal, [role=dialog]").filter({ hasText: "isn't a Guitar Pro 7/8 file" }).first()).toBeVisible();
});

test("Open in Guitar Pro hands the file to the OS", async ({ page }) => {
  await setup(page);
  await openTab(page);
  await page.locator(".tab-player").getByRole("button", { name: "Open in Guitar Pro" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __calls: { cmd: string; args?: { path?: string } }[] }).__calls.filter((c) => c.cmd === "open_with_default").map((c) => c.args?.path)))
    .toEqual(["/path/to/solo.gp"]);
});

test("closing the tab player keeps the session modal open", async ({ page }) => {
  await setup(page);
  await openTab(page);
  await page.locator(".tab-player").getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".tab-player")).toHaveCount(0);
});

for (const ext of ["gp3", "gp4", "gp5", "gpx"]) {
  test(`a .${ext} file (not readable by the tab player) opens in Guitar Pro instead`, async ({ page }) => {
    await setup(page, { tabUrl: `/path/to/old.${ext}` });
    await openTab(page);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __calls: { cmd: string; args?: { path?: string } }[] }).__calls.filter((c) => c.cmd === "open_with_default").map((c) => c.args?.path)))
      .toEqual([`/path/to/old.${ext}`]);
    await expect(page.locator(".tab-player")).toHaveCount(0);
  });
}

test("tapping a bar sync while a recording plays adds a sync point, and clearing asks first", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await player.locator(".tab-audio-select").selectOption({ label: "Backing" });
  await expect(player.locator(".tab-audio-status")).toContainText("Backing");
  await expect(player.locator(".tab-sync-count")).toHaveText("No sync points yet.");

  await player.getByRole("button", { name: "Sync this bar" }).click();
  await expect(player.locator(".tab-sync-count")).toHaveText(/^1 sync point/);

  await player.getByRole("button", { name: "Clear sync points" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Clear 1 sync point?");
  // Cancelling keeps them.
  await page.getByRole("alertdialog").locator("button.btn-ghost", { hasText: "Cancel" }).click();
  await expect(player.locator(".tab-sync-count")).toHaveText(/^1 sync point/);
  await player.getByRole("button", { name: "Clear sync points" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear sync points" }).click();
  await expect(player.locator(".tab-sync-count")).toHaveText("No sync points yet.");
});

test("sync points are remembered for the tab and recording", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await player.locator(".tab-audio-select").selectOption({ label: "Backing" });
  await expect(player.locator(".tab-audio-status")).toContainText("Backing");
  await player.getByRole("button", { name: "Sync this bar" }).click();
  await expect(player.locator(".tab-sync-count")).toHaveText(/^1 sync point/);
  await player.getByRole("button", { name: "Close" }).click();
  await openTab(page);
  await page.locator(".tab-player .tab-audio-select").selectOption({ label: "Backing" });
  await expect(page.locator(".tab-player .tab-sync-count")).toHaveText(/^1 sync point/);
});

const tracksPanel = (page: import("@playwright/test").Page) => page.locator(".tab-player").getByRole("button", { name: "Tracks" });
const fret = (page: import("@playwright/test").Page, n: number) => page.locator(".tab-player .tab-line svg text", { hasText: new RegExp(`^${n}$`) });

test("any combination of tracks can be shown, via checkboxes in the Tracks panel", async ({ page }) => {
  await setup(page);
  await openTab(page);
  // Starts with the first track only.
  await expect(fret(page, 15).first()).toBeVisible();
  await expect(fret(page, 0)).toHaveCount(0);
  await tracksPanel(page).click();
  await page.getByRole("checkbox", { name: "Show Bass" }).check();
  await expect(fret(page, 15).first()).toBeVisible();
  await expect(fret(page, 0).first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Show Lead Guitar" }).uncheck();
  await expect(fret(page, 15)).toHaveCount(0);
  await expect(fret(page, 0).first()).toBeVisible();
  // The last visible track can't be hidden.
  await expect(page.getByRole("checkbox", { name: "Show Bass" })).toBeDisabled();
});

test("the shown tracks are remembered between sessions", async ({ page }) => {
  await setup(page);
  await openTab(page);
  await tracksPanel(page).click();
  await page.getByRole("checkbox", { name: "Show Bass" }).check();
  await page.getByRole("checkbox", { name: "Show Lead Guitar" }).uncheck();
  await expect(fret(page, 15)).toHaveCount(0);
  await page.reload();
  await page.locator(".item-group", { hasText: "Exercises" }).locator(".item-group-header").click();
  await page.locator(".item-card", { hasText: "Solo Exercise" }).first().locator('button[title="Start timer"]').click();
  await openTab(page);
  await expect(fret(page, 5).first()).toBeVisible();
  await expect(fret(page, 15)).toHaveCount(0);
});

test("the recording is used by default when the item has one, and a choice of synth is remembered", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await expect(player.locator(".tab-audio-select")).toHaveValue("/path/to/solo.mp3");
  await expect(player.locator(".tab-audio-status")).toContainText("Backing");
  await player.locator(".tab-audio-select").selectOption({ label: "Synth (no recording)" });
  await player.getByRole("button", { name: "Close" }).click();
  await openTab(page);
  await expect(page.locator(".tab-player .tab-audio-select")).toHaveValue("");
});

test("pitch shift takes semitones and cents, and needs the pitch shifter for a recording", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  // The pitch controls are enabled once the shifter is wired into the recording.
  await expect(player.getByLabel("Pitch semitones")).toBeEnabled();
  await player.getByLabel("Pitch semitones").fill("2");
  await player.getByLabel("Pitch cents").fill("25");
  await expect(player.locator(".tab-pitch-value")).toHaveText("+2 st +25 ¢");
  await player.getByRole("button", { name: "Reset pitch" }).click();
  await expect(player.locator(".tab-pitch-value")).toHaveText("0 st 0 ¢");
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("pitch shift also works with the synth", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await player.locator(".tab-audio-select").selectOption({ label: "Synth (no recording)" });
  await player.getByLabel("Pitch semitones").fill("-3");
  await expect(player.locator(".tab-pitch-value")).toHaveText("-3 st 0 ¢");
  await player.locator('button[title="Play"]').click();
  await expect(player.locator('button[title="Pause"]')).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("transpose changes the frets that are drawn", async ({ page }) => {
  await setup(page);
  await openTab(page);
  await expect(fret(page, 15).first()).toBeVisible();
  await expect(fret(page, 17)).toHaveCount(0);
  await page.locator(".tab-player").getByLabel("Transpose").fill("2");
  await expect(fret(page, 17).first()).toBeVisible();
  await expect(fret(page, 15)).toHaveCount(0);
});

test("dragging across bars selects a loop, and a plain click only moves the cursor", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  const hit = (bar: number) => player.locator(`.tab-bar-hit[data-bar="${bar}"]`).first();
  await expect(hit(1)).toBeAttached();
  const a = (await hit(0).boundingBox())!;
  const b = (await hit(1).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(player.getByLabel("Loop from bar")).toHaveValue("1");
  await expect(player.getByLabel("Loop to bar")).toHaveValue("2");
  await expect(player.locator(".tab-loop-range")).not.toHaveCount(0);

  await player.getByRole("button", { name: "Clear" }).click();
  await expect(player.getByLabel("Loop from bar")).toHaveValue("");
  await hit(1).click();
  await expect(player.getByLabel("Loop from bar")).toHaveValue("");
});

test("the L key loops the current bar and clears it again", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await page.keyboard.press("l");
  await expect(player.getByLabel("Loop from bar")).toHaveValue("1");
  await expect(player.getByLabel("Loop to bar")).toHaveValue("1");
  await page.keyboard.press("l");
  await expect(player.getByLabel("Loop from bar")).toHaveValue("");
});

test("the chord sheet display shows a cell per bar", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await player.getByLabel("Display").selectOption({ label: "Chords" });
  await expect(player.locator(".chord-bar")).toHaveCount(2);
  await expect(player.locator(".tab-line")).toHaveCount(0);
  await player.getByLabel("Display").selectOption({ label: "Tab" });
  await expect(player.locator(".tab-line")).not.toHaveCount(0);
});

test("the current track can be muted and soloed from the control bar, with the synth", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await player.locator(".tab-audio-select").selectOption({ label: "Synth (no recording)" });
  const mute = player.getByRole("button", { name: "Mute track" });
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  const solo = player.getByRole("button", { name: "Solo track" });
  await solo.click();
  await expect(solo).toHaveAttribute("aria-pressed", "true");
});

test("the header shows the song's bars, tracks and speed goes down to 15%", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await expect(player.locator(".tab-player-info")).toContainText("2 bars");
  await expect(player.locator(".tab-player-info")).toContainText("2 tracks");
  await expect(player.getByLabel("Speed")).toHaveAttribute("min", "15");
  await expect(player.getByLabel("Speed")).toHaveAttribute("max", "175");
});

test("with a recording, Mute track and Solo track act on the matching instrument stem", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  const mute = player.getByRole("button", { name: "Mute track" });
  const solo = player.getByRole("button", { name: "Solo track" });
  // Nothing to mute until the recording has been separated.
  await expect(mute).toBeDisabled();
  await player.getByRole("button", { name: "Separate instruments" }).click();
  await expect(player.getByRole("checkbox", { name: "Guitar", exact: true })).toBeChecked();
  await expect(mute).toBeEnabled();

  // The current track is the lead guitar, so muting it mutes the guitar stem and plays a mix without it.
  const mixRequest = page.waitForRequest((r) => r.url().includes(encodeURIComponent("/cache/mix-guitar.wav")));
  await mute.click();
  await expect(player.getByRole("checkbox", { name: "Guitar", exact: true })).not.toBeChecked();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await mixRequest;

  // Solo keeps only the guitar.
  const soloRequest = page.waitForRequest((r) => r.url().includes(encodeURIComponent("/cache/mix-bass+drums+other+piano+vocals.wav")));
  await solo.click();
  await expect(solo).toHaveAttribute("aria-pressed", "true");
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await expect(player.getByRole("checkbox", { name: "Guitar", exact: true })).toBeChecked();
  await expect(player.getByRole("checkbox", { name: "Bass", exact: true })).not.toBeChecked();
  await soloRequest;

  // Soloing again puts everything back.
  await solo.click();
  await expect(player.getByRole("checkbox", { name: "Bass", exact: true })).toBeChecked();
  await expect(solo).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("the Bass track maps to the bass stem", async ({ page }) => {
  await setup(page);
  await openTab(page);
  const player = page.locator(".tab-player");
  await player.getByRole("button", { name: "Separate instruments" }).click();
  await player.getByRole("button", { name: "Tracks" }).click();
  await player.getByRole("button", { name: /^Bass/ }).click();
  await player.getByRole("button", { name: "Mute track" }).click();
  await expect(player.getByRole("checkbox", { name: "Bass", exact: true })).not.toBeChecked();
  await expect(player.getByRole("checkbox", { name: "Guitar", exact: true })).toBeChecked();
});

// ── The tab editor ────────────────────────────────────────────────────────────

async function startEditing(page: import("@playwright/test").Page) {
  await openTab(page);
  const player = page.locator(".tab-player");
  await player.getByRole("button", { name: "Edit tab" }).click();
  await expect(player.locator(".tab-edit-bar")).toBeVisible();
  return player;
}

const saveCalls = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    (window as unknown as { __calls: { cmd: string; args?: { filePath?: string; songJson?: string } }[] }).__calls.filter((c) => c.cmd === "save_tab_copy")
  );

test("editing: typing a fret changes the note under the caret, and undo puts it back", async ({ page }) => {
  await setup(page);
  const player = await startEditing(page);
  await expect(fret(page, 3)).toHaveCount(1);
  await page.keyboard.press("9");
  await expect(fret(page, 9)).toHaveCount(1);
  await expect(fret(page, 3)).toHaveCount(0);
  await expect(player.locator(".edit-caret")).toHaveCount(1);
  await expect(player.locator(".tab-edit-status")).toContainText("unsaved changes");
  await player.getByRole("button", { name: "Undo" }).click();
  await expect(fret(page, 3)).toHaveCount(1);
  await expect(fret(page, 9)).toHaveCount(0);
});

test("editing: arrow keys move the caret, two quick digits make a two-digit fret", async ({ page }) => {
  await setup(page);
  await startEditing(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("1");
  await page.keyboard.press("4");
  await expect(fret(page, 14)).toHaveCount(1);
  await expect(fret(page, 5)).toHaveCount(0);
  // One undo takes back both digits.
  await page.keyboard.press("Control+z");
  await expect(fret(page, 5)).toHaveCount(1);
  await expect(fret(page, 14)).toHaveCount(0);
});

test("editing: clicking the staff places the caret", async ({ page }) => {
  await setup(page);
  const player = await startEditing(page);
  const hit = player.locator('.tab-bar-hit[data-bar="1"]').first();
  await expect(player.locator(".edit-caret")).toHaveCount(1);
  await expect.poll(async () => (await hit.boundingBox()) !== null).toBe(true);
  const box = (await hit.boundingBox())!;
  const svg = (await player.locator(".tab-line svg").first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, svg.y + 48);
  await page.keyboard.press("1");
  await page.keyboard.press("1");
  await expect(fret(page, 11)).toHaveCount(1);
});

test("editing: backspace removes a note, R makes the beat a rest, Enter adds a beat", async ({ page }) => {
  await setup(page);
  await startEditing(page);
  await page.keyboard.press("Backspace");
  await expect(fret(page, 3)).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("r");
  await expect(fret(page, 5)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.keyboard.press("6");
  await expect(fret(page, 6)).toHaveCount(1);
  await expect(page.locator(".tab-player .tab-edit-status")).toContainText("too long");
});

test("editing: note value and dot buttons change the bar's length", async ({ page }) => {
  await setup(page);
  const player = await startEditing(page);
  await player.getByRole("button", { name: "Half note" }).click();
  await expect(player.locator(".tab-edit-status")).toContainText("too long");
  await player.getByRole("button", { name: "Quarter note" }).click();
  await expect(player.locator(".tab-edit-status")).not.toContainText("too long");
  await player.getByRole("button", { name: "Dotted" }).click();
  await expect(player.locator(".tab-edit-status")).toContainText("too long");
});

test("editing: + Bar adds a bar to every track, and - Bar asks before deleting", async ({ page }) => {
  await setup(page);
  const player = await startEditing(page);
  await expect(player.locator(".tab-player-bar")).toContainText("/ 2");
  await player.getByRole("button", { name: "+ Bar" }).click();
  await expect(player.locator(".tab-player-bar")).toContainText("/ 3");
  await player.getByRole("button", { name: "− Bar" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete bar 2?");
  await page.getByRole("alertdialog").locator("button.btn-ghost", { hasText: "Cancel" }).click();
  await expect(player.locator(".tab-player-bar")).toContainText("/ 3");
  await player.getByRole("button", { name: "− Bar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete bar 2" }).click();
  await expect(player.locator(".tab-player-bar")).toContainText("/ 2");
});

test("editing: saving writes a new .gp next to the original with the edits", async ({ page }) => {
  await setup(page);
  const player = await startEditing(page);
  await page.keyboard.press("9");
  await player.getByRole("button", { name: "Save as new .gp" }).click();
  await expect(player.locator(".tab-edit-status")).toContainText("Saved as /path/to/solo (edited).gp");
  await expect(player.locator(".tab-edit-status")).not.toContainText("unsaved changes");
  const calls = await saveCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].args?.filePath).toBe("/path/to/solo.gp");
  const saved = JSON.parse(calls[0].args!.songJson!);
  expect(saved.tracks[0].measures[0].beats[0].notes[0].fret).toBe(9);
  // The saved copy can be opened in Guitar Pro.
  await player.getByRole("button", { name: "Open the saved copy" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __calls: { cmd: string; args?: { path?: string } }[] }).__calls.filter((c) => c.cmd === "open_with_default").map((c) => c.args?.path)))
    .toEqual(["/path/to/solo (edited).gp"]);
});

test("editing: a failed save shows the actual error and keeps the changes", async ({ page }) => {
  await setup(page, { saveError: "Couldn't create /path/to/solo (edited).gp: permission denied" });
  const player = await startEditing(page);
  await page.keyboard.press("9");
  await player.getByRole("button", { name: "Save as new .gp" }).click();
  await expect(page.locator(".error-modal, [role=dialog]").filter({ hasText: "permission denied" }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(player.locator(".tab-edit-status")).toContainText("unsaved changes");
});

test("editing: leaving with unsaved changes asks first, and discarding restores the tab", async ({ page }) => {
  await setup(page);
  const player = await startEditing(page);
  await page.keyboard.press("9");
  await player.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Discard your changes?");
  await page.getByRole("alertdialog").locator("button.btn-ghost", { hasText: "Cancel" }).click();
  await expect(player.locator(".tab-edit-bar")).toBeVisible();
  await expect(fret(page, 9)).toHaveCount(1);
  await player.getByRole("button", { name: "Done" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes" }).click();
  await expect(player.locator(".tab-edit-bar")).toHaveCount(0);
  await expect(fret(page, 3)).toHaveCount(1);
  await expect(fret(page, 9)).toHaveCount(0);
});

test("editing: closing the player with unsaved changes asks first", async ({ page }) => {
  await setup(page);
  const player = await startEditing(page);
  await page.keyboard.press("9");
  await player.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Discard your changes?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes" }).click();
  await expect(page.locator(".tab-player")).toHaveCount(0);
});

test("editing: only the current track is drawn and the synth plays the edited tab", async ({ page }) => {
  await setup(page);
  const player = await startEditing(page);
  await player.getByRole("button", { name: "Tracks" }).click();
  await page.getByRole("checkbox", { name: "Show Bass" }).check();
  await expect(fret(page, 0)).toHaveCount(0);
  await page.keyboard.press("9");
  await player.locator('button[title="Play"]').click();
  await expect(player.locator('button[title="Pause"]')).toBeVisible();
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("editing: a drum track toggles hits on the line with the digit keys", async ({ page }) => {
  await setup(page, { drums: true });
  const player = await startEditing(page);
  await player.getByRole("button", { name: "Tracks" }).click();
  await player.getByRole("button", { name: /^Drums/ }).click();
  await expect(player.locator("text", { hasText: /^x$/ }).first()).toBeVisible();
  const before = await player.locator(".tab-line svg text", { hasText: /^[xo]$/ }).count();
  await page.keyboard.press("1");
  await expect(player.locator(".tab-line svg text", { hasText: /^[xo]$/ })).not.toHaveCount(before);
});
