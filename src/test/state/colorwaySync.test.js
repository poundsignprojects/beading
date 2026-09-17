import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeColorwayCells, decomposeCellsForSave, materializeLayerCells,
  composeVisibleLayers, pruneColorwayLayerToShape,
} from '../../state/colorwaySync.js';

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

test('materialize -> decompose round-trips a Map with no unassigned cells exactly', () => {
  const shapeEntries = ['0,0', '0,1', '0,2'];
  const colorEntries = [['0,0', 'red'], ['0,1', 'blue'], ['0,2', 'green']];
  const cells = materializeColorwayCells(shapeEntries, colorEntries);
  const result = decomposeCellsForSave(cells);
  assert.deepEqual(result.shapeEntries, shapeEntries);
  assert.deepEqual(result.colorEntries, colorEntries);
});

test('materializeLayerCells: rebuilds a layer against a colorway\'s own slice of layerColorEntries', () => {
  const layer = { id: 'l1', shapeEntries: ['0,0', '0,1'] };
  const colorway = { id: 'cw1', layerColorEntries: { l1: [['0,0', 'red']], l2: [['0,0', 'blue']] } };
  const cells = materializeLayerCells(layer, colorway);
  assert.deepEqual([...cells.entries()], [
    ['0,0', { colorId: 'red' }],
    ['0,1', { colorId: null }],
  ]);
});

test('materializeLayerCells: a layer with no slice at all in the colorway materializes as fully unassigned', () => {
  const layer = { id: 'l2', shapeEntries: ['0,0'] };
  const colorway = { id: 'cw1', layerColorEntries: { l1: [['0,0', 'red']] } };
  const cells = materializeLayerCells(layer, colorway);
  assert.deepEqual([...cells.entries()], [['0,0', { colorId: null }]]);
});

test('composeVisibleLayers: two non-overlapping visible layers merge into one flat Map', () => {
  const layers = [
    { id: 'l1', visible: true, order: 0, shapeEntries: ['0,0'] },
    { id: 'l2', visible: true, order: 1, shapeEntries: ['0,1'] },
  ];
  const colorway = { id: 'cw1', layerColorEntries: { l1: [['0,0', 'red']], l2: [['0,1', 'blue']] } };
  const flat = composeVisibleLayers(layers, colorway);
  assert.deepEqual([...flat.entries()].sort(), [
    ['0,0', { colorId: 'red' }],
    ['0,1', { colorId: 'blue' }],
  ]);
});

test('composeVisibleLayers: an overlapping cell is won by the topmost (highest order) layer', () => {
  const layers = [
    { id: 'bottom', visible: true, order: 0, shapeEntries: ['0,0'] },
    { id: 'top', visible: true, order: 1, shapeEntries: ['0,0'] },
  ];
  const colorway = { id: 'cw1', layerColorEntries: { bottom: [['0,0', 'red']], top: [['0,0', 'blue']] } };
  const flat = composeVisibleLayers(layers, colorway);
  assert.deepEqual(flat.get('0,0'), { colorId: 'blue' });
});

test('composeVisibleLayers: a hidden layer is excluded by default (visibleOnly true), leaving the cell it would have covered showing through from below', () => {
  const layers = [
    { id: 'bottom', visible: true, order: 0, shapeEntries: ['0,0'] },
    { id: 'top', visible: false, order: 1, shapeEntries: ['0,0'] },
  ];
  const colorway = { id: 'cw1', layerColorEntries: { bottom: [['0,0', 'red']], top: [['0,0', 'blue']] } };
  const flat = composeVisibleLayers(layers, colorway);
  assert.deepEqual(flat.get('0,0'), { colorId: 'red' });
});

test('composeVisibleLayers: hiding every layer produces an empty Map', () => {
  const layers = [
    { id: 'l1', visible: false, order: 0, shapeEntries: ['0,0'] },
    { id: 'l2', visible: false, order: 1, shapeEntries: ['0,1'] },
  ];
  const colorway = { id: 'cw1', layerColorEntries: { l1: [], l2: [] } };
  const flat = composeVisibleLayers(layers, colorway);
  assert.equal(flat.size, 0);
});

test('composeVisibleLayers: visibleOnly false includes a hidden layer too', () => {
  const layers = [{ id: 'l1', visible: false, order: 0, shapeEntries: ['0,0'] }];
  const colorway = { id: 'cw1', layerColorEntries: { l1: [['0,0', 'red']] } };
  const flat = composeVisibleLayers(layers, colorway, { visibleOnly: false });
  assert.deepEqual(flat.get('0,0'), { colorId: 'red' });
});

test('composeVisibleLayers: overrideLayerId/overrideCells substitute a layer\'s live, not-yet-saved cells', () => {
  const layers = [{ id: 'l1', visible: true, order: 0, shapeEntries: ['0,0'] }]; // stale shape
  const colorway = { id: 'cw1', layerColorEntries: { l1: [['0,0', 'red']] } };
  const liveCells = new Map([['0,0', { colorId: 'green' }], ['0,1', { colorId: 'yellow' }]]);
  const flat = composeVisibleLayers(layers, colorway, { overrideLayerId: 'l1', overrideCells: liveCells });
  assert.deepEqual([...flat.entries()].sort(), [
    ['0,0', { colorId: 'green' }],
    ['0,1', { colorId: 'yellow' }],
  ]);
});

test('pruneColorwayLayerToShape: drops out-of-shape entries for the given layer only, across every colorway, leaving other layers/colorways untouched', () => {
  const colorways = [
    { id: 'cw1', layerColorEntries: { l1: [['0,0', 'red'], ['1,1', 'blue']], l2: [['9,9', 'green']] } },
    { id: 'cw2', layerColorEntries: { l1: [['0,0', 'pink']] } },
  ];
  const pruned = pruneColorwayLayerToShape(colorways, 'l1', ['0,0']);
  assert.deepEqual(pruned[0].layerColorEntries.l1, [['0,0', 'red']]);
  assert.deepEqual(pruned[0].layerColorEntries.l2, [['9,9', 'green']]); // untouched — different layer
  assert.deepEqual(pruned[1].layerColorEntries.l1, [['0,0', 'pink']]);
});
