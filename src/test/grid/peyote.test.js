import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peyoteCellOriginMm, generatePeyoteGrid } from '../../grid/peyote.js';

const BEAD_W = 1.6;
const BEAD_H = 1.3;

test('peyoteCellOriginMm: first cell (row 0, col 0) has no offset', () => {
  assert.deepEqual(peyoteCellOriginMm(0, 0, BEAD_W, BEAD_H), { xMm: 0, yMm: 0 });
});

test('peyoteCellOriginMm: even row has no half-width offset', () => {
  const origin = peyoteCellOriginMm(2, 3, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, 3 * BEAD_W);
  assert.equal(origin.yMm, 2 * BEAD_H);
});

test('peyoteCellOriginMm: odd row is offset by half a bead width', () => {
  const origin = peyoteCellOriginMm(1, 0, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, BEAD_W / 2);
  assert.equal(origin.yMm, BEAD_H);
});

test('peyoteCellOriginMm: odd row col offset stacks with half-width offset', () => {
  const origin = peyoteCellOriginMm(3, 2, BEAD_W, BEAD_H);
  assert.equal(origin.xMm, 2 * BEAD_W + BEAD_W / 2);
  assert.equal(origin.yMm, 3 * BEAD_H);
});

test('generatePeyoteGrid: bounding box for a 4x4 grid', () => {
  const grid = generatePeyoteGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.boundingBoxMm.widthMm, 4 * BEAD_W + BEAD_W / 2);
  assert.equal(grid.boundingBoxMm.heightMm, 4 * BEAD_H);
});

test('generatePeyoteGrid: passes through rows/cols/bead dimensions unchanged', () => {
  const grid = generatePeyoteGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.rows, 4);
  assert.equal(grid.cols, 4);
  assert.equal(grid.beadWidthMm, BEAD_W);
  assert.equal(grid.beadHeightMm, BEAD_H);
});
