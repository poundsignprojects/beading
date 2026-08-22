// row = which physical stitching pass a bead belongs to (0..rows-1) — matches
// this app's Rows/Cols UI labels directly, and the ordinary rows=vertical/
// cols=horizontal convention. col = a bead's position along one physical pass
// (0..cols-1). rows = how many passes are stacked (height-driving); cols = how
// many beads wide one pass is (width-driving). Before this file's row/col-axis
// refactor, `row`/`col` meant the opposite of what the UI already called them —
// see .work/refactor-row-col-axis-naming-plan.md for the full derivation and the
// migration this required for every already-saved design.

// JS's % keeps the sign of its left operand (-1 % 2 === -1, not 1), which would
// silently flip the odd/even stagger offset below the moment col goes negative —
// this normalizes to the mathematical (always non-negative) modulus instead.
// Declared up front since isRaised (immediately below) needs it too.
function positiveMod2(n) {
  return ((n % 2) + 2) % 2;
}

// Which parity is "raised" (offset 0) vs "recessed" (offset +half) is otherwise an
// arbitrary rendering choice — it has no effect on which cell holds which color,
// only on the on-screen zigzag silhouette — but it needs to be pinned to SOME rule
// to be well-defined at all. Pinned to col's own parity alone (not to the grid's
// total cols count) so a resize that changes cols' parity can't silently re-flip
// the raised/recessed rendering for cells that never moved — a real user-reported
// bug (see CLAUDE.md's Phase Status). `cols` is kept as a parameter purely so
// every existing caller (which already needs it for other reasons, e.g.
// bounds-checking) doesn't have to change if this rule ever moves again.
// peyoteCellAtPoint/peyoteCellAtPointClamped/peyoteCellAtPointUnbounded and
// peyoteNeighbors (below) all encode the same parity via this same helper and
// must stay in lockstep with it.
export function isRaised(col, cols) {
  return positiveMod2(col) === 1;
}

// Passes are staggered from their neighbors by half a bead-width — peyote's
// defining structural feature. row-to-row (pass-to-pass) spacing uses bead
// height (governs how tightly passes pack, along the x/screen-horizontal axis);
// within a pass, beads step by bead width (their own diameter, the within-pass
// spacing, along the y/screen-vertical axis).
//
// row/col are ordinarily in [0,rows)/[0,cols), but this is also called with
// out-of-range (including negative) values while rendering a pending paste's ghost
// overlay — its clipboard content can legitimately hang off any edge of the grid
// while being positioned (see peyoteCellAtPointUnbounded) — so the stagger parity
// must stay correct past both ends, not just within the grid's own bounds. `cols`
// is the grid's own total beads-per-pass count, needed only to resolve which
// parity is raised (see isRaised above) — it does not bound col the way
// peyoteCellAtPoint's `cols` does.
export function peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm, cols) {
  const rowOffsetMm = isRaised(col, cols) ? 0 : beadWidthMm / 2;
  return {
    xMm: col * beadHeightMm,
    yMm: row * beadWidthMm + rowOffsetMm,
  };
}

// Deliberately does not pre-build a full cells[] array — callers derive only the
// visible cells on demand via peyoteCellOriginMm, so render cost scales with
// visible cells, not total pattern size.
export function generatePeyoteGrid({ rows, cols, beadWidthMm, beadHeightMm }) {
  const widthMm = cols * beadHeightMm;
  const heightMm = rows * beadWidthMm + beadWidthMm / 2; // offset passes overhang by half a bead
  return { rows, cols, beadWidthMm, beadHeightMm, boundingBoxMm: { widthMm, heightMm } };
}

// Inverse of peyoteCellOriginMm — hit-tests a world-mm point against the offset-row
// grid. Col determines the stagger offset (odd cols shift half a bead-width down),
// so col must be resolved before row can be. Returns null outside the grid's
// row/col bounds so callers (draw/erase) can no-op instead of writing an
// out-of-range cell.
export function peyoteCellAtPoint(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) {
  const col = Math.floor(xMm / beadHeightMm);
  if (col < 0 || col >= cols) return null;
  const rowOffsetMm = isRaised(col, cols) ? 0 : beadWidthMm / 2;
  const row = Math.floor((yMm - rowOffsetMm) / beadWidthMm);
  if (row < 0 || row >= rows) return null;
  return { row, col };
}

// Same hit-test as peyoteCellAtPoint, but clamps into [0,rows)/[0,cols) instead of
// returning null outside those bounds — used by marquee-selection dragging, where
// the pointer briefly leaving the canvas/grid edge should still track the nearest
// in-bounds cell rather than freezing the selection.
export function peyoteCellAtPointClamped(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) {
  const col = Math.max(0, Math.min(cols - 1, Math.floor(xMm / beadHeightMm)));
  const rowOffsetMm = isRaised(col, cols) ? 0 : beadWidthMm / 2;
  const row = Math.max(0, Math.min(rows - 1, Math.floor((yMm - rowOffsetMm) / beadWidthMm)));
  return { row, col };
}

// Same formula as peyoteCellAtPoint/peyoteCellAtPointClamped, but with no bounds
// restriction at all — row/col can land negative or past rows/cols. Used for
// positioning a pending paste's anchor: unlike a selection (which only ever marks
// cells that already exist), a paste's clipboard content is legitimately allowed
// to hang off any edge of the grid, partially or entirely, while being dragged
// into position — applyPaste already clips whatever ends up off-grid at Confirm
// time, so the hit-test itself has nothing to protect by clamping. `cols` is still
// needed here (despite there being no bounds check) purely to resolve which parity
// is raised — see isRaised above.
export function peyoteCellAtPointUnbounded(xMm, yMm, beadWidthMm, beadHeightMm, cols) {
  const col = Math.floor(xMm / beadHeightMm);
  const rowOffsetMm = isRaised(col, cols) ? 0 : beadWidthMm / 2;
  const row = Math.floor((yMm - rowOffsetMm) / beadWidthMm);
  return { row, col };
}

// The six physically-adjacent cells for peyote's offset-row structure: two
// directly above/below in the same col (one full bead-width apart, no
// horizontal shift), and four diagonal — two in each neighboring col (half a
// bead-width apart vertically, one bead-height apart horizontally), matching
// peyoteCellOriginMm's stagger geometry exactly. Which two rows in a
// neighboring col depends on this col's own parity (see isRaised above) —
// re-derived from that formula whenever it changes, since the two must stay
// geometrically consistent or flood fill would compute adjacency against stale
// geometry. `cols` is needed for the same reason isRaised needs it elsewhere:
// resolving which parity is raised. Does not clamp to grid bounds — callers
// filter out-of-range results themselves (flood fill already needs a bounds
// check per neighbor to stop the search).
export function peyoteNeighbors(row, col, cols) {
  const [a, b] = isRaised(col, cols) ? [row - 1, row] : [row, row + 1];
  return [
    [row - 1, col], [row + 1, col],
    [a, col - 1], [b, col - 1],
    [a, col + 1], [b, col + 1],
  ];
}
