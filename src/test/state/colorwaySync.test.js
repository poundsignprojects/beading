import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materializeColorwayCells, decomposeCellsForSave, pruneColorwaysToShape } from '../../state/colorwaySync.js';

test('materializeColorwayCells: fills every shape key, defaulting to colorId null when missing from colorEntries', () => {
  const cells = materializeColorwayCells(['0,0', '0,1', '0,2'], [['0,0', 'red']]);
  assert.deepEqual([...cells.entries()], [
    ['0,0', { colorId: 'red' }],
    ['0,1', { colorId: null }],
    ['0,2', { colorId: null }],
  ]);
});

test('decomposeCellsForSave: splits a mixed Map into shapeEntries and colorEntries, excluding null entries from colorEntries', () => {
  const cells = new Map([
    ['0,0', { colorId: 'red' }],
    ['0,1', { colorId: null }],
    ['0,2', { colorId: 'blue' }],
  ]);
  const { shapeEntries, colorEntries } = decomposeCellsForSave(cells);
  assert.deepEqual(shapeEntries, ['0,0', '0,1', '0,2']);
  assert.deepEqual(colorEntries, [['0,0', 'red'], ['0,2', 'blue']]);
});

test('pruneColorwaysToShape: drops out-of-shape entries and leaves in-shape ones untouched', () => {
  const colorways = [
    { id: 'a', colorEntries: [['0,0', 'red'], ['1,1', 'blue']] },
    { id: 'b', colorEntries: [['0,0', 'green']] },
  ];
  const pruned = pruneColorwaysToShape(colorways, ['0,0']);
  assert.deepEqual(pruned[0].colorEntries, [['0,0', 'red']]);
  assert.deepEqual(pruned[1].colorEntries, [['0,0', 'green']]);
});

test('materialize -> decompose round-trips a Map with no unassigned cells exactly', () => {
  const shapeEntries = ['0,0', '0,1', '0,2'];
  const colorEntries = [['0,0', 'red'], ['0,1', 'blue'], ['0,2', 'green']];
  const cells = materializeColorwayCells(shapeEntries, colorEntries);
  const result = decomposeCellsForSave(cells);
  assert.deepEqual(result.shapeEntries, shapeEntries);
  assert.deepEqual(result.colorEntries, colorEntries);
});
