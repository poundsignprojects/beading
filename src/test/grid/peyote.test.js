import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peyoteCellOriginMm, generatePeyoteGrid, peyoteCellAtPoint, peyoteCellAtPointClamped, peyoteCellAtPointUnbounded, peyoteNeighbors, isRaised } from '../../grid/peyote.js';

const BEAD_W = 1.6;
const BEAD_H = 1.3;

// row = which physical stitching pass (height-driving); col = a bead's position
// along that pass (width-driving) — see .work/refactor-row-col-axis-naming-plan.md.
// Most of these tests use an even COLS (10), but isRaised depends only on col's own
// parity, never on COLS itself (see peyote.js's isRaised comment — resize-stability
// matters more than any external convention) — raised is simply "col is odd," for
// any COLS, even or odd. The odd-COLS cases below exist to confirm the rule really
// is COLS-independent, not to cover separate cols-relative behavior.
const COLS = 10;

test('peyoteCellOriginMm: first cell (row 0, col 0) is offset by half a bead width (col 0 is recessed for an even COLS)', () => {
  assert.deepEqual(peyoteCellOriginMm(0, 0, BEAD_W, BEAD_H, COLS), { xMm: 0, yMm: BEAD_W / 2 });
});

test('peyoteCellOriginMm: even col is offset by half a bead width', () => {
  const origin = peyoteCellOriginMm(3, 2, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, 2 * BEAD_H);
  assert.equal(origin.yMm, 3 * BEAD_W + BEAD_W / 2);
});

test('peyoteCellOriginMm: odd col has no half-width offset', () => {
  const origin = peyoteCellOriginMm(0, 1, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, BEAD_H);
  assert.equal(origin.yMm, 0);
});

test('peyoteCellOriginMm: even col row offset stacks with half-width offset', () => {
  const origin = peyoteCellOriginMm(2, 4, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, 4 * BEAD_H);
  assert.equal(origin.yMm, 2 * BEAD_W + BEAD_W / 2);
});

test('peyoteCellOriginMm: negative even col still gets the half-width offset (JS % keeps the sign of -2, which would otherwise skip it)', () => {
  const origin = peyoteCellOriginMm(0, -2, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, -2 * BEAD_H);
  assert.equal(origin.yMm, BEAD_W / 2);
});

test('peyoteCellOriginMm: negative odd col has no offset, same as a positive odd col', () => {
  const origin = peyoteCellOriginMm(0, -1, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, -1 * BEAD_H);
  assert.equal(origin.yMm, 0);
});

// Regression for the resize-stability bug found via real user reports: growing/shrinking
// columns (which changes COLS) used to silently re-flip the raised/recessed rendering for
// every cell, including ones that never moved, whenever the resize changed COLS' own
// parity — because isRaised used to be pinned relative to (cols - 1). These cases confirm
// isRaised for an odd COLS is identical to what a plain col-parity rule gives regardless of
// COLS, so a cell's rendering can no longer depend on the total col count.
test('peyoteCellOriginMm: for an odd COLS, the last col (cols-1) is recessed (col parity alone, independent of COLS)', () => {
  const oddCols = 55;
  const lastCol = oddCols - 1; // 54, even -- recessed under the col-parity-only rule
  const origin = peyoteCellOriginMm(0, lastCol, BEAD_W, BEAD_H, oddCols);
  assert.equal(origin.yMm, BEAD_W / 2); // recessed: even col
});

test('peyoteCellOriginMm: for an odd COLS, col 0 is recessed, same as it is for an even COLS', () => {
  const oddCols = 55;
  const origin = peyoteCellOriginMm(0, 0, BEAD_W, BEAD_H, oddCols);
  assert.equal(origin.yMm, BEAD_W / 2); // recessed: even col
});

test('peyoteCellOriginMm: for an odd COLS, col 1 is raised (col parity alone, independent of COLS)', () => {
  const oddCols = 55;
  const origin = peyoteCellOriginMm(0, 1, BEAD_W, BEAD_H, oddCols);
  assert.equal(origin.yMm, 0); // raised: odd col, no half-width offset
});

test('peyoteCellOriginMm: for an odd COLS, raised/recessed still strictly alternates col to col', () => {
  const oddCols = 55;
  for (let col = 0; col < oddCols - 1; col++) {
    const a = peyoteCellOriginMm(0, col, BEAD_W, BEAD_H, oddCols).yMm;
    const b = peyoteCellOriginMm(0, col + 1, BEAD_W, BEAD_H, oddCols).yMm;
    assert.notEqual(a, b, `cols ${col} and ${col + 1} should differ in stagger`);
  }
});

test('generatePeyoteGrid: bounding box for a 4x4 grid', () => {
  const grid = generatePeyoteGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.boundingBoxMm.widthMm, 4 * BEAD_H);
  assert.equal(grid.boundingBoxMm.heightMm, 4 * BEAD_W + BEAD_W / 2);
});

test('generatePeyoteGrid: passes through rows/cols/bead dimensions unchanged', () => {
  const grid = generatePeyoteGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.rows, 4);
  assert.equal(grid.cols, 4);
  assert.equal(grid.beadWidthMm, BEAD_W);
  assert.equal(grid.beadHeightMm, BEAD_H);
});

test('peyoteCellAtPoint: round-trips against peyoteCellOriginMm for every cell in a sample grid (even cols)', () => {
  const rows = 10;
  const cols = 10;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const origin = peyoteCellOriginMm(row, col, BEAD_W, BEAD_H, cols);
      // Nudge toward the cell's center so we're not testing exact-boundary rounding.
      const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
      const hit = peyoteCellAtPoint(point.xMm, point.yMm, BEAD_W, BEAD_H, rows, cols);
      assert.deepEqual(hit, { row, col }, `mismatch at row ${row}, col ${col}`);
    }
  }
});

test('peyoteCellAtPoint: round-trips against peyoteCellOriginMm for every cell in a sample grid (odd cols)', () => {
  const rows = 10;
  const cols = 11;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const origin = peyoteCellOriginMm(row, col, BEAD_W, BEAD_H, cols);
      const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
      const hit = peyoteCellAtPoint(point.xMm, point.yMm, BEAD_W, BEAD_H, rows, cols);
      assert.deepEqual(hit, { row, col }, `mismatch at row ${row}, col ${col}`);
    }
  }
});

test('peyoteCellAtPoint: point above/left of the grid returns null', () => {
  assert.equal(peyoteCellAtPoint(-1, -1, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPoint: point past the last col returns null', () => {
  assert.equal(peyoteCellAtPoint(10 * BEAD_H + 1, 0, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPoint: point past the last row on a recessed col returns null', () => {
  // Col 2's usable y-range is shifted down by BEAD_W / 2 (recessed, for COLS=10), so a
  // point just past rows * beadWidthMm should fall outside — this is the case the offset
  // math could silently get wrong if col resolution didn't happen before row resolution.
  const xMm = 2 * BEAD_H + BEAD_H / 2; // inside col 2 (recessed for COLS=10)
  const yMm = 10 * BEAD_W + BEAD_W / 2 + 0.01;
  assert.equal(peyoteCellAtPoint(xMm, yMm, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPointClamped: matches peyoteCellAtPoint for an in-bounds point', () => {
  const origin = peyoteCellOriginMm(3, 4, BEAD_W, BEAD_H, 10);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(
    peyoteCellAtPointClamped(point.xMm, point.yMm, BEAD_W, BEAD_H, 10, 10),
    { row: 3, col: 4 }
  );
});

test('peyoteCellAtPointClamped: point above/left of the grid clamps to (0, 0)', () => {
  assert.deepEqual(peyoteCellAtPointClamped(-5, -5, BEAD_W, BEAD_H, 10, 10), { row: 0, col: 0 });
});

test('peyoteCellAtPointClamped: point past the last row/col clamps to (rows-1, cols-1)', () => {
  assert.deepEqual(
    peyoteCellAtPointClamped(100 * BEAD_H, 100 * BEAD_W, BEAD_W, BEAD_H, 10, 10),
    { row: 9, col: 9 }
  );
});

test('peyoteCellAtPointUnbounded: round-trips against peyoteCellOriginMm for an in-bounds cell, matching peyoteCellAtPoint', () => {
  const origin = peyoteCellOriginMm(3, 4, BEAD_W, BEAD_H, 10);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H, 10), { row: 3, col: 4 });
});

test('peyoteCellAtPointUnbounded: point above/left of the grid returns a genuinely negative row/col, not clamped to (0,0)', () => {
  // Nudge into the cell's interior (same convention the round-trip test above
  // uses) rather than an exact cell-boundary multiple, which is fragile to
  // floating-point rounding in either direction.
  const origin = peyoteCellOriginMm(-2, -2, BEAD_W, BEAD_H, 10);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H, 10), { row: -2, col: -2 });
});

test('peyoteCellAtPointUnbounded: point past the last row/col returns values past rows/cols, not clamped', () => {
  const origin = peyoteCellOriginMm(15, 14, BEAD_W, BEAD_H, 10);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H, 10), { row: 15, col: 14 });
});

test('peyoteCellAtPointUnbounded: negative-col parity offset matches the positive-col pattern (even cols offset, odd cols do not)', () => {
  // Col -1 is odd (no stagger); col -2 is even (stagger applies) — same
  // alternation as positive cols, not flipped by JS's sign-preserving % operator.
  const oddOrigin = peyoteCellOriginMm(0, -1, BEAD_W, BEAD_H, 10);
  const oddPoint = { xMm: oddOrigin.xMm + BEAD_H / 2, yMm: oddOrigin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(oddPoint.xMm, oddPoint.yMm, BEAD_W, BEAD_H, 10), { row: 0, col: -1 });

  const evenOrigin = peyoteCellOriginMm(0, -2, BEAD_W, BEAD_H, 10);
  const evenPoint = { xMm: evenOrigin.xMm + BEAD_H / 2, yMm: evenOrigin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(evenPoint.xMm, evenPoint.yMm, BEAD_W, BEAD_H, 10), { row: 0, col: -2 });
});

test('peyoteNeighbors: recessed col uses row/row+1 in adjacent cols', () => {
  const neighbors = peyoteNeighbors(3, 2, COLS); // col 2 is recessed for COLS=10
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[2, 2], [4, 2], [3, 1], [4, 1], [3, 3], [4, 3]].map(String).sort()
  );
});

test('peyoteNeighbors: raised col uses row-1/row in adjacent cols', () => {
  const neighbors = peyoteNeighbors(3, 1, COLS); // col 1 is raised for COLS=10
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[2, 1], [4, 1], [2, 0], [3, 0], [2, 2], [3, 2]].map(String).sort()
  );
});

// Regression confirming peyoteNeighbors' raised/recessed resolution is COLS-independent
// (col parity alone) just like peyoteCellOriginMm's dedicated tests above, or flood fill
// (fillTool.js) would compute adjacency against stale/wrong geometry for any hand-resized
// design with an odd COLS.
test('peyoteNeighbors: for an odd COLS, the last col (cols-1) is treated as recessed, not raised', () => {
  const oddCols = 55;
  const lastCol = oddCols - 1; // 54, even -- recessed under the col-parity-only rule
  const neighbors = peyoteNeighbors(3, lastCol, oddCols);
  // recessed uses row/row+1 in adjacent cols (same mapping as the COLS=10 "recessed col" case above)
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[2, lastCol], [4, lastCol], [3, lastCol - 1], [4, lastCol - 1], [3, lastCol + 1], [4, lastCol + 1]].map(String).sort()
  );
});

test('peyoteNeighbors: returns exactly six cells with no duplicates', () => {
  for (const [row, col] of [[0, 0], [0, 1], [5, 5], [7, 4]]) {
    const neighbors = peyoteNeighbors(row, col, COLS);
    assert.equal(neighbors.length, 6);
    assert.equal(new Set(neighbors.map(String)).size, 6);
  }
});

test('peyoteNeighbors: adjacency is symmetric across a sample grid (even COLS)', () => {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      for (const [nRow, nCol] of peyoteNeighbors(row, col, COLS)) {
        const back = peyoteNeighbors(nRow, nCol, COLS).map(String);
        assert.ok(
          back.includes(String([row, col])),
          `(${nRow},${nCol})'s neighbors should include (${row},${col})`
        );
      }
    }
  }
});

test('peyoteNeighbors: adjacency is symmetric across a sample grid (odd COLS)', () => {
  const oddCols = 11;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < oddCols; col++) {
      for (const [nRow, nCol] of peyoteNeighbors(row, col, oddCols)) {
        const back = peyoteNeighbors(nRow, nCol, oddCols).map(String);
        assert.ok(
          back.includes(String([row, col])),
          `(${nRow},${nCol})'s neighbors should include (${row},${col})`
        );
      }
    }
  }
});
