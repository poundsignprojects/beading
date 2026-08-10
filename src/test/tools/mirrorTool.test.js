import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMirror } from '../../tools/mirrorTool.js';
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
