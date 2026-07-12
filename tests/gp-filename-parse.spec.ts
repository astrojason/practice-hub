import { test, expect } from "@playwright/test";

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// These tests exercise `parseFilename`, the pure function in useGpScanner.ts
// that turns a GP filename into { artist, title, date, date_ms } (or null if
// it doesn't match the naming convention). Called directly via a dynamic
// import of the source module, same pattern as gp-audio-clock.spec.ts — no
// React rendering, no Tauri mocking needed.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function parse(page: import("@playwright/test").Page, filename: string) {
  return page.evaluate(async (filename) => {
    const mod = await import("/src/hooks/useGpScanner.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod as any).parseFilename(filename);
  }, filename);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("parses the canonical Artist-Title-MM-DD-YYYY.gp naming convention", async ({ page }) => {
  const result = await parse(page, "Metallica-One-07-12-2026.gp");
  expect(result).toEqual({
    artist: "Metallica",
    title: "One",
    date: "07-12-2026",
    date_ms: new Date("2026-07-12").getTime(),
  });
});

test("ignores backup copies with a trailing ISO -YYYY-MM-DD suffix", async ({ page }) => {
  // A separate script the user runs copies the latest dated version to a
  // non-dated "latest" alias; that copy process can leave ISO-suffixed
  // backup files behind (Artist-Title-YYYY-MM-DD.gp) which are not the
  // canonical MM-DD-YYYY working files and must not be scanned/matched.
  const result = await parse(page, "Metallica-One-2026-07-12.gp");
  expect(result).toBeNull();
});

test("still ignores non-dated alias files (no date suffix at all)", async ({ page }) => {
  const result = await parse(page, "Metallica-One.gp");
  expect(result).toBeNull();
});
