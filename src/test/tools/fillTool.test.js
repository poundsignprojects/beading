import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFill } from '../../tools/fillTool.js';
import { setCell } from '../../state/cellStore.js';
import { peyoteNeighbors } from '../../grid/peyote.js';
import { squareNeighbors } from '../../grid/square.js';

// applyFill takes an injected neighborsFn(row, col) rather than importing a grid's
// adjacency directly, so it stays grid-engine-agnostic (see fillTool.js's own
// comment and .work/feature-square-stitch-plan.md). Most of these fixtures use
// peyote's 6-connectivity (via the same cols value every existing test already
// used), matching this file's pre-square-stitch behavior exactly.
const peyoteNeighborsAt10Cols = (row, col) => peyoteNeighbors(row, col, 10);

test('applyFill: filling an isolated single cell only changes that cell', () => {
  const cells = new Map();
  setCell(cells, 5, 5, 'red');
  const patch = applyFill(cells, 5, 5, 'blue', 20, 20, peyoteNeighborsAt10Cols);
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

  const patch = applyFill(cells, 0, 0, 'blue', 5, 5, (row, col) => peyoteNeighbors(row, col, 5));
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
  const patch = applyFill(cells, 1, 1, 'green', 3, 3, (row, col) => peyoteNeighbors(row, col, 3));
  const changedKeys = patch.map((p) => `${p.row},${p.col}`).sort();
  assert.ok(changedKeys.includes('1,1'));
  assert.ok(!changedKeys.includes('0,0'));
  assert.ok(!changedKeys.includes('2,2'));
  for (const p of patch) assert.equal(p.before, undefined);
});

test('applyFill: filling with the seed color is a no-op', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  const patch = applyFill(cells, 0, 0, 'red', 5, 5, peyoteNeighborsAt10Cols);
  assert.deepEqual(patch, []);
});

test('applyFill: follows true peyote 6-connectivity, not naive 4-connectivity', () => {
  // rows=3, cols=2. col0 (even): row0/row2 occupied (walls), row1 absent (seed).
  // col1: row1 occupied (blocks the naive same-row path), row0/row2 absent —
  // only row2 is reachable via the col0/col1 stagger (peyoteNeighbors' col-odd
  // parity, see peyote.js), not same-row, and not row0.
  const cells = new Map();
  setCell(cells, 0, 0, 'wall');
  setCell(cells, 2, 0, 'wall');
  setCell(cells, 1, 1, 'wall');

  const patch = applyFill(cells, 1, 0, 'fill', 3, 2, (row, col) => peyoteNeighbors(row, col, 2));
  const changedKeys = patch.map((p) => `${p.row},${p.col}`).sort();
  assert.deepEqual(changedKeys, ['1,0', '2,1']);
});

// The same layout run through square stitch's plain 4-connectivity instead: col1's
// row2 is NOT reachable from (1,0) (no diagonal adjacency at all in square stitch),
// so the fill stays confined to the seed cell alone — the opposite outcome from the
// peyote case immediately above, using the identical wall layout, confirming this
// is a genuine adjacency-rule difference and not a coincidence of the fixture.
test('applyFill: follows plain square-stitch 4-connectivity — no diagonal reach where peyote would have one', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'wall');
  setCell(cells, 2, 0, 'wall');
  setCell(cells, 1, 1, 'wall');

  const patch = applyFill(cells, 1, 0, 'fill', 3, 2, squareNeighbors);
  const changedKeys = patch.map((p) => `${p.row},${p.col}`).sort();
  assert.deepEqual(changedKeys, ['1,0']);
});

test('applyFill: a dense 300x200 grid fills in well under 100ms', () => {
  const cells = new Map();
  const rows = 300;
  const cols = 200;
  const start = performance.now();
  const patch = applyFill(cells, 0, 0, 'blue', rows, cols, (row, col) => peyoteNeighbors(row, col, cols));
  const elapsed = performance.now() - start;
  assert.equal(patch.length, rows * cols);
  assert.ok(elapsed < 1000, `fill took ${elapsed}ms`);
});
