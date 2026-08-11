// JS's % keeps the sign of its left operand (-1 % 2 === -1, not 1), which would
// silently flip the odd/even stagger offset below the moment row goes negative —
// this normalizes to the mathematical (always non-negative) modulus instead.
// Declared up front since peyoteCellOriginMm (immediately below) needs it too, not
// just peyoteCellAtPointUnbounded further down.
function positiveMod2(n) {
  return ((n % 2) + 2) % 2;
}

// Rows run across the grid horizontally (each row is a single flat thread pass —
// matches how it's printed in wordChart.js) and are staggered vertically by half a
// bead-width from their neighbors — that stagger is peyote's defining structural
// feature. Within a row, beads step down by bead *width* (their own diameter, the
// within-pass spacing); row-to-row horizontal spacing uses bead *height* (the
// thread-axis dimension), since that's what governs how tightly rows pack.
//
// row/col are ordinarily in [0,rows)/[0,cols), but this is also called with
// out-of-range (including negative) values while rendering a pending paste's ghost
// overlay — its clipboard content can legitimately hang off any edge of the grid
// while being positioned (see peyoteCellAtPointUnbounded) — so the stagger parity
// must stay correct past both ends, not just within the grid's own bounds.
export function peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm) {
  const colOffsetMm = positiveMod2(row) === 1 ? beadWidthMm / 2 : 0;
  return {
    xMm: row * beadHeightMm,
    yMm: col * beadWidthMm + colOffsetMm,
  };
}

// Deliberately does not pre-build a full cells[] array — callers derive only the
// visible cells on demand via peyoteCellOriginMm, so render cost scales with
// visible cells, not total pattern size.
export function generatePeyoteGrid({ rows, cols, beadWidthMm, beadHeightMm }) {
  const widthMm = rows * beadHeightMm;
  const heightMm = cols * beadWidthMm + beadWidthMm / 2; // offset rows overhang by half a bead
  return { rows, cols, beadWidthMm, beadHeightMm, boundingBoxMm: { widthMm, heightMm } };
}

// Inverse of peyoteCellOriginMm — hit-tests a world-mm point against the offset-row
// grid. Row determines the offset (odd rows shift half a bead-width down), so row
// must be resolved before col can be. Returns null outside the grid's row/col bounds
// so callers (draw/erase) can no-op instead of writing an out-of-range cell.
export function peyoteCellAtPoint(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) {
  const row = Math.floor(xMm / beadHeightMm);
  if (row < 0 || row >= rows) return null;
  const colOffsetMm = (row % 2 === 1) ? beadWidthMm / 2 : 0;
  const col = Math.floor((yMm - colOffsetMm) / beadWidthMm);
  if (col < 0 || col >= cols) return null;
  return { row, col };
}

// Same hit-test as peyoteCellAtPoint, but clamps into [0,rows)/[0,cols) instead of
// returning null outside those bounds — used by marquee-selection dragging, where
// the pointer briefly leaving the canvas/grid edge should still track the nearest
// in-bounds cell rather than freezing the selection.
export function peyoteCellAtPointClamped(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) {
  const row = Math.max(0, Math.min(rows - 1, Math.floor(xMm / beadHeightMm)));
  const colOffsetMm = (row % 2 === 1) ? beadWidthMm / 2 : 0;
  const col = Math.max(0, Math.min(cols - 1, Math.floor((yMm - colOffsetMm) / beadWidthMm)));
  return { row, col };
}

// Same formula as peyoteCellAtPoint/peyoteCellAtPointClamped, but with no bounds
// restriction at all — row/col can land negative or past rows/cols. Used for
// positioning a pending paste's anchor: unlike a selection (which only ever marks
// cells that already exist), a paste's clipboard content is legitimately allowed
// to hang off any edge of the grid, partially or entirely, while being dragged
// into position — applyPaste already clips whatever ends up off-grid at Confirm
// time, so the hit-test itself has nothing to protect by clamping.
export function peyoteCellAtPointUnbounded(xMm, yMm, beadWidthMm, beadHeightMm) {
  const row = Math.floor(xMm / beadHeightMm);
  const colOffsetMm = positiveMod2(row) === 1 ? beadWidthMm / 2 : 0;
  const col = Math.floor((yMm - colOffsetMm) / beadWidthMm);
  return { row, col };
}

// The six physically-adjacent cells for peyote's offset-row structure — two in the
// same row, two in the row above, two in the row below. Which two columns in an
// adjacent row depends on this row's parity (see peyoteCellOriginMm's offset rule).
// Does not clamp to grid bounds — callers filter out-of-range results themselves
// (flood fill already needs a bounds check per neighbor to stop the search).
export function peyoteNeighbors(row, col) {
  const [a, b] = row % 2 === 0 ? [col - 1, col] : [col, col + 1];
  return [
    [row, col - 1], [row, col + 1],
    [row - 1, a], [row - 1, b],
    [row + 1, a], [row + 1, b],
  ];
}
