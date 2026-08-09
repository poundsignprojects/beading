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
