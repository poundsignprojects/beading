import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMirror, canMirrorHorizontally } from '../../tools/mirrorTool.js';
import { setCell } from '../../state/cellStore.js';

test('applyMirror: horizontal flip of an asymmetric 1-row selection reverses it exactly', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 1, 'green');
  // col 2 left absent
  applyMirror(cells, { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 2 }, 'horizontal');
  assert.equal(cells.has('0,0'), false);
  assert.equal(cells.get('0,1').colorId, 'green');
  assert.equal(cells.get('0,2').colorId, 'red');
});

test('applyMirror: vertical flip of an odd-height selection, including occupied/absent mix', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  // row 1 col 0 left absent
  setCell(cells, 2, 0, 'blue');
  applyMirror(cells, { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 0 }, 'vertical');
  assert.equal(cells.get('0,0').colorId, 'blue');
  assert.equal(cells.has('1,0'), false);
  assert.equal(cells.get('2,0').colorId, 'red');
});

test('applyMirror: a selection already symmetric about its own axis produces an empty patch', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 2, 'red');
  setCell(cells, 0, 1, 'blue');
  const patch = applyMirror(cells, { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 2 }, 'horizontal');
  assert.deepEqual(patch, []);
});

test('applyMirror: flipping twice (horizontal then horizontal) returns to the original state', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 1, 'green');
  const selection = { rowStart: 0, rowEnd: 0, colStart: 0, colEnd: 2 };
  const snapshot = new Map(cells);
  applyMirror(cells, selection, 'horizontal');
  applyMirror(cells, selection, 'horizontal');
  assert.deepEqual([...cells.entries()].sort(), [...snapshot.entries()].sort());
});

// canMirrorHorizontally (.work/feature-multi-drop-peyote-plan.md's derivation:
// width % dropCount === 0 && (width / dropCount) % 2 === 1). dropCount=1 must
// reduce to today's plain "width is odd" rule — the existing regression cases
// below cover that; the dropCount>1 cases follow the same table from the plan.

test('canMirrorHorizontally: dropCount=1 (default) matches the original odd-width-only rule', () => {
  assert.equal(canMirrorHorizontally(1), true);
  assert.equal(canMirrorHorizontally(2), false);
  assert.equal(canMirrorHorizontally(3), true);
  assert.equal(canMirrorHorizontally(4), false);
  assert.equal(canMirrorHorizontally(5), true);
});

test('canMirrorHorizontally: dropCount=1 explicit matches dropCount omitted', () => {
  for (let width = 1; width <= 6; width++) {
    assert.equal(canMirrorHorizontally(width, 1), canMirrorHorizontally(width));
  }
});

test('canMirrorHorizontally: dropCount=2 requires width to be an even multiple-of-2 group count with an odd number of groups', () => {
  assert.equal(canMirrorHorizontally(2, 2), true); // 1 group (odd)
  assert.equal(canMirrorHorizontally(4, 2), false); // 2 groups (even)
  assert.equal(canMirrorHorizontally(6, 2), true); // 3 groups (odd)
  assert.equal(canMirrorHorizontally(8, 2), false); // 4 groups (even)
  assert.equal(canMirrorHorizontally(3, 2), false); // doesn't divide evenly into groups of 2
  assert.equal(canMirrorHorizontally(5, 2), false); // doesn't divide evenly into groups of 2
});

test('canMirrorHorizontally: dropCount=3 requires width to be a multiple of 3 with an odd group count', () => {
  assert.equal(canMirrorHorizontally(3, 3), true); // 1 group (odd)
  assert.equal(canMirrorHorizontally(6, 3), false); // 2 groups (even)
  assert.equal(canMirrorHorizontally(9, 3), true); // 3 groups (odd)
  assert.equal(canMirrorHorizontally(4, 3), false); // doesn't divide evenly into groups of 3
  assert.equal(canMirrorHorizontally(7, 3), false); // doesn't divide evenly into groups of 3
});
