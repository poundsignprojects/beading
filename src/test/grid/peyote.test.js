import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peyoteCellOriginMm, generatePeyoteGrid, peyoteCellAtPoint } from '../../grid/peyote.js';

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
