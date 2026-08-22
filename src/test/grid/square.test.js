import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  squareCellOriginMm,
  generateSquareGrid,
  squareCellAtPoint,
  squareCellAtPointClamped,
  squareCellAtPointUnbounded,
  squareNeighbors,
} from '../../grid/square.js';

const BEAD_W = 1.6;
const BEAD_H = 1.3;

test('squareCellOriginMm: origin at (0,0) is (0,0), no offset', () => {
  assert.deepEqual(squareCellOriginMm(0, 0, BEAD_W, BEAD_H), { xMm: 0, yMm: 0 });
});

test('squareCellOriginMm: col drives xMm by beadHeightMm, row drives yMm by beadWidthMm, no stagger', () => {
  const origin = squareCellOriginMm(3, 4, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, 4 * BEAD_H);
  assert.equal(origin.yMm, 3 * BEAD_W);
});

test('squareCellOriginMm: two vertically-adjacent same-column cells have identical xMm (no stagger)', () => {
  const a = squareCellOriginMm(2, 5, BEAD_W, BEAD_H);
  const b = squareCellOriginMm(3, 5, BEAD_W, BEAD_H);
  assert.equal(a.xMm, b.xMm);
});

test('generateSquareGrid: bounding box for a 4x4 grid has no half-bead overhang, unlike peyote', () => {
  const grid = generateSquareGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.boundingBoxMm.widthMm, 4 * BEAD_H);
  assert.equal(grid.boundingBoxMm.heightMm, 4 * BEAD_W);
});

test('generateSquareGrid: passes through rows/cols/bead dimensions unchanged', () => {
  const grid = generateSquareGrid({ rows: 4, cols: 6, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.rows, 4);
  assert.equal(grid.cols, 6);
  assert.equal(grid.beadWidthMm, BEAD_W);
  assert.equal(grid.beadHeightMm, BEAD_H);
});

test('squareCellAtPoint: round-trips against squareCellOriginMm for every cell in a sample grid', () => {
  const rows = 10;
  const cols = 11;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const origin = squareCellOriginMm(row, col, BEAD_W, BEAD_H);
      const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
      const hit = squareCellAtPoint(point.xMm, point.yMm, BEAD_W, BEAD_H, rows, cols);
      assert.deepEqual(hit, { row, col }, `mismatch at row ${row}, col ${col}`);
    }
  }
});

test('squareCellAtPoint: point above/left of the grid returns null', () => {
  assert.equal(squareCellAtPoint(-1, -1, BEAD_W, BEAD_H, 10, 10), null);
});

test('squareCellAtPoint: point past the last col returns null', () => {
  assert.equal(squareCellAtPoint(10 * BEAD_H + 1, 0, BEAD_W, BEAD_H, 10, 10), null);
});

test('squareCellAtPoint: point past the last row returns null', () => {
  assert.equal(squareCellAtPoint(0, 10 * BEAD_W + 1, BEAD_W, BEAD_H, 10, 10), null);
});

test('squareCellAtPointClamped: matches squareCellAtPoint for an in-bounds point', () => {
  const origin = squareCellOriginMm(3, 4, BEAD_W, BEAD_H);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(
    squareCellAtPointClamped(point.xMm, point.yMm, BEAD_W, BEAD_H, 10, 10),
    { row: 3, col: 4 }
  );
});

test('squareCellAtPointClamped: point above/left of the grid clamps to (0, 0)', () => {
  assert.deepEqual(squareCellAtPointClamped(-5, -5, BEAD_W, BEAD_H, 10, 10), { row: 0, col: 0 });
});

test('squareCellAtPointClamped: point past the last row/col clamps to (rows-1, cols-1)', () => {
  assert.deepEqual(
    squareCellAtPointClamped(100 * BEAD_H, 100 * BEAD_W, BEAD_W, BEAD_H, 10, 10),
    { row: 9, col: 9 }
  );
});

test('squareCellAtPointUnbounded: round-trips against squareCellOriginMm for an in-bounds cell, matching squareCellAtPoint', () => {
  const origin = squareCellOriginMm(3, 4, BEAD_W, BEAD_H);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(squareCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H), { row: 3, col: 4 });
});

test('squareCellAtPointUnbounded: point above/left of the grid returns a genuinely negative row/col, not clamped to (0,0)', () => {
  const origin = squareCellOriginMm(-2, -2, BEAD_W, BEAD_H);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(squareCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H), { row: -2, col: -2 });
});

test('squareCellAtPointUnbounded: point past the last row/col returns values past rows/cols, not clamped', () => {
  const origin = squareCellOriginMm(15, 14, BEAD_W, BEAD_H);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(squareCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H), { row: 15, col: 14 });
});

test('squareNeighbors: returns exactly the four orthogonal cells', () => {
  const neighbors = squareNeighbors(3, 4);
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[2, 4], [4, 4], [3, 3], [3, 5]].map(String).sort()
  );
});

test('squareNeighbors: returns exactly four cells with no duplicates', () => {
  for (const [row, col] of [[0, 0], [0, 1], [5, 5], [7, 4]]) {
    const neighbors = squareNeighbors(row, col);
    assert.equal(neighbors.length, 4);
    assert.equal(new Set(neighbors.map(String)).size, 4);
  }
});

test('squareNeighbors: adjacency is symmetric across a sample grid', () => {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      for (const [nRow, nCol] of squareNeighbors(row, col)) {
        const back = squareNeighbors(nRow, nCol).map(String);
        assert.ok(
          back.includes(String([row, col])),
          `(${nRow},${nCol})'s neighbors should include (${row},${col})`
        );
      }
    }
  }
});
