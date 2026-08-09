import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEraseAtCell } from '../../tools/eraseTool.js';
import { applyDrawAtCell } from '../../tools/drawTool.js';

test('applyEraseAtCell: clears a set cell and reports a change', () => {
  const cells = new Map();
  applyDrawAtCell(cells, 1, 2, 'red');
  const changed = applyEraseAtCell(cells, 1, 2);
  assert.equal(changed, true);
  assert.equal(cells.has('1,2'), false);
});

test('applyEraseAtCell: erasing an already-empty cell is a no-op', () => {
  const cells = new Map();
  const changed = applyEraseAtCell(cells, 1, 2);
  assert.equal(changed, false);
});
