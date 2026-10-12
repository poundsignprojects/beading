import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridSizeMm, rowsColsForSizeMm } from '../../grid/sizeConversion.js';
import { mmToInches, inchesToMm } from '../../units/convert.js';

const DELICA = { widthMm: 1.6, heightMm: 1.3 };

test('gridSizeMm matches the peyote bounding box, half-bead overhang included', () => {
  const { widthMm, heightMm } = gridSizeMm(10, 20, 'peyote', DELICA);
  assert.ok(Math.abs(widthMm - 20 * 1.3) < 1e-9);
  assert.ok(Math.abs(heightMm - (10 * 1.6 + 0.8)) < 1e-9);
});

test('gridSizeMm for square stitch has no overhang', () => {
  const { heightMm } = gridSizeMm(10, 20, 'square', DELICA);
  assert.ok(Math.abs(heightMm - 16) < 1e-9);
});

test('rowsColsForSizeMm inverts gridSizeMm exactly for both stitch types', () => {
  for (const stitchType of ['peyote', 'square']) {
    for (const [rows, cols] of [[1, 1], [7, 20], [106, 29], [300, 200]]) {
      const size = gridSizeMm(rows, cols, stitchType, DELICA);
      assert.deepEqual(rowsColsForSizeMm(size.widthMm, size.heightMm, stitchType, DELICA), { rows, cols });
    }
  }
});

test('a size displayed rounded (2dp inches, 1dp mm) still converts back to the same bead counts', () => {
  for (const stitchType of ['peyote', 'square']) {
    for (let n = 1; n <= 250; n++) {
      const size = gridSizeMm(n, n, stitchType, DELICA);
      const viaInches = rowsColsForSizeMm(
        inchesToMm(Number(mmToInches(size.widthMm).toFixed(2))),
        inchesToMm(Number(mmToInches(size.heightMm).toFixed(2))),
        stitchType, DELICA);
      assert.deepEqual(viaInches, { rows: n, cols: n });
      const viaMm = rowsColsForSizeMm(Number(size.widthMm.toFixed(1)), Number(size.heightMm.toFixed(1)), stitchType, DELICA);
      assert.deepEqual(viaMm, { rows: n, cols: n });
    }
  }
});

test('rowsColsForSizeMm rounds to the nearest bead and never goes below 1', () => {
  assert.deepEqual(rowsColsForSizeMm(1.3 * 4.4, 1.6 * 4.6, 'square', DELICA), { rows: 5, cols: 4 });
  assert.deepEqual(rowsColsForSizeMm(0, 0, 'peyote', DELICA), { rows: 1, cols: 1 });
  assert.deepEqual(rowsColsForSizeMm(NaN, -5, 'peyote', DELICA), { rows: 1, cols: 1 });
});
