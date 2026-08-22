// Square stitch's own grid math — a true row/col grid, beads stacked directly on
// top of and beside each other with no offset between passes. Far simpler than
// peyote.js: no stagger, no isRaised, no flipped/positiveMod2 concerns (there's no
// negative-parity case to guard against, since nothing here depends on parity at
// all). See .work/feature-square-stitch-plan.md for why this is a separate file
// rather than a parameterized branch inside peyote.js.
//
// Bead dimension mapping is deliberately identical to peyote's (col spaced by
// beadHeightMm, row spaced by beadWidthMm), not "corrected" to the more intuitive
// col*width/row*height — see the plan's "Bead dimension mapping" section. The
// Bead Catalog dialog's "W"/"H" labels are already bound to these same swapped
// fields specifically so they match peyote's on-screen effect; reusing the
// identical mapping here means the same bead type renders the same on-screen size
// in both stitch types, with no dialog changes needed.
export function squareCellOriginMm(row, col, beadWidthMm, beadHeightMm) {
  return { xMm: col * beadHeightMm, yMm: row * beadWidthMm };
}

// Deliberately does not pre-build a full cells[] array, matching
// generatePeyoteGrid's own rationale — render cost scales with visible cells,
// not total pattern size.
export function generateSquareGrid({ rows, cols, beadWidthMm, beadHeightMm }) {
  const widthMm = cols * beadHeightMm;
  const heightMm = rows * beadWidthMm;
  return { rows, cols, beadWidthMm, beadHeightMm, boundingBoxMm: { widthMm, heightMm } };
}

// Inverse of squareCellOriginMm. Returns null outside the grid's row/col bounds
// so callers (draw/erase) can no-op instead of writing an out-of-range cell.
export function squareCellAtPoint(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) {
  const col = Math.floor(xMm / beadHeightMm);
  if (col < 0 || col >= cols) return null;
  const row = Math.floor(yMm / beadWidthMm);
  if (row < 0 || row >= rows) return null;
  return { row, col };
}

// Same hit-test as squareCellAtPoint, but clamps into [0,rows)/[0,cols) instead of
// returning null outside those bounds — used by marquee-selection dragging, where
// the pointer briefly leaving the canvas/grid edge should still track the nearest
// in-bounds cell rather than freezing the selection.
export function squareCellAtPointClamped(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) {
  const col = Math.max(0, Math.min(cols - 1, Math.floor(xMm / beadHeightMm)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(yMm / beadWidthMm)));
  return { row, col };
}

// Same formula as squareCellAtPoint/squareCellAtPointClamped, but with no bounds
// restriction at all — row/col can land negative or past rows/cols. Used for
// positioning a pending paste's anchor, which is legitimately allowed to hang off
// any edge of the grid while being dragged into position — see peyoteCellAtPointUnbounded's
// own comment in peyote.js for the full rationale (identical here).
export function squareCellAtPointUnbounded(xMm, yMm, beadWidthMm, beadHeightMm) {
  const col = Math.floor(xMm / beadHeightMm);
  const row = Math.floor(yMm / beadWidthMm);
  return { row, col };
}

// Plain 4-connectivity (up/down/left/right) — square stitch has no stagger, so
// there's no diagonal adjacency the way peyote's offset rows produce. Does not
// clamp to grid bounds — callers filter out-of-range results themselves (flood
// fill already needs a bounds check per neighbor to stop the search).
export function squareNeighbors(row, col) {
  return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]];
}
