import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPatternsUsingColor } from '../../palette/colorUsage.js';

function design(id, name, colorways) {
  return { id, name, colorways };
}

test('a color referenced in one design\'s one colorway (one layer) returns one result with that design\'s name', () => {
  const designs = [
    design('d1', 'Design One', [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'red']] } }]),
  ];
  const results = findPatternsUsingColor(designs, 'red');
  assert.deepEqual(results, [{ designId: 'd1', designName: 'Design One', colorwayNames: ['Colorway 1'] }]);
});

test('a color referenced only on a non-active layer of a colorway is still found', () => {
  const designs = [
    design('d1', 'Design One', [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [], l2: [['0,0', 'red']] } }]),
  ];
  const results = findPatternsUsingColor(designs, 'red');
  assert.deepEqual(results, [{ designId: 'd1', designName: 'Design One', colorwayNames: ['Colorway 1'] }]);
});

test('a color referenced in two of one design\'s colorways returns one result with both colorway names', () => {
  const designs = [
    design('d1', 'Design One', [
      { id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'red']] } },
      { id: 'cw2', name: 'Colorway 2', layerColorEntries: { l1: [['0,0', 'red']] } },
    ]),
  ];
  const results = findPatternsUsingColor(designs, 'red');
  assert.deepEqual(results, [{ designId: 'd1', designName: 'Design One', colorwayNames: ['Colorway 1', 'Colorway 2'] }]);
});

test('a color referenced across two different designs returns two results', () => {
  const designs = [
    design('d1', 'Design One', [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'red']] } }]),
    design('d2', 'Design Two', [{ id: 'cw2', name: 'Colorway 1', layerColorEntries: { l1: [['1,1', 'red']] } }]),
  ];
  const results = findPatternsUsingColor(designs, 'red');
  assert.deepEqual(results, [
    { designId: 'd1', designName: 'Design One', colorwayNames: ['Colorway 1'] },
    { designId: 'd2', designName: 'Design Two', colorwayNames: ['Colorway 1'] },
  ]);
});

test('a color referenced nowhere returns an empty array', () => {
  const designs = [
    design('d1', 'Design One', [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'blue']] } }]),
  ];
  assert.deepEqual(findPatternsUsingColor(designs, 'red'), []);
});

test('liveState: a color absent from the stale designs entry but present in the open design\'s live cells is still found', () => {
  const designs = [
    design('d1', 'Design One', [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [] } }]),
  ];
  const liveState = {
    currentDesignId: 'd1',
    colorways: [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [] } }],
    activeColorwayId: 'cw1',
    activeLayerId: 'l1',
    cells: new Map([['0,0', { colorId: 'red' }]]),
  };
  const results = findPatternsUsingColor(designs, 'red', liveState);
  assert.deepEqual(results, [{ designId: 'd1', designName: 'Design One', colorwayNames: ['Colorway 1'] }]);
});

test('liveState: a color present in the stale designs entry but erased from the open design\'s live cells is not found', () => {
  const designs = [
    design('d1', 'Design One', [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'red']] } }]),
  ];
  const liveState = {
    currentDesignId: 'd1',
    colorways: [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'red']] } }],
    activeColorwayId: 'cw1',
    activeLayerId: 'l1',
    cells: new Map([['0,0', { colorId: null }]]),
  };
  assert.deepEqual(findPatternsUsingColor(designs, 'red', liveState), []);
});

test('liveState only substitutes the active layer\'s slice — a color on a different, non-active layer of the same colorway is still found', () => {
  const designs = [
    design('d1', 'Design One', [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [], l2: [['0,0', 'red']] } }]),
  ];
  const liveState = {
    currentDesignId: 'd1',
    colorways: [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [], l2: [['0,0', 'red']] } }],
    activeColorwayId: 'cw1',
    activeLayerId: 'l1',
    cells: new Map(), // active layer (l1) has nothing live drawn
  };
  const results = findPatternsUsingColor(designs, 'red', liveState);
  assert.deepEqual(results, [{ designId: 'd1', designName: 'Design One', colorwayNames: ['Colorway 1'] }]);
});

test('liveState for a different currentDesignId leaves every checked design on its own stored colorways', () => {
  const designs = [
    design('d1', 'Design One', [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'red']] } }]),
  ];
  const liveState = {
    currentDesignId: 'd2',
    colorways: [{ id: 'cwX', name: 'Colorway X', layerColorEntries: { l1: [] } }],
    activeColorwayId: 'cwX',
    activeLayerId: 'l1',
    cells: new Map(),
  };
  const results = findPatternsUsingColor(designs, 'red', liveState);
  assert.deepEqual(results, [{ designId: 'd1', designName: 'Design One', colorwayNames: ['Colorway 1'] }]);
});
