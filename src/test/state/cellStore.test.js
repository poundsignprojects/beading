import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, setCell, clearCell, getCell, cellsToEntries, entriesToCells } from '../../state/cellStore.js';

test('cellKey: distinct row/col pairs produce distinct keys', () => {
  const seen = new Set();
  for (let row = 0; row < 30; row++) {
    for (let col = 0; col < 30; col++) {
      const key = cellKey(row, col);
      assert.ok(!seen.has(key), `collision at ${key}`);
      seen.add(key);
    }
  }
});

test('setCell/getCell: round-trips a colorId', () => {
  const cells = new Map();
  setCell(cells, 2, 3, 'red');
  assert.deepEqual(getCell(cells, 2, 3), { colorId: 'red' });
});

test('getCell: returns undefined for an unset cell', () => {
  const cells = new Map();
  assert.equal(getCell(cells, 0, 0), undefined);
});

test('setCell: overwrites an existing colorId', () => {
  const cells = new Map();
  setCell(cells, 1, 1, 'red');
  setCell(cells, 1, 1, 'blue');
  assert.deepEqual(getCell(cells, 1, 1), { colorId: 'blue' });
});

test('clearCell: removes a set cell', () => {
  const cells = new Map();
  setCell(cells, 5, 5, 'green');
  clearCell(cells, 5, 5);
  assert.equal(getCell(cells, 5, 5), undefined);
});

test('clearCell: no-op on an already-empty cell', () => {
  const cells = new Map();
  clearCell(cells, 0, 0);
  assert.equal(cells.size, 0);
});

test('cellsToEntries/entriesToCells: round-trips a populated Map', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 3, 7, 'blue');
  setCell(cells, 12, 1, 'green');
  const roundTripped = entriesToCells(cellsToEntries(cells));
  assert.deepEqual(roundTripped, cells);
});

test('cellsToEntries/entriesToCells: round-trips an empty Map', () => {
  const roundTripped = entriesToCells(cellsToEntries(new Map()));
  assert.equal(roundTripped.size, 0);
});
