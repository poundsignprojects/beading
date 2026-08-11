import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peyoteCellOriginMm, generatePeyoteGrid, peyoteCellAtPoint, peyoteCellAtPointClamped, peyoteCellAtPointUnbounded, peyoteNeighbors, peyoteRowCount, peyoteRowCells } from '../../grid/peyote.js';

const BEAD_W = 1.6;
const BEAD_H = 1.3;

test('peyoteCellOriginMm: first cell (row 0, col 0) has no offset', () => {
  assert.deepEqual(peyoteCellOriginMm(0, 0, BEAD_W, BEAD_H), { xMm: 0, yMm: 0 });
});

test('peyoteCellOriginMm: even row has no half-width offset', () => {
  const origin = peyoteCellOriginMm(2, 3, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, 2 * BEAD_H);
  assert.equal(origin.yMm, 3 * BEAD_W);
});

test('peyoteCellOriginMm: odd row is offset by half a bead width', () => {
  const origin = peyoteCellOriginMm(1, 0, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, BEAD_H);
  assert.equal(origin.yMm, BEAD_W / 2);
});

test('peyoteCellOriginMm: odd row col offset stacks with half-width offset', () => {
  const origin = peyoteCellOriginMm(3, 2, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, 3 * BEAD_H);
  assert.equal(origin.yMm, 2 * BEAD_W + BEAD_W / 2);
});

test('peyoteCellOriginMm: negative odd row still gets the half-width offset (JS % keeps the sign of -1, which would otherwise skip it)', () => {
  const origin = peyoteCellOriginMm(-1, 0, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, -1 * BEAD_H);
  assert.equal(origin.yMm, BEAD_W / 2);
});

test('peyoteCellOriginMm: negative even row has no offset, same as a positive even row', () => {
  const origin = peyoteCellOriginMm(-2, 0, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, -2 * BEAD_H);
  assert.equal(origin.yMm, 0);
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

test('peyoteCellAtPoint: round-trips against peyoteCellOriginMm for every cell in a sample grid', () => {
  const rows = 10;
  const cols = 10;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const origin = peyoteCellOriginMm(row, col, BEAD_W, BEAD_H);
      // Nudge toward the cell's center so we're not testing exact-boundary rounding.
      const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
      const hit = peyoteCellAtPoint(point.xMm, point.yMm, BEAD_W, BEAD_H, rows, cols);
      assert.deepEqual(hit, { row, col }, `mismatch at row ${row}, col ${col}`);
    }
  }
});

test('peyoteCellAtPoint: point above/left of the grid returns null', () => {
  assert.equal(peyoteCellAtPoint(-1, -1, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPoint: point past the last row returns null', () => {
  assert.equal(peyoteCellAtPoint(10 * BEAD_H + 1, 0, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPoint: point past the last col on an odd (offset) row returns null', () => {
  // Odd row's usable y-range is shifted down by BEAD_W / 2, so a point just past
  // cols * beadWidthMm should fall outside — this is the case the offset math could
  // silently get wrong if row resolution didn't happen before col resolution.
  const xMm = 1 * BEAD_H + BEAD_H / 2; // inside row 1 (odd)
  const yMm = 10 * BEAD_W + BEAD_W / 2 + 0.01;
  assert.equal(peyoteCellAtPoint(xMm, yMm, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPointClamped: matches peyoteCellAtPoint for an in-bounds point', () => {
  const origin = peyoteCellOriginMm(3, 4, BEAD_W, BEAD_H);
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
  const origin = peyoteCellOriginMm(3, 4, BEAD_W, BEAD_H);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H), { row: 3, col: 4 });
});

test('peyoteCellAtPointUnbounded: point above/left of the grid returns a genuinely negative row/col, not clamped to (0,0)', () => {
  // Nudge into the cell's interior (same convention the round-trip test above
  // uses) rather than an exact cell-boundary multiple, which is fragile to
  // floating-point rounding in either direction.
  const origin = peyoteCellOriginMm(-2, -2, BEAD_W, BEAD_H);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H), { row: -2, col: -2 });
});

test('peyoteCellAtPointUnbounded: point past the last row/col returns values past rows/cols, not clamped', () => {
  const origin = peyoteCellOriginMm(14, 15, BEAD_W, BEAD_H);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H), { row: 14, col: 15 });
});

test('peyoteCellAtPointUnbounded: negative-row parity offset matches the positive-row pattern (odd rows offset, even rows do not)', () => {
  // Row -1 is odd (stagger applies); row -2 is even (no stagger) — same
  // alternation as positive rows, not flipped by JS's sign-preserving % operator.
  const oddOrigin = peyoteCellOriginMm(-1, 0, BEAD_W, BEAD_H);
  const oddPoint = { xMm: oddOrigin.xMm + BEAD_H / 2, yMm: oddOrigin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(oddPoint.xMm, oddPoint.yMm, BEAD_W, BEAD_H), { row: -1, col: 0 });

  const evenOrigin = peyoteCellOriginMm(-2, 0, BEAD_W, BEAD_H);
  const evenPoint = { xMm: evenOrigin.xMm + BEAD_H / 2, yMm: evenOrigin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(evenPoint.xMm, evenPoint.yMm, BEAD_W, BEAD_H), { row: -2, col: 0 });
});

test('peyoteNeighbors: even row uses col-1/col in adjacent rows', () => {
  const neighbors = peyoteNeighbors(2, 3);
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[2, 2], [2, 4], [1, 2], [1, 3], [3, 2], [3, 3]].map(String).sort()
  );
});

test('peyoteNeighbors: odd row uses col/col+1 in adjacent rows', () => {
  const neighbors = peyoteNeighbors(1, 3);
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[1, 2], [1, 4], [0, 3], [0, 4], [2, 3], [2, 4]].map(String).sort()
  );
});

test('peyoteNeighbors: returns exactly six cells with no duplicates', () => {
  for (const [row, col] of [[0, 0], [1, 0], [5, 5], [4, 7]]) {
    const neighbors = peyoteNeighbors(row, col);
    assert.equal(neighbors.length, 6);
    assert.equal(new Set(neighbors.map(String)).size, 6);
  }
});

test('peyoteNeighbors: adjacency is symmetric across a sample grid', () => {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      for (const [nRow, nCol] of peyoteNeighbors(row, col)) {
        const back = peyoteNeighbors(nRow, nCol).map(String);
        assert.ok(
          back.includes(String([row, col])),
          `(${nRow},${nCol})'s neighbors should include (${row},${col})`
        );
      }
    }
  }
});

// col identifies which physical stitching row a bead belongs to (see
// peyoteCellOriginMm's comment) — peyoteRowCount/peyoteRowCells are the
// stitch-type-agnostic accessors wordChart.js uses instead of assuming that
// inversion directly.
test('peyoteRowCount: returns cols unchanged — the physical row count', () => {
  assert.equal(peyoteRowCount(7), 7);
  assert.equal(peyoteRowCount(0), 0);
});

test('peyoteRowCells: returns every row index at a fixed col, in ascending order', () => {
  assert.deepEqual(peyoteRowCells(4, 2), [
    { row: 0, col: 2 },
    { row: 1, col: 2 },
    { row: 2, col: 2 },
    { row: 3, col: 2 },
  ]);
});

test('peyoteRowCells: an empty row count returns an empty array', () => {
  assert.deepEqual(peyoteRowCells(0, 3), []);
});
