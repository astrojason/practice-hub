import { test, expect, type Page } from "./base";

// Theory Training's Tools tab: chord identifier, scale identifier (from notes or a
// song's chords), circle of fifths and quartal chords.

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] }, exercises: [], study_materials: [], chord: null, progression: null, interval: null,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("ph:refreshToken", "fake-refresh-token"); });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
  await page.locator("button", { hasText: "Theory Training" }).first().click();
  await expect(page.locator(".fretboard-view")).toBeVisible();
});

async function openTool(page: Page, name: string) {
  await page.locator(".fb-tab", { hasText: "Tools" }).click();
  // Switching page asks to save the session only if one was started; none was here.
  await page.locator(".fb-tool-tab", { hasText: name }).click();
  await expect(page.locator(".fb-tool-tab.active")).toHaveText(name);
}

// ─── Pure theory functions ────────────────────────────────────────────────────

test("identifyChord names chords, inversions, shared note sets and a missing 5th", async ({ page }) => {
  const names = await page.evaluate(async () => {
    const m = await import("/src/lib/fretboard/identify.ts");
    const n = (midis: number[]) => m.identifyChord(midis).map((c: { name: string }) => c.name);
    return {
      openC: n([48, 52, 55, 60, 64]), // x32010
      cOverE: n([52, 55, 60]),
      am7: n([45, 52, 55, 60, 64]), // x02010
      c7no5: n([48, 52, 58]),
      single: n([48]),
    };
  });
  expect(names.openC[0]).toBe("C");
  expect(names.cOverE[0]).toBe("C/E");
  expect(names.am7.slice(0, 2)).toEqual(["Am7", "C6/A"]);
  expect(names.c7no5[0]).toBe("C7");
  expect(names.single).toEqual([]);
});

test("identifyScales ranks exact, common scales first and respects a chosen key", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/fretboard/identify.ts");
    const name = (x: { name: string }) => x.name;
    return {
      fromC: m.identifyScales([0, 2, 4, 5, 7, 9, 11], null).slice(0, 2).map(name),
      fromA: m.identifyScales([9, 11, 0, 2, 4, 5, 7], null)[0].name,
      inAMinor: m.identifyScales([9, 0, 4, 7], { root: 9, minor: true })[0].name,
      degrees: m.keyDegrees([9, 0, 1], { root: 9, minor: true }),
    };
  });
  expect(r.fromC).toEqual(["C Major (Ionian)", "A Natural Minor (Aeolian)"]);
  expect(r.fromA).toBe("A Natural Minor (Aeolian)");
  expect(r.inAMinor).toBe("A Natural Minor (Aeolian)");
  expect(r.degrees).toEqual([
    { pc: 9, label: "1", inKey: true },
    { pc: 0, label: "b3", inKey: true },
    { pc: 1, label: "3", inKey: false },
  ]);
});

test("parseChords reads common chord spellings and rejects unknown ones with the bad name", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/fretboard/identify.ts");
    const ok = m.parseChords("Am  F, C | G/B Bbmaj7 F#m7b5 C6/9 Dmin7");
    let err = "";
    try {
      m.parseChords("Am Xq7");
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    return { ok: ok.map((c: { root: number; bass: number; symbol: string }) => [c.root, c.symbol, c.bass]), err };
  });
  expect(r.ok).toEqual([
    [9, "m", 9], [5, "", 5], [0, "", 0], [7, "", 11], [10, "maj7", 10], [6, "m7b5", 6], [0, "6/9", 0], [2, "m7", 2],
  ]);
  expect(r.err).toContain("Xq7");
});

test("circle of fifths: key signatures, modes, borrowed chords and secondary dominants", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/fretboard/circle.ts");
    const g = m.modeKey(7, "Ionian", false);
    const dDorian = m.modeKey(2, "Dorian", false);
    return {
      gSig: m.keySignature(7),
      fSig: m.keySignature(5),
      gChords: g.chords.map((c: { name: string }) => c.name),
      dDorianParent: dDorian.parent,
      dDorianSig: m.keySignature(dDorian.parent).text,
      borrowed: m.borrowedChords(0, "Ionian").map((c: { name: string; roman: string }) => `${c.name} ${c.roman}`),
      secondary: m.secondaryDominants(0, "Ionian").map((c: { name: string; roman: string }) => `${c.name} ${c.roman}`),
    };
  });
  expect(r.gSig).toEqual({ count: 1, kind: "sharps", notes: ["F#"], text: "1 sharp" });
  expect(r.fSig).toEqual({ count: 1, kind: "flats", notes: ["Bb"], text: "1 flat" });
  expect(r.gChords).toEqual(["G", "Am", "Bm", "C", "D", "Em", "F#dim"]);
  expect(r.dDorianParent).toBe(0);
  expect(r.dDorianSig).toBe("no sharps or flats");
  expect(r.borrowed).toEqual(["Fm iv", "Eb bIII", "Ab bVI", "Bb bVII"]);
  expect(r.secondary).toEqual(["A7 V7/ii", "B7 V7/iii", "C7 V7/IV", "D7 V7/V", "E7 V7/vi"]);
});

test("quartal stacks drift by the size of each 4th", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/fretboard/quartal.ts");
    return {
      perfect: m.quartalStack(0, 5, 500).map((n: { name: string; off: number }) => `${n.name}${n.off}`),
      small: m.quartalStack(0, 5, 490).map((n: { off: number }) => n.off),
      fifths: m.quartalStack(0, 4, 700).map((n: { name: string }) => n.name),
    };
  });
  expect(r.perfect).toEqual(["C0", "F0", "Bb0", "Eb0", "Ab0"]);
  expect(r.small).toEqual([0, -10, -20, -30, -40]);
  expect(r.fifths).toEqual(["C", "G", "D", "A"]);
});

// ─── The Tools tab ────────────────────────────────────────────────────────────

test("chord identifier: tap a shape on the neck, read its name, try a similar chord and go back", async ({ page }) => {
  await openTool(page, "Chord identifier");
  const spot = (s: number, f: number) => page.locator(`.fb-tools .fb-note[data-string="${s}"][data-fret="${f}"]`);
  // x32010, lowest string is string 0.
  for (const [s, f] of [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]) await spot(s, f).click();
  await expect(page.locator(".fb-id-result__name").first()).toHaveText("C");
  await expect(page.locator(".fb-id-shape")).toHaveText("x32010");
  // Tapping a picked spot again mutes that string.
  await spot(5, 0).click();
  await expect(page.locator(".fb-id-shape")).toHaveText("x3201x");
  await spot(5, 0).click();
  // A similar chord replaces the shape; Back returns to yours.
  await page.locator(".fb-similar-chip", { hasText: "Cmaj7" }).click();
  await expect(page.locator(".fb-id-result__name").first()).toHaveText("Cmaj7");
  await page.locator("button", { hasText: "Back to my chord" }).click();
  await expect(page.locator(".fb-id-shape")).toHaveText("x32010");
  await page.locator(".fb-tools button", { hasText: /^Strum$/ }).click();
  await page.locator(".fb-tools button", { hasText: /^Clear$/ }).click();
  await expect(page.locator(".fb-id-shape")).toHaveText("xxxxxx");
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("scale identifier: pick notes, choose a key, and see notes outside it", async ({ page }) => {
  await openTool(page, "Scale identifier");
  for (const n of ["C", "D", "E", "F", "G", "A", "B"]) await page.locator(".fb-pc-chip", { hasText: new RegExp(`^${n}$`) }).click();
  await expect(page.locator(".fb-scale-result").first()).toContainText("C Major (Ionian)");
  // Every place a picked note sits lights up on the neck.
  expect(await page.locator('.fb-tools .fb-note[data-in-position="true"]').count()).toBeGreaterThan(30);
  await page.locator('select[aria-label="Song key"]').selectOption({ label: "A minor" });
  await expect(page.locator(".fb-scale-result").first()).toContainText("A Natural Minor (Aeolian)");
  await page.locator(".fb-pc-chip", { hasText: /^C#\/Db$/ }).click();
  await expect(page.locator(".fb-key-degree--out")).toContainText("C#/Db");
});

test("scale identifier: type a song's chords and get the scale that fits; a bad chord shows the error", async ({ page }) => {
  await openTool(page, "Scale identifier");
  await page.locator('input[aria-label="Song chords"]').fill("Am F C G");
  await page.locator("button", { hasText: "Find the scale" }).click();
  await expect(page.locator(".fb-scale-result").first()).toContainText("A Natural Minor (Aeolian)");
  await page.locator('input[aria-label="Song chords"]').fill("Am Qz9");
  await page.locator("button", { hasText: "Find the scale" }).click();
  await expect(page.locator(".error-modal")).toContainText("Qz9");
});

test("circle of fifths: tap a key, read its signature and chords, switch mode and play", async ({ page }) => {
  await openTool(page, "Circle of fifths");
  await page.locator('.fb-circle5__major[data-pc="7"]').click();
  await expect(page.locator(".fb-circle5-info")).toContainText("G major");
  await expect(page.locator(".fb-circle5-info")).toContainText("1 sharp");
  await expect(page.locator(".fb-circle5-info")).toContainText("E minor");
  await expect(page.locator(".fb-circle5-diatonic .fb-chord-chip")).toHaveText([/^G/, /^Am/, /^Bm/, /^C/, /^D/, /^Em/, /^F#dim/]);
  await page.locator(".fb-mode-btn", { hasText: "Dorian" }).click();
  await expect(page.locator(".fb-circle5-info")).toContainText("G Dorian");
  await expect(page.locator(".fb-circle5-info")).toContainText("1 flat");
  await page.locator(".fb-mode-btn", { hasText: "Ionian" }).click();
  await page.locator('.fb-circle5__major[data-pc="0"]').click();
  await expect(page.locator(".fb-circle5-borrowed")).toContainText("Fm");
  await expect(page.locator(".fb-circle5-secondary")).toContainText("V7/ii");
  await page.locator(".fb-circle5-diatonic .fb-chord-chip").first().click();
  await page.locator("button", { hasText: /^Play I–IV–V–I$/ }).click();
  await page.locator("button", { hasText: /^Play scale$/ }).click();
  await page.waitForTimeout(200);
  await expect(page.locator(".error-modal")).toHaveCount(0);
});

test("quartal chords: stack 4ths, shrink them and hear the drift, then go back to perfect", async ({ page }) => {
  await openTool(page, "Quartal chords");
  await expect(page.locator(".fb-quartal-note")).toHaveText([/C/, /F/, /Bb/, /Eb/, /Ab/]);
  await page.locator('input[aria-label="Size of each interval (cents)"]').fill("490");
  await expect(page.locator(".fb-quartal-note").last()).toContainText("-40¢");
  await page.locator("button", { hasText: "Back to perfect" }).click();
  await expect(page.locator(".fb-quartal-note").last()).not.toContainText("¢");
  await page.locator(".fb-tools button", { hasText: "Play the stack" }).click();
  await page.waitForTimeout(200);
  await expect(page.locator(".error-modal")).toHaveCount(0);
});
