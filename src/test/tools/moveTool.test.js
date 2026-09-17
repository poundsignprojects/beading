import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectMovingEntries, applyMove } from '../../tools/moveTool.js';
import { setCell } from '../../state/cellStore.js';

test('collectMovingEntries: with bounds, only occupied cells within them are picked up', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 1, 1, 'blue');
  setCell(cells, 9, 9, 'green'); // outside bounds
  const entries = collectMovingEntries(cells, { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 });
  const sorted = entries.slice().sort();
  assert.deepEqual(sorted, [[0, 0], [1, 1]].sort());
});

test('collectMovingEntries: with bounds null, every occupied cell is picked up (whole-layer move)', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 9, 9, 'green');
  const entries = collectMovingEntries(cells, null).sort();
  assert.deepEqual(entries, [[0, 0], [9, 9]].sort());
});

test('applyMove: shifts moving cells by the delta and clears their old position', () => {
  const baseCells = new Map();
  setCell(baseCells, 0, 0, 'red');
  const cells = new Map(baseCells);
  const patch = applyMove(cells, baseCells, [[0, 0]], 2, 3, 20, 20, new Set());
  assert.equal(cells.has('0,0'), false);
  assert.equal(cells.get('2,3').colorId, 'red');
  const sorted = patch.slice().sort((a, b) => a.row - b.row);
  assert.deepEqual(sorted, [
    { row: 0, col: 0, before: { colorId: 'red' }, after: undefined },
    { row: 2, col: 3, before: undefined, after: { colorId: 'red' } },
  ]);
});

test('applyMove: moving content overwrites whatever is already at the destination (front semantics)', () => {
  const baseCells = new Map();
  setCell(baseCells, 0, 0, 'red');
  setCell(baseCells, 0, 1, 'blue'); // not part of the move, sits at the destination
  const cells = new Map(baseCells);
  const patch = applyMove(cells, baseCells, [[0, 0]], 0, 1, 20, 20, new Set());
  assert.equal(cells.get('0,1').colorId, 'red');
  assert.equal(cells.has('0,0'), false);
  const sorted = patch.slice().sort((a, b) => a.col - b.col);
  assert.deepEqual(sorted, [
    { row: 0, col: 0, before: { colorId: 'red' }, after: undefined },
    { row: 0, col: 1, before: { colorId: 'blue' }, after: { colorId: 'red' } },
  ]);
});

test('applyMove: a destination outside the grid is dropped (clipped, not shifted), matching applyPaste', () => {
  const baseCells = new Map();
  setCell(baseCells, 4, 4, 'red');
  const cells = new Map(baseCells);
  const patch = applyMove(cells, baseCells, [[4, 4]], 0, 1, 5, 5, new Set()); // col 5 is out of bounds (0-4 valid)
  assert.equal(cells.has('4,4'), false); // still picked up
  assert.equal(cells.has('4,5'), false); // but the destination never lands
  assert.deepEqual(patch, [{ row: 4, col: 4, before: { colorId: 'red' }, after: undefined }]);
});

test('applyMove: recomputing at a new delta against the same baseCells does not drift from a previous call\'s leftovers', () => {
  const baseCells = new Map();
  setCell(baseCells, 0, 0, 'red');
  const cells = new Map(baseCells);
  const touchedKeys = new Set(); // same accumulator across the whole drag, per applyMove's own contract
  applyMove(cells, baseCells, [[0, 0]], 5, 5, 20, 20, touchedKeys); // simulate an earlier drag frame
  const patch = applyMove(cells, baseCells, [[0, 0]], 1, 1, 20, 20, touchedKeys); // then a later frame, smaller delta
  assert.equal(cells.has('5,5'), false); // the stale intermediate position is gone
  assert.equal(cells.get('1,1').colorId, 'red');
  assert.equal(cells.size, 1);
  assert.deepEqual(patch.sort((a, b) => a.row - b.row), [
    { row: 0, col: 0, before: { colorId: 'red' }, after: undefined },
    { row: 1, col: 1, before: undefined, after: { colorId: 'red' } },
  ]);
});

test('applyMove: a delta of (0,0) is a full no-op with an empty patch', () => {
  const baseCells = new Map();
  setCell(baseCells, 0, 0, 'red');
  const cells = new Map(baseCells);
  const patch = applyMove(cells, baseCells, [[0, 0]], 0, 0, 20, 20, new Set());
  assert.equal(cells.get('0,0').colorId, 'red');
  assert.equal(cells.size, 1);
  assert.deepEqual(patch, []);
});

test('applyMove: content outside the moving set is left completely untouched', () => {
  const baseCells = new Map();
  setCell(baseCells, 0, 0, 'red');
  setCell(baseCells, 9, 9, 'green'); // not part of this move
  const cells = new Map(baseCells);
  const patch = applyMove(cells, baseCells, [[0, 0]], 1, 1, 20, 20, new Set());
  assert.equal(cells.get('9,9').colorId, 'green');
  assert.equal(patch.some((entry) => entry.row === 9 && entry.col === 9), false);
});

test('applyMove: moving a whole blob by a small delta over itself does not clobber content read from stale cells', () => {
  const baseCells = new Map();
  setCell(baseCells, 0, 0, 'a');
  setCell(baseCells, 0, 1, 'b');
  setCell(baseCells, 0, 2, 'c');
  const cells = new Map(baseCells);
  const moving = [[0, 0], [0, 1], [0, 2]];
  applyMove(cells, baseCells, moving, 0, 1, 20, 20, new Set());
  assert.equal(cells.get('0,1').colorId, 'a');
  assert.equal(cells.get('0,2').colorId, 'b');
  assert.equal(cells.get('0,3').colorId, 'c');
  assert.equal(cells.has('0,0'), false);
  assert.equal(cells.size, 3);
});
