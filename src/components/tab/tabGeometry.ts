// Pure pixel-geometry helpers for TabCanvas. Kept separate from actual
// canvas drawing calls so the pixel math has its own spec (see
// tests/tab-geometry.spec.ts) independent of what's inherently hard to
// assert about a canvas's drawn pixels.

export const NOTATION_STEP_PX = 5; // half a staff-line-spacing, per diatonic step
export const NOTATION_TOP_MARGIN = 50; // room above the staff for ledger lines / high notes
export const NOTATION_LINE_COUNT = 5;
export const STAFF_GAP_PX = 30; // gap between notation staff bottom and tab staff top
export const TAB_LINE_PX = 14;
export const BOTTOM_PADDING_PX = 30;
export const LEFT_MARGIN_PX = 90; // room for clef / key signature / time signature
export const RIGHT_PADDING_PX = 60;
export const LINE_GAP_PX = 40; // vertical gap between one staff system (line) and the next

export interface StaffMetrics {
  notationStaffTopY: number;
  notationStaffBottomY: number;
  tabStaffTopY: number;
  tabStaffBottomY: number;
  canvasHeight: number;
}

export function computeStaffMetrics(stringCount: number): StaffMetrics {
  const notationStaffBottomY = NOTATION_TOP_MARGIN + (NOTATION_LINE_COUNT - 1) * NOTATION_STEP_PX * 2;
  const notationStaffTopY = NOTATION_TOP_MARGIN;
  const tabStaffTopY = notationStaffBottomY + STAFF_GAP_PX;
  const tabStaffBottomY = tabStaffTopY + (stringCount - 1) * TAB_LINE_PX;
  const canvasHeight = tabStaffBottomY + BOTTOM_PADDING_PX;
  return { notationStaffTopY, notationStaffBottomY, tabStaffTopY, tabStaffBottomY, canvasHeight };
}

/** Diatonic staff step -> y pixel. Step 0 = bottom line, increases upward (smaller y). */
export function notationY(step: number, metrics: StaffMetrics): number {
  return metrics.notationStaffBottomY - step * NOTATION_STEP_PX;
}

/** 0-based tab line from the top (highest-pitched string) -> y pixel. */
export function tabY(lineFromTop: number, metrics: StaffMetrics): number {
  return metrics.tabStaffTopY + lineFromTop * TAB_LINE_PX;
}

/** Top y of the given 0-based staff system (page row) index. */
export function lineTopY(lineIndex: number, metrics: StaffMetrics): number {
  return lineIndex * (metrics.canvasHeight + LINE_GAP_PX);
}

/** Total page height needed to stack `lineCount` staff systems. */
export function pageHeight(lineCount: number, metrics: StaffMetrics): number {
  if (lineCount <= 0) return metrics.canvasHeight;
  return lineCount * metrics.canvasHeight + (lineCount - 1) * LINE_GAP_PX;
}
