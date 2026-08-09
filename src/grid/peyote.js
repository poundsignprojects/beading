// Rows are staggered by half a bead-width from their neighbors — that stagger is peyote's
// defining structural feature. Row-to-row vertical spacing uses bead *height* (the thread-axis
// dimension), not width/diameter, since that's what governs how tightly rows pack.
export function peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm) {
  const rowOffsetMm = (row % 2 === 1) ? beadWidthMm / 2 : 0;
  return {
    xMm: col * beadWidthMm + rowOffsetMm,
    yMm: row * beadHeightMm,
  };
}

// Deliberately does not pre-build a full cells[] array — callers derive only the
// visible cells on demand via peyoteCellOriginMm, so render cost scales with
// visible cells, not total pattern size.
export function generatePeyoteGrid({ rows, cols, beadWidthMm, beadHeightMm }) {
  const widthMm = cols * beadWidthMm + beadWidthMm / 2; // offset rows overhang by half a bead
  const heightMm = rows * beadHeightMm;
  return { rows, cols, beadWidthMm, beadHeightMm, boundingBoxMm: { widthMm, heightMm } };
}

// Inverse of peyoteCellOriginMm — hit-tests a world-mm point against the offset-row
// grid. Row determines the offset (odd rows shift half a bead-width right), so row
// must be resolved before col can be. Returns null outside the grid's row/col bounds
// so callers (draw/erase) can no-op instead of writing an out-of-range cell.
export function peyoteCellAtPoint(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) {
  const row = Math.floor(yMm / beadHeightMm);
  if (row < 0 || row >= rows) return null;
  const rowOffsetMm = (row % 2 === 1) ? beadWidthMm / 2 : 0;
  const col = Math.floor((xMm - rowOffsetMm) / beadWidthMm);
  if (col < 0 || col >= cols) return null;
  return { row, col };
}
