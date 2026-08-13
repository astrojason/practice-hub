import { test, expect } from "@playwright/test";

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// Phase 2 of the custom tab renderer (see plan: roll our own GP tab renderer).
// `src/lib/tabLayout.ts` is a pure layout engine: Score + beat timing (from
// gpScore.buildBeatTiming) -> renderable geometry. No DOM/Canvas — tested via
// dynamic import + page.evaluate, same pattern as gp-audio-clock.spec.ts and
// gp-score.spec.ts.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function layoutFromTex(
  page: import("@playwright/test").Page,
  tex: string,
  options?: { notationTranspositionSemitones?: number },
) {
  return page.evaluate(async ({ tex, options }) => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const tabLayout = await import("/src/lib/tabLayout.ts");
    const score = gpScore.alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    const timing = gpScore.buildBeatTiming(score);
    const layout = tabLayout.buildTrackLayout(score, 0, timing, { ...tabLayout.defaultLayoutOptions, ...options });
    // Strip non-serializable alphaTab object references for the trip back to Node.
    return {
      totalWidth: layout.totalWidth,
      stringCount: layout.stringCount,
      bars: layout.bars.map((bar) => ({
        index: bar.index,
        xStart: bar.xStart,
        xEnd: bar.xEnd,
        keySignature: bar.keySignature,
        beats: bar.beats.map((b) => ({
          x: b.x,
          startMs: b.startMs,
          durationMs: b.durationMs,
          isRest: b.isRest,
          duration: b.duration,
          stemUp: b.stemUp,
          beamGroupId: b.beamGroupId,
          notes: b.notes.map((n) => ({
            notationStep: n.notationStep,
            accidental: n.accidental,
            string: n.string,
            tabLineFromTop: n.tabLineFromTop,
            fret: n.fret,
          })),
        })),
      })),
    };
  }, { tex, options });
}

// ─── Time-proportional x positions ─────────────────────────────────────────────

test("beat x positions are time-proportional (pixelsPerMs * startMs)", async ({ page }) => {
  const layout = await layoutFromTex(page, "\\tempo 120 . 1.1 1.1 1.1 1.1 |");
  const beats = layout.bars[0].beats;
  const pixelsPerMs = 0.12; // defaultLayoutOptions.pixelsPerMs

  expect(beats[0].x).toBeCloseTo(0, 3);
  expect(beats[1].x).toBeCloseTo(500 * pixelsPerMs, 3); // 500ms in at 120bpm
  expect(beats[2].x).toBeCloseTo(1000 * pixelsPerMs, 3);
  expect(beats[3].x).toBeCloseTo(1500 * pixelsPerMs, 3);
  // x is strictly increasing
  for (let i = 1; i < beats.length; i++) expect(beats[i].x).toBeGreaterThan(beats[i - 1].x);
});

test("a second bar starts after the first bar's content plus the bar gap", async ({ page }) => {
  const layout = await layoutFromTex(page, "\\tempo 120 . 1.1 1.1 1.1 1.1 | 1.1 1.1 1.1 1.1 |");
  expect(layout.bars).toHaveLength(2);
  expect(layout.bars[1].xStart).toBeGreaterThan(layout.bars[0].beats[3].x);
  expect(layout.totalWidth).toBeGreaterThan(layout.bars[1].xStart);
});

test("a later bar's own beats never land to the left of that bar's xStart (regression: gap offset must propagate into beat.x)", async ({ page }) => {
  // Three bars so any per-bar drift (a bug here previously accumulated the
  // gap into bar.xStart/xEnd bookkeeping but not into beat.x itself) would
  // compound and become obviously wrong by the third bar.
  const layout = await layoutFromTex(
    page,
    "\\tempo 120 . 1.1 1.1 1.1 1.1 | 1.1 1.1 1.1 1.1 | 1.1 1.1 1.1 1.1 |",
  );
  expect(layout.bars).toHaveLength(3);
  for (const bar of layout.bars) {
    for (const beat of bar.beats) {
      expect(beat.x).toBeGreaterThanOrEqual(bar.xStart);
    }
  }
});

// ─── Notation staff pitch mapping (treble clef, no key signature) ─────────────

test("natural notes land on the expected diatonic staff steps in treble clef", async ({ page }) => {
  // realValue 64=E4 (bottom line, step 0), 67=G4 (step 2), 71=B4 (step 4, middle line), 76=E5 (step 7)
  const layout = await layoutFromTex(page, "\\tuning E4 B3 G3 D3 A2 E2 . 0.1 3.1 7.1 12.1 |");
  const notes = layout.bars[0].beats.map((b) => b.notes[0]);
  expect(notes[0].notationStep).toBe(0); // E4
  expect(notes[1].notationStep).toBe(2); // G4
  expect(notes[2].notationStep).toBe(4); // B4
  expect(notes[3].notationStep).toBe(7); // E5
  for (const n of notes) expect(n.accidental).toBeNull();
});

test("a middle-C ledger-line note lands two steps below the treble staff", async ({ page }) => {
  const layout = await layoutFromTex(page, "\\tuning C4 . 0.1 |");
  expect(layout.bars[0].beats[0].notes[0].notationStep).toBe(-2);
});

test("out-of-key chromatic notes get a sharp in a sharp/natural key signature", async ({ page }) => {
  // C#4 (realValue 61) with no key signature (0 sharps/flats) -> sharp table
  const layout = await layoutFromTex(page, "\\tuning C4 . 1.1 |");
  const note = layout.bars[0].beats[0].notes[0];
  expect(note.accidental).toBe("sharp");
  expect(note.notationStep).toBe(-2); // same staff line as C, sharp is drawn as a modifier
});

test("out-of-key chromatic notes get a flat in a flat key signature", async ({ page }) => {
  // \key F is 1 flat (Bb) -> negative key signature -> flat spelling table
  const layout = await layoutFromTex(page, "\\tuning C4 \\ks F . 1.1 |");
  const note = layout.bars[0].beats[0].notes[0];
  expect(layout.bars[0].keySignature).toBeLessThan(0);
  expect(note.accidental).toBe("flat");
});

// ─── Tab staff string/fret mapping ─────────────────────────────────────────────

test("tab line position counts from the top, matching the highest-pitched string first", async ({ page }) => {
  // alphaTex's fret.string syntax numbers strings the opposite way from
  // alphaTab's internal Note.string: tex string "6" (the thickest/lowest
  // string as printed on paper tab) parses to internal string=1 (alphaTab's
  // "1 is the lowest string" convention); tex "1" (thinnest/highest string)
  // parses to internal string=6. Internal string 1 (lowest pitch) belongs on
  // the bottom tab line; internal string 6 (highest pitch) on the top line.
  const layout = await layoutFromTex(page, ". 0.6 0.1 |");
  const notes = layout.bars[0].beats.map((b) => b.notes[0]);
  expect(layout.stringCount).toBe(6);
  expect(notes[0].string).toBe(1);
  expect(notes[0].tabLineFromTop).toBe(5);
  expect(notes[1].string).toBe(6);
  expect(notes[1].tabLineFromTop).toBe(0);
});

test("fret numbers pass through unchanged", async ({ page }) => {
  const layout = await layoutFromTex(page, ". 5.1 12.1 0.1 |");
  const frets = layout.bars[0].beats.map((b) => b.notes[0].fret);
  expect(frets).toEqual([5, 12, 0]);
});

// ─── Rests ──────────────────────────────────────────────────────────────────────

test("a rest beat has isRest true and no notes", async ({ page }) => {
  const layout = await layoutFromTex(page, ". 1.1 r r 1.1 |");
  const beats = layout.bars[0].beats;
  expect(beats[1].isRest).toBe(true);
  expect(beats[1].notes).toHaveLength(0);
  expect(beats[2].isRest).toBe(true);
  expect(beats[0].isRest).toBe(false);
});

// ─── Beaming ────────────────────────────────────────────────────────────────────

test("consecutive eighth notes are grouped into a single beam", async ({ page }) => {
  const layout = await layoutFromTex(page, ". 1.1.8 1.1.8 1.1.8 1.1.8 |");
  const beats = layout.bars[0].beats;
  const ids = beats.map((b) => b.beamGroupId);
  expect(ids[0]).not.toBeNull();
  expect(ids[0]).toBe(ids[1]);
  expect(ids[1]).toBe(ids[2]);
  expect(ids[2]).toBe(ids[3]);
});

test("a beam breaks at a quarter note and a rest, and a lone eighth note gets no beam", async ({ page }) => {
  const layout = await layoutFromTex(page, ". 1.1.8 1.1.8 1.1.4 1.1.8 r 1.1.8 1.1.8 |");
  const beats = layout.bars[0].beats;
  // beats: [8th,8th] beamed together, [quarter] alone, [8th] alone (no beamable neighbor -> null),
  // [rest], [8th,8th] beamed together
  expect(beats[0].beamGroupId).not.toBeNull();
  expect(beats[0].beamGroupId).toBe(beats[1].beamGroupId);
  expect(beats[2].beamGroupId).toBeNull(); // quarter note, not beamable at all
  expect(beats[3].beamGroupId).toBeNull(); // lone eighth, no adjacent beamable beat
  expect(beats[4].beamGroupId).toBeNull(); // rest
  expect(beats[5].beamGroupId).not.toBeNull();
  expect(beats[5].beamGroupId).toBe(beats[6].beamGroupId);
  expect(beats[5].beamGroupId).not.toBe(beats[0].beamGroupId);
});

// ─── timeToX (the deterministic cursor mapping) ────────────────────────────────

async function timeToXSamples(page: import("@playwright/test").Page, tex: string, times: number[]) {
  return page.evaluate(async ({ tex, times }) => {
    const gpScore = await import("/src/lib/gpScore.ts");
    const tabLayout = await import("/src/lib/tabLayout.ts");
    const score = gpScore.alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    const timing = gpScore.buildBeatTiming(score);
    const layout = tabLayout.buildTrackLayout(score, 0, timing);
    return times.map((t) => tabLayout.timeToX(layout, t));
  }, { tex, times });
}

test("timeToX matches each beat's own x at that beat's startMs, across bar boundaries", async ({ page }) => {
  const tex = "\\tempo 120 . 1.1 1.1 1.1 1.1 | 1.1 1.1 1.1 1.1 | 1.1 1.1 1.1 1.1 |";
  const layout = await layoutFromTex(page, tex);
  const allBeats = layout.bars.flatMap((b) => b.beats);
  const startTimes = allBeats.map((b) => b.startMs);
  const xs = await timeToXSamples(page, tex, startTimes);
  for (let i = 0; i < allBeats.length; i++) {
    expect(xs[i]).toBeCloseTo(allBeats[i].x, 5);
  }
});

test("timeToX is monotonically non-decreasing as time advances, including across bar lines", async ({ page }) => {
  const tex = "\\tempo 140 . 1.1.8 1.1.8 1.1.8 1.1.8 1.1.8 1.1.8 1.1.8 1.1.8 | 1.1.8 1.1.8 1.1.8 1.1.8 1.1.8 1.1.8 1.1.8 1.1.8 |";
  const samples: number[] = [];
  for (let ms = 0; ms <= 3000; ms += 17) samples.push(ms); // ~60fps steps
  const xs = await timeToXSamples(page, tex, samples);
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
  }
});

// ─── Phase 5: notation-only tab transposition ──────────────────────────────────

test("notationTranspositionSemitones shifts the notation staff pitch but leaves fret/string untouched", async ({ page }) => {
  // E4 (realValue 64) at fret 0 string tex"1" (internal string 6, open high e).
  const untransposed = await layoutFromTex(page, "\\tuning E4 B3 G3 D3 A2 E2 . 0.1 |");
  const transposedUp2 = await layoutFromTex(page, "\\tuning E4 B3 G3 D3 A2 E2 . 0.1 |", { notationTranspositionSemitones: 2 });

  const noteBefore = untransposed.bars[0].beats[0].notes[0];
  const noteAfter = transposedUp2.bars[0].beats[0].notes[0];

  // Fret/string are physical playing instructions — must not change.
  expect(noteAfter.fret).toBe(noteBefore.fret);
  expect(noteAfter.string).toBe(noteBefore.string);
  expect(noteAfter.tabLineFromTop).toBe(noteBefore.tabLineFromTop);

  // E4 + 2 semitones = F#4 -> same staff line as F (step1, a space above E)
  // with a sharp, since realValue 66 falls on the sharp-spelling table's F# entry.
  expect(noteBefore.notationStep).toBe(0);
  expect(noteBefore.accidental).toBeNull();
  expect(noteAfter.notationStep).toBe(1);
  expect(noteAfter.accidental).toBe("sharp");
});

test("transposition of 0 semitones is a no-op", async ({ page }) => {
  const a = await layoutFromTex(page, "\\tuning C4 . 0.1 3.1 |");
  const b = await layoutFromTex(page, "\\tuning C4 . 0.1 3.1 |", { notationTranspositionSemitones: 0 });
  expect(b.bars[0].beats.map((x) => x.notes[0].notationStep)).toEqual(
    a.bars[0].beats.map((x) => x.notes[0].notationStep),
  );
});
