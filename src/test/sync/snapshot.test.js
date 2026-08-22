import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleSnapshot, planRestore, SNAPSHOT_VERSION } from '../../sync/snapshot.js';

const designWithColorways = {
  id: 'd1', name: 'Already migrated', beadTypeKey: 'delica11', rows: 2, cols: 2,
  shapeEntries: ['0,0'],
  colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
  activeColorwayId: 'cw1', order: 0, axisVersion: 2,
};

const legacyDesign = {
  id: 'd2', name: 'Legacy', beadTypeKey: 'delica11', rows: 2, cols: 2,
  cellEntries: [['0,0', { colorId: 'blue' }]], order: 1,
};

test('assembleSnapshot: wraps the four store lists with a version and timestamp', () => {
  const snapshot = assembleSnapshot({
    designs: [designWithColorways],
    preferences: { id: 'global', units: 'mm' },
    customColors: [{ id: 'c1' }],
    beadCatalog: [{ id: 'b1' }],
  });
  assert.equal(snapshot.snapshotVersion, SNAPSHOT_VERSION);
  assert.equal(typeof snapshot.exportedAt, 'number');
  assert.deepEqual(snapshot.designs, [designWithColorways]);
  assert.deepEqual(snapshot.customColors, [{ id: 'c1' }]);
  assert.deepEqual(snapshot.beadCatalog, [{ id: 'b1' }]);
});

test('planRestore: a design whose id is not already local is queued for creation', () => {
  const snapshot = assembleSnapshot({ designs: [designWithColorways], preferences: null, customColors: [], beadCatalog: [] });
  const plan = planRestore(snapshot, { designs: [], customColors: [], beadCatalog: [] });
  assert.deepEqual(plan.designsToCreate, [designWithColorways]);
  assert.deepEqual(plan.designsSkipped, []);
});

test('planRestore: a design whose id already exists locally is skipped, never overwritten', () => {
  const snapshot = assembleSnapshot({ designs: [designWithColorways], preferences: null, customColors: [], beadCatalog: [] });
  const localCopy = { ...designWithColorways, name: 'Locally renamed since backup' };
  const plan = planRestore(snapshot, { designs: [localCopy], customColors: [], beadCatalog: [] });
  assert.deepEqual(plan.designsToCreate, []);
  assert.equal(plan.designsSkipped.length, 1);
  assert.equal(plan.designsSkipped[0].id, 'd1');
});

// Confirms the row/col-axis migration (see .work/refactor-row-col-axis-naming-
// plan.md) applies through the restore path exactly like the local-boot path
// does — a pre-refactor-shaped design (already has colorways, but no
// axisVersion) pulled from a Drive/local-file backup must come back with its
// rows/cols and cell keys swapped, not just its legacy-colorway shape fixed.
test('planRestore: a pre-axis-refactor design in the snapshot gets its rows/cols and cell keys swapped before being queued', () => {
  const preRefactorDesign = {
    id: 'd9', name: 'From another device', beadTypeKey: 'delica11', rows: 5, cols: 12,
    shapeEntries: ['0,0', '2,7'],
    colorways: [{ id: 'cw9', name: 'Colorway 1', colorEntries: [['0,0', 'red'], ['2,7', 'blue']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw9', order: 0,
  };
  const snapshot = assembleSnapshot({ designs: [preRefactorDesign], preferences: null, customColors: [], beadCatalog: [] });
  const plan = planRestore(snapshot, { designs: [], customColors: [], beadCatalog: [] });

  assert.equal(plan.designsToCreate.length, 1);
  const migrated = plan.designsToCreate[0];
  assert.equal(migrated.rows, 12);
  assert.equal(migrated.cols, 5);
  assert.deepEqual(migrated.shapeEntries, ['0,0', '7,2']);
  assert.deepEqual(migrated.colorways[0].colorEntries, [['0,0', 'red'], ['7,2', 'blue']]);
  assert.equal(migrated.axisVersion, 2);
});

test('planRestore: a legacy (pre-colorways) design in the snapshot is migrated before being queued', () => {
  const snapshot = assembleSnapshot({ designs: [legacyDesign], preferences: null, customColors: [], beadCatalog: [] });
  const plan = planRestore(snapshot, { designs: [], customColors: [], beadCatalog: [] });
  assert.equal(plan.designsToCreate.length, 1);
  const migrated = plan.designsToCreate[0];
  assert.ok(migrated.colorways, 'migrated design should have colorways');
  assert.equal(migrated.cellEntries, undefined);
  assert.deepEqual(migrated.shapeEntries, ['0,0']);
});

test('planRestore: custom colors and bead catalog entries follow the same skip-existing-id rule', () => {
  const snapshot = assembleSnapshot({
    designs: [],
    preferences: null,
    customColors: [{ id: 'c1', name: 'Red' }, { id: 'c2', name: 'Blue' }],
    beadCatalog: [{ id: 'b1', name: 'Delica' }],
  });
  const plan = planRestore(snapshot, {
    designs: [],
    customColors: [{ id: 'c1', name: 'Red (local)' }],
    beadCatalog: [],
  });
  assert.deepEqual(plan.customColorsToCreate, [{ id: 'c2', name: 'Blue' }]);
  assert.equal(plan.customColorsSkipped.length, 1);
  assert.equal(plan.customColorsSkipped[0].id, 'c1');
  assert.deepEqual(plan.beadCatalogToCreate, [{ id: 'b1', name: 'Delica' }]);
  assert.deepEqual(plan.beadCatalogSkipped, []);
});

test('planRestore: preferences pass through as-is for the caller to decide whether to apply', () => {
  const snapshot = assembleSnapshot({ designs: [], preferences: { id: 'global', units: 'in' }, customColors: [], beadCatalog: [] });
  const plan = planRestore(snapshot, { designs: [], customColors: [], beadCatalog: [] });
  assert.deepEqual(plan.preferences, { id: 'global', units: 'in' });
});

test('planRestore: a snapshot with no preferences field yields null, not a crash', () => {
  const plan = planRestore({ designs: [] }, { designs: [], customColors: [], beadCatalog: [] });
  assert.equal(plan.preferences, null);
});

test('planRestore: an empty snapshot against an empty library produces an entirely empty plan', () => {
  const snapshot = assembleSnapshot({ designs: [], preferences: null, customColors: [], beadCatalog: [] });
  const plan = planRestore(snapshot, { designs: [], customColors: [], beadCatalog: [] });
  assert.deepEqual(plan.designsToCreate, []);
  assert.deepEqual(plan.customColorsToCreate, []);
  assert.deepEqual(plan.beadCatalogToCreate, []);
});
