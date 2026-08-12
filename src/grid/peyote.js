// JS's % keeps the sign of its left operand (-1 % 2 === -1, not 1), which would
// silently flip the odd/even stagger offset below the moment row goes negative —
// this normalizes to the mathematical (always non-negative) modulus instead.
// Declared up front since isRaised (immediately below) needs it too.
function positiveMod2(n) {
  return ((n % 2) + 2) % 2;
}

// Which parity is "raised" (offset 0) vs "recessed" (offset +half) is otherwise an
// arbitrary rendering choice — it has no effect on which cell holds which color,
// only on the on-screen zigzag silhouette — but it needed to be pinned to SOME
// external reference to be checkable at all. Originally pinned to row's own
// absolute parity (row odd = raised, independent of rows) to match Loomerly's
// "Starting bead: Top Right" convention found via a real Loomerly PDF import — but
// that import happened to be an even Width (20), where row=rows-1 (the Top Right
// position) is always odd, so "row odd = raised" and "row = rows-1 is raised" were
// indistinguishable from that one sample alone. A second real Loomerly import, this
// one an *odd* Width (55), exposed the difference: the user directly compared the
// app's rendered background dot-grid against Loomerly's own picture in the same
// corner and found the stagger direction flipped — "the Loomerly one top right is
// up, while the app top right is down" — even in completely empty (dot-only) area,
// which rules out an import/data bug (the dot grid doesn't read cell data at all)
// and points squarely at this parity rule. The true invariant is relative to the
// grid's own width, not an absolute row parity: raised iff row has the same parity
// as (rows - 1), i.e. the "Top Right" position (row = rows-1) is *always* raised,
// regardless of whether rows itself is odd or even. This reduces to the exact same
// "row odd = raised" rule for even rows (the only case previously verified), so it's
// backward-compatible there, and only changes behavior for odd rows (newly covered).
// peyoteCellAtPoint/peyoteCellAtPointClamped/peyoteCellAtPointUnbounded and
// peyoteNeighbors (below) all encode the same parity via this same helper and must
// stay in lockstep with it if it ever moves again.
function isRaised(row, rows) {
  return positiveMod2(row - rows + 1) === 0;
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
// must stay correct past both ends, not just within the grid's own bounds. `rows`
// is the grid's own total row count, needed only to resolve which parity is raised
// (see isRaised above) — it does not bound row the way peyoteCellAtPoint's `rows`
// does.
export function peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm, rows) {
  const colOffsetMm = isRaised(row, rows) ? 0 : beadWidthMm / 2;
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
  const colOffsetMm = isRaised(row, rows) ? 0 : beadWidthMm / 2;
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
  const colOffsetMm = isRaised(row, rows) ? 0 : beadWidthMm / 2;
  const col = Math.max(0, Math.min(cols - 1, Math.floor((yMm - colOffsetMm) / beadWidthMm)));
  return { row, col };
}

// Same formula as peyoteCellAtPoint/peyoteCellAtPointClamped, but with no bounds
// restriction at all — row/col can land negative or past rows/cols. Used for
// positioning a pending paste's anchor: unlike a selection (which only ever marks
// cells that already exist), a paste's clipboard content is legitimately allowed
// to hang off any edge of the grid, partially or entirely, while being dragged
// into position — applyPaste already clips whatever ends up off-grid at Confirm
// time, so the hit-test itself has nothing to protect by clamping. `rows` is still
// needed here (despite there being no bounds check) purely to resolve which parity
// is raised — see isRaised above.
export function peyoteCellAtPointUnbounded(xMm, yMm, beadWidthMm, beadHeightMm, rows) {
  const row = Math.floor(xMm / beadHeightMm);
  const colOffsetMm = isRaised(row, rows) ? 0 : beadWidthMm / 2;
  const col = Math.floor((yMm - colOffsetMm) / beadWidthMm);
  return { row, col };
}

// The six physically-adjacent cells for peyote's offset-row structure — two in the
// same row, two in the row above, two in the row below. Which two columns in an
// adjacent row depends on this row's parity (see isRaised above) — re-derived from
// that formula whenever it changes, since the two must stay geometrically
// consistent or flood fill would compute adjacency against stale geometry. `rows`
// is needed for the same reason isRaised needs it elsewhere: the grid's total row
// count determines which parity is raised, not row's own absolute parity alone.
// Does not clamp to grid bounds — callers filter out-of-range results themselves
// (flood fill already needs a bounds check per neighbor to stop the search).
export function peyoteNeighbors(row, col, rows) {
  const [a, b] = isRaised(row, rows) ? [col - 1, col] : [col, col + 1];
  return [
    [row, col - 1], [row, col + 1],
    [row - 1, a], [row - 1, b],
    [row + 1, a], [row + 1, b],
  ];
}

// Peyote's internal row/col do NOT follow the row=horizontal/col=vertical
// convention a spreadsheet or bitmap would use — `row` is a bead's position
// *along* a physical stitching row (the zigzag/offset axis), `col` identifies
// *which* physical row it belongs to. That inversion is peyote-specific (a
// consequence of how the half-bead stagger is expressed — see
// peyoteCellOriginMm above) and must not leak into code that needs to reason
// about "a physical row" as a stitch-type-agnostic concept. Any such code
// (wordChart.js, any future exporter) should go through these two functions
// instead of assuming row/col's roles directly — when brick/square/loom get
// built, only their own grid modules need to implement this contract
// correctly; consumers like wordChart.js won't need to change at all.
export function peyoteRowCount(cols) {
  return cols;
}

export function peyoteRowCells(rows, physicalRowIndex) {
  const cells = [];
  for (let row = 0; row < rows; row++) cells.push({ row, col: physicalRowIndex });
  return cells;
}
