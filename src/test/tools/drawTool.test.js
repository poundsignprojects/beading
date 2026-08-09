import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDrawAtCell } from '../../tools/drawTool.js';

test('applyDrawAtCell: sets an empty cell and returns the before/after diff', () => {
  const cells = new Map();
  const result = applyDrawAtCell(cells, 0, 0, 'red');
  assert.deepEqual(result, { row: 0, col: 0, before: undefined, after: { colorId: 'red' } });
  assert.deepEqual(cells.get('0,0'), { colorId: 'red' });
});

test('applyDrawAtCell: re-applying the same color is a no-op', () => {
  const cells = new Map();
  applyDrawAtCell(cells, 0, 0, 'red');
  const result = applyDrawAtCell(cells, 0, 0, 'red');
  assert.equal(result, null);
});

test('applyDrawAtCell: applying a different color overwrites and returns the correct diff', () => {
  const cells = new Map();
  applyDrawAtCell(cells, 0, 0, 'red');
  const result = applyDrawAtCell(cells, 0, 0, 'blue');
  assert.deepEqual(result, {
    row: 0,
    col: 0,
    before: { colorId: 'red' },
    after: { colorId: 'blue' },
  });
  assert.deepEqual(cells.get('0,0'), { colorId: 'blue' });
});
