import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeCells, countCellsLost, resizeKeyList, resizeColorEntries } from '../../state/resizeGrid.js';

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
