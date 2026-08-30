import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClipboard, applyEraseRegion, applyPaste, rotateClipboard } from '../../tools/cutCopyTool.js';
import { setCell } from '../../state/cellStore.js';

test('buildClipboard: mixed occupied/absent selection produces relative coords, omits absent', () => {
  const cells = new Map();
  setCell(cells, 5, 5, 'red');
  setCell(cells, 6, 6, 'blue');
  // (5,6) and (6,5) left absent within the 2x2 selection.
  const clipboard = buildClipboard(cells, { rowStart: 5, rowEnd: 6, colStart: 5, colEnd: 6 });
  assert.equal(clipboard.rows, 2);
  assert.equal(clipboard.cols, 2);
  const sorted = [...clipboard.cells].sort();
  assert.deepEqual(sorted, [[0, 0, 'red'], [1, 1, 'blue']].sort());
});

test('buildClipboard -> applyPaste round-trip at the same anchor reproduces the region', () => {
  const cells = new Map();
  setCell(cells, 5, 5, 'red');
  setCell(cells, 6, 6, 'blue');
  const selection = { rowStart: 5, rowEnd: 6, colStart: 5, colEnd: 6 };
  const clipboard = buildClipboard(cells, selection);

  const target = new Map();
  applyPaste(target, clipboard, 5, 5, 20, 20);
  assert.equal(target.get('5,5').colorId, 'red');
  assert.equal(target.get('6,6').colorId, 'blue');
  assert.equal(target.size, 2);
});

test('applyPaste: clips entries landing outside grid bounds without shifting the rest', () => {
  const clipboard = { rows: 2, cols: 2, cells: [[0, 0, 'red'], [1, 1, 'blue']] };
  const target = new Map();
  // Anchor so (1,1) relative lands at row 5 (out of a 5-row grid, valid rows 0-4).
  const patch = applyPaste(target, clipboard, 4, 0, 5, 5);
  assert.equal(target.get('4,0').colorId, 'red');
  assert.equal(target.has('5,1'), false);
  assert.equal(patch.length, 1);
});

test('applyPaste: mode "behind" skips already-occupied targets, fills empty ones, and omits skipped cells from the patch', () => {
  const target = new Map();
  setCell(target, 4, 0, 'green'); // pre-existing, should survive untouched
  const clipboard = { rows: 2, cols: 2, cells: [[0, 0, 'red'], [0, 1, 'blue']] };
  // Anchor so relative (0,0) -> (4,0) [occupied] and (0,1) -> (4,1) [empty].
  const patch = applyPaste(target, clipboard, 4, 0, 20, 20, 'behind');
  assert.equal(target.get('4,0').colorId, 'green'); // untouched
  assert.equal(target.get('4,1').colorId, 'blue'); // filled
  assert.equal(patch.length, 1);
  assert.deepEqual(patch[0], { row: 4, col: 1, before: undefined, after: { colorId: 'blue' } });
});

test('applyPaste: mode "front" (explicit and default) both overwrite an occupied target, reproducing the existing fixture', () => {
  const clipboard = { rows: 1, cols: 1, cells: [[0, 0, 'red']] };
  for (const args of [[], ['front']]) {
    const target = new Map();
    setCell(target, 4, 0, 'green');
    const patch = applyPaste(target, clipboard, 4, 0, 20, 20, ...args);
    assert.equal(target.get('4,0').colorId, 'red');
    assert.equal(patch.length, 1);
    assert.deepEqual(patch[0], { row: 4, col: 0, before: { colorId: 'green' }, after: { colorId: 'red' } });
  }
});

test('applyEraseRegion: only touches occupied cells within bounds, patch matches fixture', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 1, 1, 'blue');
  setCell(cells, 9, 9, 'green'); // outside selection, must survive
  const patch = applyEraseRegion(cells, { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 });
  const sorted = patch.slice().sort((a, b) => a.row - b.row);
  assert.deepEqual(sorted, [
    { row: 0, col: 0, before: { colorId: 'red' }, after: undefined },
    { row: 1, col: 1, before: { colorId: 'blue' }, after: undefined },
  ]);
  assert.equal(cells.has('0,0'), false);
  assert.equal(cells.has('1,1'), false);
  assert.equal(cells.get('9,9').colorId, 'green');
});

test('rotateClipboard: cw swaps rows/cols dimensions and matches rotateGrid.js\'s hand-derived coordinates', () => {
  const clipboard = { rows: 2, cols: 3, cells: [[0, 0, 'a'], [1, 2, 'b']] };
  const rotated = rotateClipboard(clipboard, 'cw');
  assert.equal(rotated.rows, 3);
  assert.equal(rotated.cols, 2);
  const sorted = [...rotated.cells].sort();
  assert.deepEqual(sorted, [[0, 1, 'a'], [2, 0, 'b']].sort());
});

test('rotateClipboard: ccw swaps dimensions the other way', () => {
  const clipboard = { rows: 2, cols: 3, cells: [[0, 0, 'a'], [1, 2, 'b']] };
  const rotated = rotateClipboard(clipboard, 'ccw');
  assert.equal(rotated.rows, 3);
  assert.equal(rotated.cols, 2);
  const sorted = [...rotated.cells].sort();
  assert.deepEqual(sorted, [[2, 0, 'a'], [0, 1, 'b']].sort());
});

test('rotateClipboard: 180 leaves dimensions unchanged and reflects both axes', () => {
  const clipboard = { rows: 2, cols: 3, cells: [[0, 0, 'a'], [1, 2, 'b']] };
  const rotated = rotateClipboard(clipboard, '180');
  assert.equal(rotated.rows, 2);
  assert.equal(rotated.cols, 3);
  const sorted = [...rotated.cells].sort();
  assert.deepEqual(sorted, [[1, 2, 'a'], [0, 0, 'b']].sort());
});

test('rotateClipboard: cw four times returns to the original clipboard', () => {
  let clipboard = { rows: 2, cols: 3, cells: [[0, 0, 'a'], [1, 2, 'b']] };
  for (let i = 0; i < 4; i++) clipboard = rotateClipboard(clipboard, 'cw');
  assert.equal(clipboard.rows, 2);
  assert.equal(clipboard.cols, 3);
  const sorted = [...clipboard.cells].sort();
  assert.deepEqual(sorted, [[0, 0, 'a'], [1, 2, 'b']].sort());
});

test('rotateClipboard -> applyPaste: a rotated clipboard still pastes correctly into a fresh grid', () => {
  const clipboard = { rows: 1, cols: 2, cells: [[0, 0, 'red'], [0, 1, 'blue']] };
  const rotated = rotateClipboard(clipboard, 'cw'); // becomes 2 rows x 1 col
  assert.equal(rotated.rows, 2);
  assert.equal(rotated.cols, 1);
  const target = new Map();
  applyPaste(target, rotated, 3, 3, 10, 10);
  assert.equal(target.get('3,3').colorId, 'red');
  assert.equal(target.get('4,3').colorId, 'blue');
  assert.equal(target.size, 2);
});
