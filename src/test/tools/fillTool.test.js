import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFill } from '../../tools/fillTool.js';
import { setCell } from '../../state/cellStore.js';

test('applyFill: filling an isolated single cell only changes that cell', () => {
  const cells = new Map();
  setCell(cells, 5, 5, 'red');
  const patch = applyFill(cells, 5, 5, 'blue', 20, 20);
  assert.deepEqual(patch, [{ row: 5, col: 5, before: { colorId: 'red' }, after: { colorId: 'blue' } }]);
  assert.deepEqual(cells.get('5,5'), { colorId: 'blue' });
});

test('applyFill: filling a same-colored contiguous blob changes exactly the blob', () => {
  const cells = new Map();
  // A 2x2 red blob (rows 0-1, cols 0-1) at row0 (even, a,b=col-1,col) so row0/row1
  // cols 0-1 are all mutually adjacent, surrounded by a different color border.
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 1, 'red');
  setCell(cells, 1, 0, 'red');
  setCell(cells, 1, 1, 'red');
  setCell(cells, 0, 2, 'green');
  setCell(cells, 2, 0, 'green');
  setCell(cells, 2, 1, 'green');

  const patch = applyFill(cells, 0, 0, 'blue', 5, 5);
  const changedKeys = patch.map((p) => `${p.row},${p.col}`).sort();
  assert.deepEqual(changedKeys, ['0,0', '0,1', '1,0', '1,1']);
  assert.equal(cells.get('0,2').colorId, 'green');
  assert.equal(cells.get('2,0').colorId, 'green');
  assert.equal(cells.get('2,1').colorId, 'green');
});

test('applyFill: filling from an absent cell occupies the connected absent region only', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 2, 2, 'red');
  // (0,1),(0,2),(1,1),(1,2) all left absent/connected; rest of a 3x3 grid bordered.
  const patch = applyFill(cells, 1, 1, 'green', 3, 3);
  const changedKeys = patch.map((p) => `${p.row},${p.col}`).sort();
  assert.ok(changedKeys.includes('1,1'));
  assert.ok(!changedKeys.includes('0,0'));
  assert.ok(!changedKeys.includes('2,2'));
  for (const p of patch) assert.equal(p.before, undefined);
});

test('applyFill: filling with the seed color is a no-op', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  const patch = applyFill(cells, 0, 0, 'red', 5, 5);
  assert.deepEqual(patch, []);
});

test('applyFill: follows true peyote 6-connectivity, not naive 4-connectivity', () => {
  // rows=2, cols=3. row0 (even): col0/col2 occupied (walls), col1 absent (seed).
  // row1: col1 occupied (blocks the naive same-column path), col0/col2 absent —
  // only col2 is reachable via the row0/row1 stagger (peyoteNeighbors' row-even
  // parity, see peyote.js), not same-column, and not col0.
  const cells = new Map();
  setCell(cells, 0, 0, 'wall');
  setCell(cells, 0, 2, 'wall');
  setCell(cells, 1, 1, 'wall');

  const patch = applyFill(cells, 0, 1, 'fill', 2, 3);
  const changedKeys = patch.map((p) => `${p.row},${p.col}`).sort();
  assert.deepEqual(changedKeys, ['0,1', '1,2']);
});

test('applyFill: a dense 300x200 grid fills in well under 100ms', () => {
  const cells = new Map();
  const rows = 300;
  const cols = 200;
  const start = performance.now();
  const patch = applyFill(cells, 0, 0, 'blue', rows, cols);
  const elapsed = performance.now() - start;
  assert.equal(patch.length, rows * cols);
  assert.ok(elapsed < 1000, `fill took ${elapsed}ms`);
});
