import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyColorReplace } from '../../tools/colorReplaceTool.js';
import { setCell } from '../../state/cellStore.js';

test('applyColorReplace: replaces every non-contiguous occurrence and nothing else', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 5, 5, 'red');
  setCell(cells, 9, 9, 'red');
  setCell(cells, 1, 1, 'blue');

  const patch = applyColorReplace(cells, 'red', 'green');
  const changedKeys = patch.map((p) => `${p.row},${p.col}`).sort();
  assert.deepEqual(changedKeys, ['0,0', '5,5', '9,9']);
  assert.equal(cells.get('0,0').colorId, 'green');
  assert.equal(cells.get('5,5').colorId, 'green');
  assert.equal(cells.get('9,9').colorId, 'green');
  assert.equal(cells.get('1,1').colorId, 'blue');
});

test('applyColorReplace: replacing a color with itself is a no-op', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  const patch = applyColorReplace(cells, 'red', 'red');
  assert.deepEqual(patch, []);
});

test('applyColorReplace: replacing null (unassigned) recolors every unassigned cell', () => {
  const cells = new Map();
  setCell(cells, 0, 0, null);
  setCell(cells, 1, 1, null);
  setCell(cells, 2, 2, 'red');
  const patch = applyColorReplace(cells, null, 'blue');
  const changedKeys = patch.map((p) => `${p.row},${p.col}`).sort();
  assert.deepEqual(changedKeys, ['0,0', '1,1']);
  assert.equal(cells.get('2,2').colorId, 'red');
});

test('applyColorReplace: a color absent from cells returns an empty patch', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  const patch = applyColorReplace(cells, 'purple', 'blue');
  assert.deepEqual(patch, []);
});
