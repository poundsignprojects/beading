import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remapColorwayColorIds } from '../../state/beadTypeConversion.js';

test('remaps every colorEntries colorId through the mapping table', () => {
  const colorways = [
    { id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red'], ['0,1', 'blue']] },
  ];
  const mappingTable = new Map([['red', 'newRed'], ['blue', 'newBlue']]);
  const result = remapColorwayColorIds(colorways, mappingTable);
  assert.deepEqual(result, [
    { id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'newRed'], ['0,1', 'newBlue']] },
  ]);
});

test('remaps across multiple colorways independently', () => {
  const colorways = [
    { id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']] },
    { id: 'cw2', name: 'Colorway 2', colorEntries: [['0,0', 'blue']] },
  ];
  const mappingTable = new Map([['red', 'newRed'], ['blue', 'newBlue']]);
  const result = remapColorwayColorIds(colorways, mappingTable);
  assert.equal(result[0].colorEntries[0][1], 'newRed');
  assert.equal(result[1].colorEntries[0][1], 'newBlue');
});

test('a colorId with no entry in the mapping table passes through unchanged', () => {
  const colorways = [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'orphan']] }];
  const result = remapColorwayColorIds(colorways, new Map());
  assert.deepEqual(result, colorways);
});

test('does not mutate the input colorways', () => {
  const colorways = [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']] }];
  remapColorwayColorIds(colorways, new Map([['red', 'newRed']]));
  assert.equal(colorways[0].colorEntries[0][1], 'red');
});
