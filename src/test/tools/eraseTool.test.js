import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEraseAtCell } from '../../tools/eraseTool.js';
import { applyDrawAtCell } from '../../tools/drawTool.js';

test('applyEraseAtCell: clears a set cell and returns the before/after diff', () => {
  const cells = new Map();
  applyDrawAtCell(cells, 1, 2, 'red');
  const result = applyEraseAtCell(cells, 1, 2);
  assert.deepEqual(result, { row: 1, col: 2, before: { colorId: 'red' }, after: undefined });
  assert.equal(cells.has('1,2'), false);
});

test('applyEraseAtCell: erasing an already-empty cell is a no-op', () => {
  const cells = new Map();
  const result = applyEraseAtCell(cells, 1, 2);
  assert.equal(result, null);
});
