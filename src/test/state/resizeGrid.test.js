import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resizeCells, countCellsLost, resizeKeyList, resizeColorEntries,
  boundingBoxForCells, cropCells, cropColorEntries,
  axisOffset, compensatedStaggerFlipped,
} from '../../state/resizeGrid.js';
import { isRaised } from '../../grid/peyote.js';

function makeCells(entries) {
  return new Map(entries.map(([row, col, colorId]) => [`${row},${col}`, { colorId }]));
}

function keysOf(map) {
  return [...map.keys()].sort();
}

test('resizeCells: growing rows with anchor "start" leaves existing coordinates unchanged', () => {
  const cells = makeCells([[0, 0, 'a'], [2, 3, 'b']]);
  const resized = resizeCells(cells, 5, 5, 8, 5, 'start', 'start');
  assert.deepEqual(keysOf(resized), ['0,0', '2,3']);
  assert.equal(resized.get('0,0').colorId, 'a');
});

test('resizeCells: growing rows with anchor "end" shifts existing coordinates by the added amount', () => {
  const cells = makeCells([[0, 0, 'a'], [2, 3, 'b']]);
  const resized = resizeCells(cells, 5, 5, 8, 5, 'end', 'start');
  // 3 rows added at the start (top), so every existing row shifts down by 3.
  assert.deepEqual(keysOf(resized), ['3,0', '5,3']);
});

test('resizeCells: growing rows with anchor "both" splits the added amount, extra unit at the end', () => {
  const cells = makeCells([[0, 0, 'a']]);
  // 5 -> 8 is +3 rows; floor(3/2) = 1 added at the start, 2 at the end.
  const resized = resizeCells(cells, 5, 5, 8, 5, 'both', 'start');
  assert.deepEqual(keysOf(resized), ['1,0']);
});

test('resizeCells: shrinking rows with anchor "start" drops cells past the new bound', () => {
  const cells = makeCells([[0, 0, 'a'], [4, 0, 'b']]);
  const resized = resizeCells(cells, 5, 5, 3, 5, 'start', 'start');
  assert.deepEqual(keysOf(resized), ['0,0']);
});

test('resizeCells: shrinking rows with anchor "end" drops cells before the new start and reindexes survivors from 0', () => {
  const cells = makeCells([[0, 0, 'a'], [4, 0, 'b']]);
  const resized = resizeCells(cells, 5, 5, 3, 5, 'end', 'start');
  // Removing 2 from the top: row 4 (the last row) survives and becomes row 2.
  assert.deepEqual(keysOf(resized), ['2,0']);
});

test('resizeCells: cols behave independently of rows', () => {
  const cells = makeCells([[1, 1, 'a']]);
  const resized = resizeCells(cells, 5, 5, 5, 3, 'start', 'end');
  // Cols shrink 5 -> 3 anchored 'end': offset = -2, col 1 -> -1, dropped.
  assert.equal(resized.size, 0);
});

test('resizeCells: unchanged dimensions with any anchor leave cells untouched', () => {
  const cells = makeCells([[2, 2, 'a']]);
  const resized = resizeCells(cells, 5, 5, 5, 5, 'both', 'both');
  assert.deepEqual(keysOf(resized), ['2,2']);
});

test('countCellsLost: matches the number of cells resizeCells actually drops', () => {
  const cells = makeCells([[0, 0, 'a'], [1, 0, 'b'], [4, 0, 'c'], [4, 4, 'd']]);
  const lost = countCellsLost(cells, 5, 5, 3, 3, 'start', 'start');
  const resized = resizeCells(cells, 5, 5, 3, 3, 'start', 'start');
  assert.equal(lost, cells.size - resized.size);
});

test('countCellsLost: zero when only growing', () => {
  const cells = makeCells([[0, 0, 'a'], [4, 4, 'b']]);
  assert.equal(countCellsLost(cells, 5, 5, 10, 10, 'both', 'both'), 0);
});

test('resizeKeyList: mirrors resizeCells for the equivalent key set, growing with anchor "end"', () => {
  const cells = makeCells([[0, 0, 'a'], [2, 3, 'b']]);
  const resized = resizeCells(cells, 5, 5, 8, 5, 'end', 'start');
  const keys = resizeKeyList(keysOf(cells), 5, 5, 8, 5, 'end', 'start');
  assert.deepEqual(keys.sort(), keysOf(resized));
});

test('resizeKeyList: mirrors resizeCells for the equivalent key set, shrinking with anchor "start"', () => {
  const cells = makeCells([[0, 0, 'a'], [4, 0, 'b']]);
  const resized = resizeCells(cells, 5, 5, 3, 5, 'start', 'start');
  const keys = resizeKeyList(keysOf(cells), 5, 5, 3, 5, 'start', 'start');
  assert.deepEqual(keys.sort(), keysOf(resized));
});

test('resizeKeyList: cols behave independently of rows, matching resizeCells', () => {
  const cells = makeCells([[1, 1, 'a']]);
  const resized = resizeCells(cells, 5, 5, 5, 3, 'start', 'end');
  const keys = resizeKeyList(keysOf(cells), 5, 5, 5, 3, 'start', 'end');
  assert.equal(keys.length, resized.size);
});

test('resizeColorEntries: mirrors resizeCells for the equivalent colorId pairs, growing with anchor "both"', () => {
  const cells = makeCells([[0, 0, 'a']]);
  const resized = resizeCells(cells, 5, 5, 8, 5, 'both', 'start');
  const colorEntries = resizeColorEntries([['0,0', 'a']], 5, 5, 8, 5, 'both', 'start');
  assert.deepEqual(colorEntries, [...resized.entries()].map(([key, value]) => [key, value.colorId]));
});

test('resizeColorEntries: drops entries that fall outside the new bounds, same count resizeCells would drop', () => {
  const cells = makeCells([[0, 0, 'a'], [1, 0, 'b'], [4, 0, 'c'], [4, 4, 'd']]);
  const resized = resizeCells(cells, 5, 5, 3, 3, 'start', 'start');
  const colorEntries = resizeColorEntries(
    [['0,0', 'a'], ['1,0', 'b'], ['4,0', 'c'], ['4,4', 'd']],
    5, 5, 3, 3, 'start', 'start'
  );
  assert.equal(colorEntries.length, resized.size);
});

test('boundingBoxForCells: returns null for an empty design', () => {
  assert.equal(boundingBoxForCells(new Map()), null);
  assert.equal(boundingBoxForCells([]), null);
});

test('boundingBoxForCells: a single cell is its own 1x1 box', () => {
  const box = boundingBoxForCells(makeCells([[3, 4, 'a']]));
  assert.deepEqual(box, { minRow: 3, maxRow: 3, minCol: 4, maxCol: 4, rows: 1, cols: 1 });
});

test('boundingBoxForCells: spans the min/max of every occupied cell, ignoring gaps between them', () => {
  const box = boundingBoxForCells(makeCells([[2, 5, 'a'], [7, 1, 'b'], [4, 9, 'c']]));
  assert.deepEqual(box, { minRow: 2, maxRow: 7, minCol: 1, maxCol: 9, rows: 6, cols: 9 });
});

test('boundingBoxForCells: accepts a plain key array (not just a Map)', () => {
  const box = boundingBoxForCells(['1,1', '3,3']);
  assert.deepEqual(box, { minRow: 1, maxRow: 3, minCol: 1, maxCol: 3, rows: 3, cols: 3 });
});

test('cropCells: shifts the box origin to (0,0) and never drops a cell', () => {
  const cells = makeCells([[2, 5, 'a'], [7, 1, 'b'], [4, 9, 'c']]);
  const box = boundingBoxForCells(cells);
  const cropped = cropCells(cells, box);
  assert.equal(cropped.size, cells.size);
  assert.deepEqual(keysOf(cropped), ['0,4', '2,8', '5,0']);
  assert.equal(cropped.get('0,4').colorId, 'a');
});

test('cropCells: a design already touching every edge is unchanged by cropping', () => {
  const cells = makeCells([[0, 0, 'a'], [0, 4, 'b'], [4, 0, 'c'], [4, 4, 'd'], [2, 2, 'e']]);
  const box = boundingBoxForCells(cells);
  assert.deepEqual(box, { minRow: 0, maxRow: 4, minCol: 0, maxCol: 4, rows: 5, cols: 5 });
  const cropped = cropCells(cells, box);
  assert.deepEqual(keysOf(cropped), keysOf(cells));
});

test('cropColorEntries: mirrors cropCells for the equivalent colorId pairs', () => {
  const cells = makeCells([[2, 5, 'a'], [7, 1, 'b'], [4, 9, 'c']]);
  const box = boundingBoxForCells(cells);
  const cropped = cropCells(cells, box);
  const colorEntries = cropColorEntries([['2,5', 'a'], ['7,1', 'b'], ['4,9', 'c']], box);
  assert.deepEqual(colorEntries.sort(), [...cropped.entries()].map(([key, value]) => [key, value.colorId]).sort());
});

test('axisOffset: "start" is always 0 regardless of delta', () => {
  assert.equal(axisOffset(5, 8, 'start'), 0);
  assert.equal(axisOffset(8, 5, 'start'), 0);
});

test('axisOffset: "end" equals the raw delta', () => {
  assert.equal(axisOffset(5, 8, 'end'), 3);
  assert.equal(axisOffset(8, 5, 'end'), -3);
});

test('axisOffset: "both" floors the delta split in half', () => {
  assert.equal(axisOffset(5, 8, 'both'), 1); // +3 -> floor(3/2) = 1
  assert.equal(axisOffset(5, 9, 'both'), 2); // +4 -> floor(4/2) = 2
});

test('compensatedStaggerFlipped: an even col offset leaves staggerFlipped unchanged', () => {
  assert.equal(compensatedStaggerFlipped(false, 0), false);
  assert.equal(compensatedStaggerFlipped(true, 0), true);
  assert.equal(compensatedStaggerFlipped(false, 4), false);
  assert.equal(compensatedStaggerFlipped(false, -4), false);
});

test('compensatedStaggerFlipped: an odd col offset toggles staggerFlipped', () => {
  assert.equal(compensatedStaggerFlipped(false, 3), true);
  assert.equal(compensatedStaggerFlipped(true, 3), false);
  assert.equal(compensatedStaggerFlipped(false, -3), true);
  assert.equal(compensatedStaggerFlipped(false, 1), true);
});

// Cross-module regression: proves compensatedStaggerFlipped actually cancels out
// the isRaised() parity flip a col shift introduces — i.e. that a cropped/resized
// design's pre-existing beads keep rendering with the exact raised/recessed look
// they had before, not just that the two functions independently do something
// reasonable. This is the real bug report ("cropping changes the bead pattern").
test('compensatedStaggerFlipped: cancels the isRaised() flip a col shift introduces, for every starting col/flip state', () => {
  for (const colOffset of [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]) {
    for (const staggerFlipped of [false, true]) {
      const newStaggerFlipped = compensatedStaggerFlipped(staggerFlipped, colOffset);
      for (let oldCol = 0; oldCol < 10; oldCol++) {
        const newCol = oldCol + colOffset;
        assert.equal(
          isRaised(newCol, 999 /* unused by isRaised itself */, newStaggerFlipped),
          isRaised(oldCol, 999, staggerFlipped),
          `oldCol=${oldCol} colOffset=${colOffset} staggerFlipped=${staggerFlipped}`
        );
      }
    }
  }
});
