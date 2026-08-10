// Rows run across the grid horizontally (each row is a single flat thread pass —
// matches how it's printed in wordChart.js) and are staggered vertically by half a
// bead-width from their neighbors — that stagger is peyote's defining structural
// feature. Within a row, beads step down by bead *width* (their own diameter, the
// within-pass spacing); row-to-row horizontal spacing uses bead *height* (the
// thread-axis dimension), since that's what governs how tightly rows pack.
export function peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm) {
  const colOffsetMm = (row % 2 === 1) ? beadWidthMm / 2 : 0;
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
