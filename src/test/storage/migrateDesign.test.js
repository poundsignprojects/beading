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

test('migrateDesign: an empty legacy design migrates to a colorway with empty colorEntries and an empty shape', () => {
  const record = { id: 'd3', name: 'Empty', beadTypeKey: 'delica11', rows: 5, cols: 5, cellEntries: [], order: 0 };
  const migrated = migrateDesign(record);
  assert.deepEqual(migrated.shapeEntries, []);
  assert.deepEqual(migrated.colorways[0].colorEntries, []);
});

// axisVersion: 2 marks a record already past the row/col-axis rename (see
// .work/refactor-row-col-axis-naming-plan.md) — a record without it is
// assumed pre-refactor-shaped and gets its rows/cols and every cell key
// swapped exactly once.

test('migrateDesign: a pre-refactor record (no axisVersion, already has colorways) gets rows/cols and every cell key swapped', () => {
  const record = {
    id: 'd4',
    name: 'Pre-refactor',
    beadTypeKey: 'delica11',
    rows: 7,
    cols: 20,
    shapeEntries: ['0,0', '2,5', '6,19'],
    colorways: [{
      id: 'cw1',
      name: 'Colorway 1',
      colorEntries: [['0,0', 'red'], ['2,5', 'blue']],
      createdAt: 1,
      updatedAt: 1,
    }],
    activeColorwayId: 'cw1',
  };
  const migrated = migrateDesign(record);

  assert.equal(migrated.rows, 20);
  assert.equal(migrated.cols, 7);
  assert.deepEqual(migrated.shapeEntries, ['0,0', '5,2', '19,6']);
  assert.deepEqual(migrated.colorways[0].colorEntries, [['0,0', 'red'], ['5,2', 'blue']]);
  assert.equal(migrated.axisVersion, 2);
});

test('migrateDesign: a record already at axisVersion 2 passes through with rows/cols/keys untouched', () => {
  const record = {
    id: 'd5',
    rows: 20,
    cols: 7,
    shapeEntries: ['0,0', '5,2'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.deepEqual(migrated, record);
});

test('migrateDesign: running the migration twice on the same pre-refactor record is idempotent (no double-swap)', () => {
  const record = {
    id: 'd6',
    rows: 7,
    cols: 20,
    shapeEntries: ['3,4'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['3,4', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
  };
  const once = migrateDesign(record);
  const twice = migrateDesign(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.rows, 20);
  assert.equal(twice.cols, 7);
  assert.deepEqual(twice.shapeEntries, ['4,3']);
});

test('migrateDesign: a legacy cellEntries record (no colorways at all) gets both the colorway wrap and the axis swap applied, in that order', () => {
  const record = {
    id: 'd7',
    name: 'Legacy asymmetric',
    beadTypeKey: 'delica11',
    rows: 7,
    cols: 20,
    cellEntries: [['0,0', { colorId: 'red' }], ['2,5', { colorId: 'blue' }]],
    order: 0,
  };
  const migrated = migrateDesign(record);

  // Legacy-wrap runs first (shapeEntries/colorways now exist), then the axis
  // swap operates on the now-current shapeEntries/colorways shape.
  assert.equal(migrated.rows, 20);
  assert.equal(migrated.cols, 7);
  assert.deepEqual(migrated.shapeEntries, ['0,0', '5,2']);
  assert.deepEqual(migrated.colorways[0].colorEntries, [['0,0', 'red'], ['5,2', 'blue']]);
  assert.equal(migrated.axisVersion, 2);
  assert.equal(migrated.cellEntries, undefined);
});
