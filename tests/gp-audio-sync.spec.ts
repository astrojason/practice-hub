import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "gp-score-fixture.gp");

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// Exercises gpScore.ts's audio sync point support: MasterBar.syncPoints
// (added in Guitar Pro when a real backing track is attached and calibrated
// against it — e.g. tabs downloaded from Songsterr) let the cursor track a
// real recording's actual timing instead of assuming it was performed
// exactly on the notated tempo map. buildAudioSyncPoints reads that data;
// audioMsToTabMs is the pure interpolation used to apply it.

test.beforeEach(async ({ page }) => {
  const fixtureBytes = readFileSync(FIXTURE_PATH);
  await page.route("**/127.0.0.1:17865/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/octet-stream", body: fixtureBytes })
  );
  await page.goto("/");
});

// ─── audioMsToTabMs: pure interpolation ────────────────────────────────────────

test("a single sync point applies a constant offset", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const points = [{ audioMs: 1000, tabMs: 1200 }];
    return {
      atPoint: gpScore.audioMsToTabMs(points, 1000),
      before: gpScore.audioMsToTabMs(points, 500),
      after: gpScore.audioMsToTabMs(points, 2000),
    };
  });
  expect(result.atPoint).toBeCloseTo(1200, 5);
  expect(result.before).toBeCloseTo(700, 5); // 500 - 1000 + 1200
  expect(result.after).toBeCloseTo(2200, 5); // 2000 - 1000 + 1200
});

test("interpolates linearly between two bracketing sync points", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const points = [
      { audioMs: 0, tabMs: 0 },
      { audioMs: 1000, tabMs: 1100 }, // real audio runs 10% slower than the tab's notated tempo
    ];
    return {
      atStart: gpScore.audioMsToTabMs(points, 0),
      midway: gpScore.audioMsToTabMs(points, 500),
      atEnd: gpScore.audioMsToTabMs(points, 1000),
    };
  });
  expect(result.atStart).toBeCloseTo(0, 5);
  expect(result.midway).toBeCloseTo(550, 5);
  expect(result.atEnd).toBeCloseTo(1100, 5);
});

test("picks the correct bracketing segment among several sync points", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const points = [
      { audioMs: 0, tabMs: 0 },
      { audioMs: 1000, tabMs: 1000 },
      { audioMs: 2000, tabMs: 2500 }, // tempo shifts partway through
      { audioMs: 3000, tabMs: 3500 },
    ];
    return {
      inFirstSegment: gpScore.audioMsToTabMs(points, 500),
      inSecondSegment: gpScore.audioMsToTabMs(points, 1500),
      inThirdSegment: gpScore.audioMsToTabMs(points, 2500),
    };
  });
  expect(result.inFirstSegment).toBeCloseTo(500, 5);
  expect(result.inSecondSegment).toBeCloseTo(1750, 5);
  expect(result.inThirdSegment).toBeCloseTo(3000, 5);
});

test("extrapolates before the first and after the last sync point using the nearest segment's slope", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const points = [
      { audioMs: 1000, tabMs: 1000 },
      { audioMs: 2000, tabMs: 1900 }, // audio runs 10% faster than notated tempo here
    ];
    return {
      beforeFirst: gpScore.audioMsToTabMs(points, 500),
      afterLast: gpScore.audioMsToTabMs(points, 2500),
    };
  });
  // Extrapolating the 0.9 slope backward from (1000, 1000): 1000 + (500-1000)*0.9 = 550
  expect(result.beforeFirst).toBeCloseTo(550, 5);
  // Extrapolating forward from (2000, 1900): 1900 + (2500-2000)*0.9 = 2350
  expect(result.afterLast).toBeCloseTo(2350, 5);
});

// ─── buildAudioSyncPoints: reading MasterBar.syncPoints from a real score ──────

test("returns null when the score has no sync points", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const score = await gpScore.loadScoreFromFile("/Songs/whatever.gp");
    return gpScore.buildAudioSyncPoints(score);
  });
  expect(result).toBeNull();
});

test("reads sync points from MasterBar.syncPoints and pairs them with the tab's own tempo-map time", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const alphaTab = gpScore.alphaTab;
    const score = await gpScore.loadScoreFromFile("/Songs/whatever.gp");

    // Simulate a Guitar Pro file with sync points calibrated against a real
    // backing track: one at the very start of bar 0, one partway into bar 1.
    const bar0 = score.masterBars[0];
    const sync0 = new alphaTab.model.Automation();
    sync0.type = alphaTab.model.AutomationType.SyncPoint;
    sync0.ratioPosition = 0;
    sync0.syncPointValue = new alphaTab.model.SyncPointData();
    sync0.syncPointValue.millisecondOffset = 250; // e.g. a 250ms lead-in before the audio's first note
    bar0.syncPoints = [sync0];

    const bar1 = score.masterBars[1];
    const sync1 = new alphaTab.model.Automation();
    sync1.type = alphaTab.model.AutomationType.SyncPoint;
    sync1.ratioPosition = 0.5;
    sync1.syncPointValue = new alphaTab.model.SyncPointData();
    sync1.syncPointValue.millisecondOffset = 2100;
    bar1.syncPoints = [sync1];

    const timing = gpScore.buildBeatTiming(score);
    const points = gpScore.buildAudioSyncPoints(score);
    return { points, beatCount: timing.size };
  });

  expect(result.points).not.toBeNull();
  const points = result.points!;
  expect(points).toHaveLength(2);
  // Sorted by audioMs ascending.
  expect(points[0].audioMs).toBe(250);
  expect(points[1].audioMs).toBe(2100);
  // The second point's tabMs must be strictly after the first's (bar 1's
  // midpoint is later in the tab timeline than bar 0's start).
  expect(points[1].tabMs).toBeGreaterThan(points[0].tabMs);
});
