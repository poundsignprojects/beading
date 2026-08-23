import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistory,
  pushPatch,
  pushGeometryChange,
  canUndo,
  canRedo,
  undo,
  redo,
  clearHistory,
} from '../../state/historyStore.js';

test('pushPatch: no-ops on an empty patch', () => {
  const history = createHistory();
  const pushed = pushPatch(history, []);
  assert.equal(pushed, false);
  assert.equal(canUndo(history), false);
});

test('pushPatch: clears the redo stack on every push', () => {
  const history = createHistory();
  pushPatch(history, [{ row: 0, col: 0, before: undefined, after: { colorId: 'red' } }]);
  const cells = new Map();
  undo(history, cells);
  assert.equal(canRedo(history), true);
  pushPatch(history, [{ row: 1, col: 1, before: undefined, after: { colorId: 'blue' } }]);
  assert.equal(canRedo(history), false);
});

test('pushPatch: drops the oldest entry once MAX_HISTORY_DEPTH is exceeded', () => {
  const history = createHistory();
  const cells = new Map();
  for (let i = 0; i < 101; i++) {
    pushPatch(history, [{ row: i, col: 0, before: undefined, after: { colorId: 'red' } }]);
  }
  // Undo all 100 retained patches; the 101st push should have evicted patch 0
  // (row 0), so cell (0,0) should never be touched by any undo.
  for (let i = 0; i < 100; i++) {
    undo(history, cells);
  }
  assert.equal(canUndo(history), false);
  assert.equal(cells.has('0,0'), false);
});

test('undo/redo: restores a cell that was empty before (delete on undo)', () => {
  const history = createHistory();
  const cells = new Map();
  cells.set('0,0', { colorId: 'red' });
  pushPatch(history, [{ row: 0, col: 0, before: undefined, after: { colorId: 'red' } }]);

  undo(history, cells);
  assert.equal(cells.has('0,0'), false);

  redo(history, cells);
  assert.deepEqual(cells.get('0,0'), { colorId: 'red' });
});

test('undo/redo: restores a cell that had a different color before', () => {
  const history = createHistory();
  const cells = new Map();
  cells.set('2,3', { colorId: 'blue' });
  pushPatch(history, [
    { row: 2, col: 3, before: { colorId: 'red' }, after: { colorId: 'blue' } },
  ]);

  undo(history, cells);
  assert.deepEqual(cells.get('2,3'), { colorId: 'red' });

  redo(history, cells);
  assert.deepEqual(cells.get('2,3'), { colorId: 'blue' });
});

test('canUndo/canRedo: track stack emptiness', () => {
  const history = createHistory();
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), false);

  const cells = new Map();
  pushPatch(history, [{ row: 0, col: 0, before: undefined, after: { colorId: 'red' } }]);
  assert.equal(canUndo(history), true);
  assert.equal(canRedo(history), false);

  undo(history, cells);
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), true);
});

test('undo: no-ops on an empty undo stack', () => {
  const history = createHistory();
  const cells = new Map();
  assert.equal(undo(history, cells), false);
});

test('redo: no-ops on an empty redo stack', () => {
  const history = createHistory();
  const cells = new Map();
  assert.equal(redo(history, cells), false);
});

test('pushGeometryChange: undo calls apply with the before snapshot, redo with the after snapshot', () => {
  const history = createHistory();
  const calls = [];
  const before = { cols: 5 };
  const after = { cols: 8 };
  pushGeometryChange(history, before, after, (snapshot) => calls.push(snapshot));

  undo(history, new Map()); // cells arg is ignored for a geometry entry
  assert.deepEqual(calls, [before]);

  redo(history, new Map());
  assert.deepEqual(calls, [before, after]);
});

test('pushGeometryChange: clears the redo stack, same as pushPatch', () => {
  const history = createHistory();
  pushGeometryChange(history, { cols: 5 }, { cols: 8 }, () => {});
  undo(history, new Map());
  assert.equal(canRedo(history), true);
  pushGeometryChange(history, { cols: 8 }, { cols: 3 }, () => {});
  assert.equal(canRedo(history), false);
});

test('geometry entries and cell patches interleave on one stack in true chronological order', () => {
  const history = createHistory();
  const cells = new Map();
  const geometryCalls = [];

  // Simulates: draw a cell, resize (a geometry entry), draw another cell — each
  // cells.set mirrors what drawTool would already have applied live before the
  // matching push, same as real usage.
  cells.set('0,0', { colorId: 'red' });
  pushPatch(history, [{ row: 0, col: 0, before: undefined, after: { colorId: 'red' } }]);
  pushGeometryChange(history, { cols: 5 }, { cols: 8 }, (snapshot) => geometryCalls.push(snapshot));
  cells.set('1,1', { colorId: 'blue' });
  pushPatch(history, [{ row: 1, col: 1, before: undefined, after: { colorId: 'blue' } }]);

  // Undo order: last draw, then the resize, then the first draw.
  undo(history, cells);
  assert.equal(cells.has('1,1'), false);
  assert.deepEqual(geometryCalls, []);

  undo(history, cells);
  assert.deepEqual(geometryCalls, [{ cols: 5 }]);

  undo(history, cells);
  assert.equal(cells.has('0,0'), false);
  assert.equal(canUndo(history), false);

  // Redo replays the same three actions forward, in the same order — each
  // assertion reads real applyPatch-driven mutation, not a re-simulated value.
  redo(history, cells);
  assert.deepEqual(cells.get('0,0'), { colorId: 'red' });

  redo(history, cells);
  assert.deepEqual(geometryCalls, [{ cols: 5 }, { cols: 8 }]);

  redo(history, cells);
  assert.deepEqual(cells.get('1,1'), { colorId: 'blue' });
  assert.equal(canRedo(history), false);
});

test('clearHistory: empties both stacks', () => {
  const history = createHistory();
  const cells = new Map();
  pushPatch(history, [{ row: 0, col: 0, before: undefined, after: { colorId: 'red' } }]);
  undo(history, cells);
  pushPatch(history, [{ row: 1, col: 1, before: undefined, after: { colorId: 'blue' } }]);
  clearHistory(history);
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), false);
});
