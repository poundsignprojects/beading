import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStrokePatch, recordCellChange, strokePatchToArray } from '../../state/strokePatch.js';

test('recordCellChange: a single touch records one entry', () => {
  const patch = createStrokePatch();
  recordCellChange(patch, 0, 0, undefined, { colorId: 'red' });
  assert.deepEqual(strokePatchToArray(patch), [
    { row: 0, col: 0, before: undefined, after: { colorId: 'red' } },
  ]);
});

test('recordCellChange: touching the same cell twice keeps the first before and latest after', () => {
  const patch = createStrokePatch();
  recordCellChange(patch, 1, 2, undefined, { colorId: 'red' });
  recordCellChange(patch, 1, 2, { colorId: 'red' }, { colorId: 'blue' });
  const entries = strokePatchToArray(patch);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    row: 1,
    col: 2,
    before: undefined,
    after: { colorId: 'blue' },
  });
});

test('strokePatchToArray: returns one entry per unique cell touched', () => {
  const patch = createStrokePatch();
  recordCellChange(patch, 0, 0, undefined, { colorId: 'red' });
  recordCellChange(patch, 0, 1, undefined, { colorId: 'red' });
  recordCellChange(patch, 0, 0, { colorId: 'red' }, { colorId: 'blue' });
  const entries = strokePatchToArray(patch);
  assert.equal(entries.length, 2);
});

test('strokePatchToArray: an untouched patch is an empty array', () => {
  assert.deepEqual(strokePatchToArray(createStrokePatch()), []);
});
