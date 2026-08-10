import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateDesign } from '../../storage/migrateDesign.js';

test('migrateDesign: a legacy cellEntries record produces a single colorway matching the old data exactly', () => {
  const record = {
    id: 'd1',
    name: 'Legacy',
    beadTypeKey: 'delica11',
    rows: 3,
    cols: 3,
    cellEntries: [['0,0', { colorId: 'red' }], ['1,1', { colorId: 'blue' }]],
    order: 0,
  };
  const migrated = migrateDesign(record);

  assert.deepEqual(migrated.shapeEntries, ['0,0', '1,1']);
  assert.equal(migrated.colorways.length, 1);
  assert.deepEqual(migrated.colorways[0].colorEntries, [['0,0', 'red'], ['1,1', 'blue']]);
  assert.equal(migrated.activeColorwayId, migrated.colorways[0].id);
  assert.equal(migrated.cellEntries, undefined);
  assert.equal(migrated.name, 'Legacy');
});

test('migrateDesign: a record that already has colorways passes through unchanged', () => {
  const record = {
    id: 'd2',
    shapeEntries: ['0,0'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
  };
  const migrated = migrateDesign(record);
  assert.deepEqual(migrated, record);
});

test('migrateDesign: an empty legacy design migrates to a colorway with empty colorEntries and an empty shape', () => {
  const record = { id: 'd3', name: 'Empty', beadTypeKey: 'delica11', rows: 5, cols: 5, cellEntries: [], order: 0 };
  const migrated = migrateDesign(record);
  assert.deepEqual(migrated.shapeEntries, []);
  assert.deepEqual(migrated.colorways[0].colorEntries, []);
});
