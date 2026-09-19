import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectWandContiguous, selectWandGlobal } from '../../tools/magicWandTool.js';
import { setCell } from '../../state/cellStore.js';
import { peyoteNeighbors } from '../../grid/peyote.js';

const peyoteNeighborsAt10Cols = (row, col) => peyoteNeighbors(row, col, 10);

test('selectWandContiguous: selecting an isolated single cell selects only that cell', () => {
  const cells = new Map();
  setCell(cells, 5, 5, 'red');
  const selection = selectWandContiguous(cells, 5, 5, 20, 20, peyoteNeighborsAt10Cols);
  assert.deepEqual(selection, {
    rowStart: 5, rowEnd: 5, colStart: 5, colEnd: 5, mask: new Set(['5,5']),
  });
});

test('selectWandContiguous: selects exactly a same-colored contiguous blob, not a differently-colored neighbor', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 1, 'red');
  setCell(cells, 1, 0, 'red');
  setCell(cells, 1, 1, 'red');
  setCell(cells, 0, 2, 'green');
  setCell(cells, 2, 0, 'green');
  setCell(cells, 2, 1, 'green');

  const selection = selectWandContiguous(cells, 0, 0, 5, 5, (row, col) => peyoteNeighbors(row, col, 5));
  assert.deepEqual(selection.mask, new Set(['0,0', '0,1', '1,0', '1,1']));
  assert.deepEqual(selection, { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1, mask: selection.mask });
});

test('selectWandContiguous: a non-contiguous same-colored cell elsewhere is not included', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 4, 4, 'red'); // same color, but not adjacent — must stay out of the mask
  const selection = selectWandContiguous(cells, 0, 0, 10, 10, peyoteNeighborsAt10Cols);
  assert.ok(!selection.mask.has('4,4'));
  assert.deepEqual(selection.mask, new Set(['0,0']));
});

test('selectWandContiguous: seeding from an empty cell selects the connected empty region only', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 2, 2, 'red');
  // (0,1),(0,2),(1,1),(1,2) all left absent/connected within a bordered 3x3 grid.
  const selection = selectWandContiguous(cells, 1, 1, 3, 3, (row, col) => peyoteNeighbors(row, col, 3));
  assert.ok(selection.mask.has('1,1'));
  assert.ok(!selection.mask.has('0,0'));
  assert.ok(!selection.mask.has('2,2'));
});

test('selectWandGlobal: selects every cell of a color anywhere in the design, ignoring adjacency', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 1, 'blue');
  setCell(cells, 9, 9, 'red'); // far away, non-adjacent — must still be included
  const selection = selectWandGlobal(cells, 'red');
  assert.deepEqual(selection, {
    rowStart: 0, rowEnd: 9, colStart: 0, colEnd: 9, mask: new Set(['0,0', '9,9']),
  });
});

test('selectWandGlobal: a color used nowhere in the design returns null', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  assert.equal(selectWandGlobal(cells, 'blue'), null);
});

test('selectWandGlobal: matches an explicit null colorId (occupied-but-unassigned colorway cells)', () => {
  const cells = new Map();
  setCell(cells, 0, 0, null);
  setCell(cells, 1, 1, 'red');
  const selection = selectWandGlobal(cells, null);
  assert.deepEqual(selection.mask, new Set(['0,0']));
});
