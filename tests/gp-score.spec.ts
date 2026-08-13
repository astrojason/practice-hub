import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// Phase 1 of the custom tab renderer (see plan: roll our own GP tab renderer).
// `src/lib/gpScore.ts` wraps alphaTab purely as a file-format parser and a
// tick->ms timing calculator (via a hand-rolled tempo-automation-aware
// integrator) — no alphaTab renderer, player, or worker is involved.
//
// `tests/fixtures/gp-score-fixture.gp` is a real, binary GP7 file generated
// from a known alphaTex source (see the fixture's provenance below) via
// alphaTab's own Gp7Exporter, so `loadScoreFromFile`'s happy path exercises
// genuine binary GP parsing, not a stub.
//
// Fixture provenance (alphaTex source used to generate the fixture):
//   \title "Test Song" \artist "TestArtist" \tempo 120 \track "Guitar"
//   . 3.3 4.3 5.3 6.3 | \tempo 90 1.1 2.1 3.1 4.1 |
//
// Expected timing (division = 960 ticks/quarter, hand-computed independently
// of the implementation):
//   bar 0 @ 120bpm (500ms/quarter): beats at 0, 500, 1000, 1500ms
//   bar 1 @ 90bpm (666.667ms/quarter), starting at bar0's end (2000ms):
//     beats at 2000, 2666.667, 3333.333, 4000ms

const FIXTURE_PATH = join(__dirname, "fixtures", "gp-score-fixture.gp");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

// ─── loadScoreFromFile (fetch + parse real binary bytes) ──────────────────────

test("loadScoreFromFile parses a real GP file's metadata", async ({ page }) => {
  const bytes = readFileSync(FIXTURE_PATH);
  await page.route("**/127.0.0.1:17865/asset**", (route) =>
    route.fulfill({ status: 200, contentType: "application/octet-stream", body: bytes })
  );

  const result = await page.evaluate(async () => {
    const mod = await import("/src/lib/gpScore.ts");
    const score = await mod.loadScoreFromFile("/Songs/whatever.gp");
    return {
      title: score.title,
      artist: score.artist,
      tempo: score.tempo,
      trackNames: score.tracks.map((t: { name: string }) => t.name),
    };
  });

  expect(result.title).toBe("Test Song");
  expect(result.artist).toBe("TestArtist");
  expect(result.tempo).toBe(120);
  expect(result.trackNames).toEqual(["Guitar"]);
});

test("loadScoreFromFile surfaces a descriptive error when the file can't be fetched", async ({ page }) => {
  await page.route("**/127.0.0.1:17865/asset**", (route) =>
    route.fulfill({ status: 404, body: "not found" })
  );

  const errorMessage = await page.evaluate(async () => {
    const mod = await import("/src/lib/gpScore.ts");
    try {
      await mod.loadScoreFromFile("/Songs/missing.gp");
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  });

  expect(errorMessage).not.toBeNull();
  expect(errorMessage).toMatch(/404/);
});

test("loadScoreFromFile surfaces a descriptive error for unparseable bytes", async ({ page }) => {
  await page.route("**/127.0.0.1:17865/asset**", (route) =>
    route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from("not a gp file") })
  );

  const errorMessage = await page.evaluate(async () => {
    const mod = await import("/src/lib/gpScore.ts");
    try {
      await mod.loadScoreFromFile("/Songs/corrupt.gp");
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  });

  expect(errorMessage).not.toBeNull();
  expect(errorMessage!.length).toBeGreaterThan(0);
});

// ─── buildBeatTiming (pure tick->ms integrator, tempo-automation aware) ────────

test("buildBeatTiming computes correct start times across a mid-song tempo change", async ({ page }) => {
  const timings = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");

    const tex =
      '\\title "Test Song" \\tempo 120 . 3.3 4.3 5.3 6.3 | \\tempo 90 1.1 2.1 3.1 4.1 |';
    const score = gpScore.alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    const timing = gpScore.buildBeatTiming(score);

    const track = score.tracks[0];
    const beats = track.staves[0].bars.flatMap((bar: any) =>
      bar.voices.flatMap((voice: any) => voice.beats)
    );
    return beats.map((b: any) => timing.get(b.id));
  });

  expect(timings).toHaveLength(8);
  const [b0, b1, b2, b3, b4, b5, b6, b7] = timings as { startMs: number; durationMs: number }[];

  expect(b0.startMs).toBeCloseTo(0, 1);
  expect(b1.startMs).toBeCloseTo(500, 1);
  expect(b2.startMs).toBeCloseTo(1000, 1);
  expect(b3.startMs).toBeCloseTo(1500, 1);
  expect(b0.durationMs).toBeCloseTo(500, 1);

  // Bar 1 starts right where bar 0 ends (2000ms), then advances at the new
  // 90bpm tempo (666.667ms per quarter note).
  expect(b4.startMs).toBeCloseTo(2000, 1);
  expect(b5.startMs).toBeCloseTo(2666.667, 1);
  expect(b6.startMs).toBeCloseTo(3333.333, 1);
  expect(b7.startMs).toBeCloseTo(4000, 1);
  expect(b4.durationMs).toBeCloseTo(666.667, 1);
});

test("buildBeatTiming handles a constant-tempo score with no automations beyond the first", async ({ page }) => {
  const timings = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");

    const tex = "\\tempo 100 . 1.1 1.1 1.1 1.1 |";
    const score = gpScore.alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    const timing = gpScore.buildBeatTiming(score);

    const track = score.tracks[0];
    const beats = track.staves[0].bars.flatMap((bar: any) =>
      bar.voices.flatMap((voice: any) => voice.beats)
    );
    return beats.map((b: any) => timing.get(b.id));
  });

  const [b0, b1, b2, b3] = timings as { startMs: number; durationMs: number }[];
  // 100bpm -> 600ms per quarter note
  expect(b0.startMs).toBeCloseTo(0, 1);
  expect(b1.startMs).toBeCloseTo(600, 1);
  expect(b2.startMs).toBeCloseTo(1200, 1);
  expect(b3.startMs).toBeCloseTo(1800, 1);
});
