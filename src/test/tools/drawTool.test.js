import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDrawAtCell } from '../../tools/drawTool.js';

test('applyDrawAtCell: sets an empty cell and reports a change', () => {
  const cells = new Map();
  const changed = applyDrawAtCell(cells, 0, 0, 'red');
  assert.equal(changed, true);
  assert.deepEqual(cells.get('0,0'), { colorId: 'red' });
});

test('applyDrawAtCell: re-applying the same color is a no-op', () => {
  const cells = new Map();
  applyDrawAtCell(cells, 0, 0, 'red');
  const changed = applyDrawAtCell(cells, 0, 0, 'red');
  assert.equal(changed, false);
});

test('applyDrawAtCell: applying a different color overwrites and reports a change', () => {
  const cells = new Map();
  applyDrawAtCell(cells, 0, 0, 'red');
  const changed = applyDrawAtCell(cells, 0, 0, 'blue');
  assert.equal(changed, true);
  assert.deepEqual(cells.get('0,0'), { colorId: 'blue' });
});
