import { test, expect } from "@playwright/test";

// Phase 3 of the custom tab renderer: pure pixel-geometry helpers used by
// TabCanvas.tsx, kept separate and testable so pixel math has a spec
// independent of actual canvas drawing (which we only smoke-test).

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function metrics(page: import("@playwright/test").Page, stringCount: number) {
  return page.evaluate(async (stringCount) => {
    const geo = await import("/src/components/tab/tabGeometry.ts");
    const m = geo.computeStaffMetrics(stringCount);
    return {
      m,
      notationY0: geo.notationY(0, m),
      notationY8: geo.notationY(8, m),
      notationYNeg2: geo.notationY(-2, m),
      tabY0: geo.tabY(0, m),
      tabYLast: geo.tabY(stringCount - 1, m),
    };
  }, stringCount);
}

test("notation step 0 lands on the staff bottom line, step 8 on the top line", async ({ page }) => {
  const r = await metrics(page, 6);
  expect(r.notationY0).toBe(r.m.notationStaffBottomY);
  expect(r.notationY8).toBe(r.m.notationStaffTopY);
  expect(r.notationY8).toBeLessThan(r.notationY0); // higher pitch = smaller y (further up the canvas)
});

test("notation steps below 0 (ledger lines) are drawn further down than the staff", async ({ page }) => {
  const r = await metrics(page, 6);
  expect(r.notationYNeg2).toBeGreaterThan(r.notationY0);
});

test("tab line 0 is the topmost tab line and sits below the notation staff", async ({ page }) => {
  const r = await metrics(page, 6);
  expect(r.tabY0).toBe(r.m.tabStaffTopY);
  expect(r.tabY0).toBeGreaterThan(r.m.notationStaffBottomY);
  expect(r.tabYLast).toBeGreaterThan(r.tabY0);
});

test("canvas height grows with string count and comfortably contains both staves", async ({ page }) => {
  const r6 = await metrics(page, 6);
  const r7 = await metrics(page, 7);
  expect(r7.m.canvasHeight).toBeGreaterThan(r6.m.canvasHeight);
  expect(r6.m.canvasHeight).toBeGreaterThan(r6.tabYLast);
});

// ─── Multi-line pagination ──────────────────────────────────────────────────────

test("lineTopY stacks staff systems with a gap, line 0 at the top", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const geo = await import("/src/components/tab/tabGeometry.ts");
    const m = geo.computeStaffMetrics(6);
    return {
      line0: geo.lineTopY(0, m),
      line1: geo.lineTopY(1, m),
      line2: geo.lineTopY(2, m),
      canvasHeight: m.canvasHeight,
      gap: geo.LINE_GAP_PX,
    };
  });
  expect(r.line0).toBe(0);
  expect(r.line1).toBe(r.canvasHeight + r.gap);
  expect(r.line2 - r.line1).toBe(r.line1 - r.line0);
});

test("pageHeight stacks N lines with gaps between them but not trailing after the last", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const geo = await import("/src/components/tab/tabGeometry.ts");
    const m = geo.computeStaffMetrics(6);
    return {
      one: geo.pageHeight(1, m),
      three: geo.pageHeight(3, m),
      canvasHeight: m.canvasHeight,
      gap: geo.LINE_GAP_PX,
    };
  });
  expect(r.one).toBe(r.canvasHeight);
  expect(r.three).toBe(r.canvasHeight * 3 + r.gap * 2);
});
