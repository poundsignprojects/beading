import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rotatedDimensions, rotatedCoord, rotateCells, rotateKeyList, rotateColorEntries,
  rotateSelection180,
} from '../../state/rotateGrid.js';

function makeCells(entries) {
  return new Map(entries.map(([row, col, colorId]) => [`${row},${col}`, { colorId }]));
}

function keysOf(map) {
  return [...map.keys()].sort();
}

test('rotatedDimensions: cw/ccw swap rows and cols, 180 leaves them unchanged', () => {
  assert.deepEqual(rotatedDimensions(2, 3, 'cw'), { rows: 3, cols: 2 });
  assert.deepEqual(rotatedDimensions(2, 3, 'ccw'), { rows: 3, cols: 2 });
  assert.deepEqual(rotatedDimensions(2, 3, '180'), { rows: 2, cols: 3 });
});

// Hand-derived against a 2-row x 3-col grid (row=y-down, col=x-right, this
// app's actual convention — see peyote.js's own header comment): rotating the
// whole picture 90° clockwise moves the top-left corner to the top-right of
// the now-3-row x 2-col result, and 90° counterclockwise moves it to the
// bottom-left.
test('rotatedCoord: top-left corner of a 2x3 grid lands at the hand-derived position for each direction', () => {
  assert.deepEqual(rotatedCoord(0, 0, 2, 3, 'cw'), { row: 0, col: 1 }); // top-right of 3x2
  assert.deepEqual(rotatedCoord(0, 0, 2, 3, 'ccw'), { row: 2, col: 0 }); // bottom-left of 3x2
  assert.deepEqual(rotatedCoord(0, 0, 2, 3, '180'), { row: 1, col: 2 }); // bottom-right of 2x3
});

test('rotatedCoord: bottom-right corner of a 2x3 grid lands at the hand-derived position for each direction', () => {
  assert.deepEqual(rotatedCoord(1, 2, 2, 3, 'cw'), { row: 2, col: 0 }); // bottom-left of 3x2
  assert.deepEqual(rotatedCoord(1, 2, 2, 3, 'ccw'), { row: 0, col: 1 }); // top-right of 3x2
  assert.deepEqual(rotatedCoord(1, 2, 2, 3, '180'), { row: 0, col: 0 }); // top-left of 2x3
});

test('rotateCells: cw on a 2x3 fixture matches the hand-derived coordinates', () => {
  const cells = makeCells([[0, 0, 'a'], [1, 2, 'b']]);
  const rotated = rotateCells(cells, 2, 3, 'cw');
  assert.deepEqual(keysOf(rotated), ['0,1', '2,0']);
  assert.equal(rotated.get('0,1').colorId, 'a');
  assert.equal(rotated.get('2,0').colorId, 'b');
});

test('rotateCells: ccw on a 2x3 fixture matches the hand-derived coordinates', () => {
  const cells = makeCells([[0, 0, 'a'], [1, 2, 'b']]);
  const rotated = rotateCells(cells, 2, 3, 'ccw');
  assert.deepEqual(keysOf(rotated), ['0,1', '2,0']);
  assert.equal(rotated.get('2,0').colorId, 'a');
  assert.equal(rotated.get('0,1').colorId, 'b');
});

test('rotateCells: 180 on a 2x3 fixture matches the hand-derived coordinates', () => {
  const cells = makeCells([[0, 0, 'a'], [1, 2, 'b']]);
  const rotated = rotateCells(cells, 2, 3, '180');
  assert.deepEqual(keysOf(rotated), ['0,0', '1,2']);
  assert.equal(rotated.get('1,2').colorId, 'a');
  assert.equal(rotated.get('0,0').colorId, 'b');
});

test('rotateCells: nothing is ever dropped — every entry survives a rotation', () => {
  const cells = makeCells([[0, 0, 'a'], [0, 1, 'b'], [0, 2, 'c'], [1, 0, 'd'], [1, 1, 'e'], [1, 2, 'f']]);
  assert.equal(rotateCells(cells, 2, 3, 'cw').size, 6);
  assert.equal(rotateCells(cells, 2, 3, 'ccw').size, 6);
  assert.equal(rotateCells(cells, 2, 3, '180').size, 6);
});

test('round trip: cw applied four times returns to the original cells and dimensions', () => {
  const original = makeCells([[0, 0, 'a'], [1, 2, 'b']]);
  let cells = original;
  let rows = 2;
  let cols = 3;
  for (let i = 0; i < 4; i++) {
    cells = rotateCells(cells, rows, cols, 'cw');
    ({ rows, cols } = rotatedDimensions(rows, cols, 'cw'));
  }
  assert.equal(rows, 2);
  assert.equal(cols, 3);
  assert.deepEqual(keysOf(cells), keysOf(original));
  assert.equal(cells.get('0,0').colorId, 'a');
  assert.equal(cells.get('1,2').colorId, 'b');
});

test('round trip: ccw applied four times returns to the original cells and dimensions', () => {
  const original = makeCells([[0, 0, 'a'], [1, 2, 'b']]);
  let cells = original;
  let rows = 2;
  let cols = 3;
  for (let i = 0; i < 4; i++) {
    cells = rotateCells(cells, rows, cols, 'ccw');
    ({ rows, cols } = rotatedDimensions(rows, cols, 'ccw'));
  }
  assert.equal(rows, 2);
  assert.equal(cols, 3);
  assert.deepEqual(keysOf(cells), keysOf(original));
});

test('round trip: 180 applied twice returns to the original cells', () => {
  const original = makeCells([[0, 0, 'a'], [1, 2, 'b']]);
  const once = rotateCells(original, 2, 3, '180');
  const twice = rotateCells(once, 2, 3, '180');
  assert.deepEqual(keysOf(twice), keysOf(original));
  assert.equal(twice.get('0,0').colorId, 'a');
  assert.equal(twice.get('1,2').colorId, 'b');
});

test('round trip: cw then ccw cancels out', () => {
  const original = makeCells([[0, 0, 'a'], [1, 2, 'b']]);
  const rotatedOnce = rotateCells(original, 2, 3, 'cw');
  const { rows: midRows, cols: midCols } = rotatedDimensions(2, 3, 'cw');
  const rotatedBack = rotateCells(rotatedOnce, midRows, midCols, 'ccw');
  assert.deepEqual(keysOf(rotatedBack), keysOf(original));
  assert.equal(rotatedBack.get('0,0').colorId, 'a');
  assert.equal(rotatedBack.get('1,2').colorId, 'b');
});

test('rotateKeyList: mirrors rotateCells over a plain key array', () => {
  const keys = ['0,0', '1,2'];
  assert.deepEqual(rotateKeyList(keys, 2, 3, 'cw').sort(), ['0,1', '2,0']);
});

test('rotateColorEntries: mirrors rotateCells over [key, colorId] pairs, values untouched', () => {
  const colorEntries = [['0,0', 'red'], ['1,2', 'blue']];
  const rotated = rotateColorEntries(colorEntries, 2, 3, '180');
  const asMap = new Map(rotated);
  assert.equal(asMap.get('1,2'), 'red');
  assert.equal(asMap.get('0,0'), 'blue');
});

test('rotateSelection180: swaps content within the same footprint on an odd-sized selection, center cell maps to itself', () => {
  const cells = makeCells([[0, 0, 'a'], [0, 1, 'b'], [0, 2, 'c'], [1, 1, 'center']]);
  // 3x3 selection at rows 0-2, cols 0-2 — center (1,1) rotates onto itself.
  const patch = rotateSelection180(cells, { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 2 });
  assert.equal(cells.get('2,2').colorId, 'a'); // (0,0) -> (2,2)
  assert.equal(cells.get('2,1').colorId, 'b'); // (0,1) -> (2,1)
  assert.equal(cells.get('2,0').colorId, 'c'); // (0,2) -> (2,0)
  assert.equal(cells.get('1,1').colorId, 'center'); // maps to itself, no-op
  assert.equal(cells.has('0,0'), false);
  // The self-mapping center cell shouldn't appear in the patch — it's a no-op.
  assert.ok(!patch.some((entry) => entry.row === 1 && entry.col === 1));
});

test('rotateSelection180: works on an even-sized selection too (no even/odd restriction, unlike Mirror Horizontal)', () => {
  const cells = makeCells([[0, 0, 'a'], [0, 1, 'b'], [1, 0, 'c'], [1, 1, 'd']]);
  rotateSelection180(cells, { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 });
  assert.equal(cells.get('1,1').colorId, 'a');
  assert.equal(cells.get('1,0').colorId, 'b');
  assert.equal(cells.get('0,1').colorId, 'c');
  assert.equal(cells.get('0,0').colorId, 'd');
});

test('rotateSelection180: undo-round-trip via the returned patch\'s before/after is self-consistent', () => {
  const cells = makeCells([[0, 0, 'a'], [1, 1, 'b']]);
  const patch = rotateSelection180(cells, { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 });
  for (const entry of patch) {
    const key = `${entry.row},${entry.col}`;
    if (entry.after === undefined) cells.delete(key);
    else cells.set(key, { colorId: entry.after.colorId });
  }
  // Re-apply "before" to confirm the patch fully describes the reverse too.
  for (const entry of patch) {
    const key = `${entry.row},${entry.col}`;
    if (entry.before === undefined) cells.delete(key);
    else cells.set(key, { colorId: entry.before.colorId });
  }
  assert.equal(cells.get('0,0').colorId, 'a');
  assert.equal(cells.get('1,1').colorId, 'b');
});
