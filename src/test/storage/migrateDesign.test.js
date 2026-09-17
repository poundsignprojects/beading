import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateDesign } from '../../storage/migrateDesign.js';

test('migrateDesign: a legacy cellEntries record produces a single colorway/single layer matching the old data exactly', () => {
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

  assert.equal(migrated.colorways.length, 1);
  const cw = migrated.colorways[0];
  assert.equal(cw.layers.length, 1);
  assert.deepEqual(cw.layers[0].shapeEntries, ['0,0', '1,1']);
  assert.equal(cw.activeLayerId, cw.layers[0].id);
  assert.deepEqual(cw.layers[0].colorEntries, [['0,0', 'red'], ['1,1', 'blue']]);
  assert.equal(migrated.activeColorwayId, cw.id);
  assert.equal(migrated.cellEntries, undefined);
  assert.equal(migrated.shapeEntries, undefined);
  assert.equal(migrated.layers, undefined);
  assert.equal(migrated.activeLayerId, undefined);
  assert.equal(migrated.name, 'Legacy');
});

test('migrateDesign: an empty legacy design migrates to a colorway/layer with empty entries and an empty shape', () => {
  const record = { id: 'd3', name: 'Empty', beadTypeKey: 'delica11', rows: 5, cols: 5, cellEntries: [], order: 0 };
  const migrated = migrateDesign(record);
  const cw = migrated.colorways[0];
  assert.deepEqual(cw.layers[0].shapeEntries, []);
  assert.deepEqual(cw.layers[0].colorEntries, []);
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
  const cw = migrated.colorways[0];
  assert.deepEqual(cw.layers[0].shapeEntries, ['0,0', '5,2', '19,6']);
  assert.deepEqual(cw.layers[0].colorEntries, [['0,0', 'red'], ['5,2', 'blue']]);
  assert.equal(migrated.axisVersion, 2);
  assert.equal(migrated.staggerFlipped, true); // post-swap cols is 7, odd
});

test('migrateDesign: a record already fully migrated (axisVersion 2, staggerFlipped/stitchType/dropCount/per-colorway layers set) passes through with everything untouched', () => {
  const record = {
    id: 'd5',
    rows: 20,
    cols: 7,
    staggerFlipped: true,
    stitchType: 'square',
    dropCount: 1,
    colorways: [{
      id: 'cw1',
      name: 'Colorway 1',
      activeLayerId: 'l1',
      layers: [{ id: 'l1', name: 'Layer 1', visible: true, order: 0, shapeEntries: ['0,0', '5,2'], colorEntries: [['0,0', 'red']] }],
      createdAt: 1,
      updatedAt: 1,
    }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.deepEqual(migrated, record);
});

test('migrateDesign: running the migration twice on the same pre-refactor record is idempotent (no double-swap, no re-flip, no re-wrap into layers)', () => {
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
  assert.deepEqual(twice.colorways[0].layers[0].shapeEntries, ['4,3']);
  assert.equal(twice.staggerFlipped, true); // post-swap cols is 7, odd
});

test('migrateDesign: a legacy cellEntries record (no colorways at all) gets the colorway wrap, axis swap, stagger flip, and per-colorway layer wrap all applied, in that order', () => {
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
  // swap operates on the now-current shapeEntries/colorways shape, then the
  // stagger flip is computed from the post-swap cols value, then the layer
  // wraps (shared, then per-colorway) fold shapeEntries into a single default
  // layer owned by the one colorway.
  assert.equal(migrated.rows, 20);
  assert.equal(migrated.cols, 7);
  const cw = migrated.colorways[0];
  assert.deepEqual(cw.layers[0].shapeEntries, ['0,0', '5,2']);
  assert.deepEqual(cw.layers[0].colorEntries, [['0,0', 'red'], ['5,2', 'blue']]);
  assert.equal(migrated.axisVersion, 2);
  assert.equal(migrated.cellEntries, undefined);
  assert.equal(migrated.staggerFlipped, true); // post-swap cols is 7, odd
});

// migrateStaggerFlip specifically: gated on staggerFlipped's own presence, not
// axisVersion — a record can already be axisVersion: 2 (migrated by a session
// before this step existed) with no staggerFlipped value at all. Value is
// derived from the post-axis-swap cols count: odd needs the flip (to match
// the pre-existing rendering), even needs none.

test('migrateDesign: a record already at axisVersion 2 but missing staggerFlipped gets it computed from the (unswapped, already-correct) cols value — even cols, no flip', () => {
  const record = {
    id: 'd8',
    rows: 5,
    cols: 8, // even — no flip needed
    shapeEntries: ['0,0'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.equal(migrated.rows, 5); // axisVersion already 2 — untouched
  assert.equal(migrated.cols, 8);
  assert.equal(migrated.staggerFlipped, false);
});

test('migrateDesign: a record already at axisVersion 2 but missing staggerFlipped gets it computed — odd cols, flip needed', () => {
  const record = {
    id: 'd9',
    rows: 5,
    cols: 9, // odd — flip needed
    shapeEntries: ['0,0'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.equal(migrated.staggerFlipped, true);
});

test('migrateDesign: staggerFlipped explicitly false is left alone, not recomputed', () => {
  const record = {
    id: 'd10',
    rows: 5,
    cols: 9, // odd, but staggerFlipped is already explicitly set — must not be overridden
    staggerFlipped: false,
    stitchType: 'peyote',
    dropCount: 1,
    colorways: [{
      id: 'cw1',
      name: 'Colorway 1',
      activeLayerId: 'l1',
      layers: [{ id: 'l1', name: 'Layer 1', visible: true, order: 0, shapeEntries: ['0,0'], colorEntries: [['0,0', 'red']] }],
      createdAt: 1,
      updatedAt: 1,
    }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.equal(migrated.staggerFlipped, false);
  assert.deepEqual(migrated, record); // fully migrated already — passes through untouched
});

// migrateStitchType specifically: gated on stitchType's own presence,
// independent of every other step's own gate — a record can already be fully
// migrated on every earlier axis/every earlier gate before this step existed.

test('migrateDesign: a record with no stitchType field gets stamped "peyote" (every design before square stitch existed was implicitly peyote)', () => {
  const record = {
    id: 'd11',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    shapeEntries: ['0,0'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.equal(migrated.stitchType, 'peyote');
});

test('migrateDesign: an explicit stitchType of "square" is left alone, not overridden to "peyote"', () => {
  const record = {
    id: 'd12',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    stitchType: 'square',
    shapeEntries: ['0,0'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.equal(migrated.stitchType, 'square');
});

test('migrateDesign: running the migration twice is idempotent for stitchType too', () => {
  const record = {
    id: 'd13',
    rows: 7,
    cols: 20,
    shapeEntries: ['3,4'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['3,4', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
  };
  const once = migrateDesign(record);
  const twice = migrateDesign(once);
  assert.equal(once.stitchType, 'peyote');
  assert.deepEqual(twice, once);
});

// migrateDropCount specifically (.work/feature-multi-drop-peyote-plan.md):
// gated on dropCount's own presence, independent of every other step's own
// gate — same convention as migrateStitchType above.

test('migrateDesign: a record with no dropCount field gets stamped 1 (every design before multi-drop peyote existed was implicitly 1-drop)', () => {
  const record = {
    id: 'd14',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    stitchType: 'peyote',
    shapeEntries: ['0,0'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.equal(migrated.dropCount, 1);
});

test('migrateDesign: an explicit dropCount of 3 is left alone, not overridden to 1', () => {
  const record = {
    id: 'd15',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    stitchType: 'peyote',
    dropCount: 3,
    shapeEntries: ['0,0'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.equal(migrated.dropCount, 3);
});

test('migrateDesign: a record already at axisVersion 2 with stitchType/staggerFlipped set but no dropCount at all (the real "already ran a session before this feature existed" scenario) gets dropCount stamped without disturbing anything else', () => {
  const record = {
    id: 'd16',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    stitchType: 'peyote',
    shapeEntries: ['0,0'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.equal(migrated.dropCount, 1);
  assert.equal(migrated.rows, 5);
  assert.equal(migrated.cols, 8);
  assert.equal(migrated.staggerFlipped, false);
  assert.equal(migrated.stitchType, 'peyote');
});

test('migrateDesign: running the migration twice is idempotent for dropCount too', () => {
  const record = {
    id: 'd17',
    rows: 7,
    cols: 20,
    shapeEntries: ['3,4'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['3,4', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
  };
  const once = migrateDesign(record);
  const twice = migrateDesign(once);
  assert.equal(once.dropCount, 1);
  assert.deepEqual(twice, once);
});

// migrateLayers + migrateLayersPerColorway specifically: a record with no
// `layers` field at all skips straight through both (nothing to fold —
// covered by the cases above, which all end up on the final per-colorway
// shape). The cases below specifically exercise a record that's already on
// the OLD shared-layers shape (top-level `layers`/`activeLayerId`, each
// colorway holding only `layerColorEntries`) — the shape every design was in
// between the layers feature shipping and .work/feature-per-colorway-
// layers-plan.md's implementation.

test('migrateDesign: a record with no layers field at all folds shapeEntries into one default layer owned by each colorway, with that colorway\'s own colors', () => {
  const record = {
    id: 'd18',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    stitchType: 'peyote',
    dropCount: 1,
    shapeEntries: ['0,0', '1,1'],
    colorways: [
      { id: 'cw1', name: 'Colorway 1', colorEntries: [['0,0', 'red']], createdAt: 1, updatedAt: 1 },
      { id: 'cw2', name: 'Colorway 2', colorEntries: [['0,0', 'blue'], ['1,1', 'green']], createdAt: 1, updatedAt: 1 },
    ],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);

  assert.equal(migrated.layers, undefined);
  assert.equal(migrated.activeLayerId, undefined);
  assert.equal(migrated.shapeEntries, undefined);

  const cw1 = migrated.colorways[0];
  const cw2 = migrated.colorways[1];
  assert.equal(cw1.layers.length, 1);
  assert.equal(cw1.layers[0].name, 'Layer 1');
  assert.equal(cw1.layers[0].visible, true);
  assert.equal(cw1.layers[0].order, 0);
  assert.deepEqual(cw1.layers[0].shapeEntries, ['0,0', '1,1']);
  assert.equal(cw1.activeLayerId, cw1.layers[0].id);
  assert.deepEqual(cw1.layers[0].colorEntries, [['0,0', 'red']]);
  assert.equal(cw1.colorEntries, undefined);

  // Every colorway got its OWN layer object (a real, independent copy — the
  // whole point of .work/feature-per-colorway-layers-plan.md) — ids happen to
  // match here (both trace back to the same single implicit pre-layers
  // layer, so there's no prior separate identity to preserve either way),
  // but they must not be the SAME object, so editing one later can never
  // reach into the other.
  assert.notEqual(cw1.layers[0], cw2.layers[0]);
  assert.deepEqual(cw2.layers[0].shapeEntries, ['0,0', '1,1']);
  assert.deepEqual(cw2.layers[0].colorEntries, [['0,0', 'blue'], ['1,1', 'green']]);
  assert.equal(cw2.activeLayerId, cw2.layers[0].id);
});

test('migrateDesign: a record already on the old shared-layers shape (top-level layers/activeLayerId, per-colorway layerColorEntries) converts to per-colorway layers, keeping the same layer ids and the same activeLayerId on every colorway', () => {
  const record = {
    id: 'd21',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    stitchType: 'peyote',
    dropCount: 1,
    layers: [
      { id: 'l1', name: 'Layer 1', visible: true, order: 0, shapeEntries: ['0,0', '1,1'] },
      { id: 'l2', name: 'Layer 2', visible: false, order: 1, shapeEntries: ['2,2'] },
    ],
    activeLayerId: 'l1',
    colorways: [
      { id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'red']], l2: [['2,2', 'pink']] }, createdAt: 1, updatedAt: 1 },
      { id: 'cw2', name: 'Colorway 2', layerColorEntries: { l1: [['0,0', 'blue']], l2: [] }, createdAt: 1, updatedAt: 1 },
    ],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);

  assert.equal(migrated.layers, undefined);
  assert.equal(migrated.activeLayerId, undefined);

  for (const cw of migrated.colorways) {
    assert.equal(cw.activeLayerId, 'l1'); // the old top-level activeLayerId, copied onto every colorway
    assert.equal(cw.layers.length, 2);
    assert.equal(cw.layerColorEntries, undefined);
    assert.deepEqual(cw.layers[0].shapeEntries, ['0,0', '1,1']); // same shape on both — genuinely disconnected copies, not aliased
    assert.equal(cw.layers[0].name, 'Layer 1');
    assert.equal(cw.layers[0].visible, true);
    assert.equal(cw.layers[1].visible, false);
  }
  assert.deepEqual(migrated.colorways[0].layers[0].colorEntries, [['0,0', 'red']]);
  assert.deepEqual(migrated.colorways[0].layers[1].colorEntries, [['2,2', 'pink']]);
  assert.deepEqual(migrated.colorways[1].layers[0].colorEntries, [['0,0', 'blue']]);
  assert.deepEqual(migrated.colorways[1].layers[1].colorEntries, []);
});

test('migrateDesign: a record already fully on per-colorway layers is left alone, not re-wrapped', () => {
  const record = {
    id: 'd19',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    stitchType: 'peyote',
    dropCount: 1,
    colorways: [{
      id: 'cw1',
      name: 'Colorway 1',
      activeLayerId: 'l1',
      layers: [{ id: 'l1', name: 'My Layer', visible: false, order: 5, shapeEntries: ['0,0'], colorEntries: [['0,0', 'red']] }],
      createdAt: 1,
      updatedAt: 1,
    }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const migrated = migrateDesign(record);
  assert.deepEqual(migrated, record);
});

test('migrateDesign: running the migration twice is idempotent for the per-colorway layer wrap too', () => {
  const record = {
    id: 'd20',
    rows: 7,
    cols: 20,
    shapeEntries: ['3,4'],
    colorways: [{ id: 'cw1', name: 'Colorway 1', colorEntries: [['3,4', 'red']], createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
  };
  const once = migrateDesign(record);
  const twice = migrateDesign(once);
  assert.equal(once.colorways[0].layers.length, 1);
  assert.deepEqual(twice, once);
});

test('migrateDesign: running the migration twice on an old shared-layers-shaped record is idempotent', () => {
  const record = {
    id: 'd22',
    rows: 5,
    cols: 8,
    staggerFlipped: false,
    stitchType: 'peyote',
    dropCount: 1,
    layers: [{ id: 'l1', name: 'Layer 1', visible: true, order: 0, shapeEntries: ['0,0'] }],
    activeLayerId: 'l1',
    colorways: [{ id: 'cw1', name: 'Colorway 1', layerColorEntries: { l1: [['0,0', 'red']] }, createdAt: 1, updatedAt: 1 }],
    activeColorwayId: 'cw1',
    axisVersion: 2,
  };
  const once = migrateDesign(record);
  const twice = migrateDesign(once);
  assert.deepEqual(twice, once);
  assert.equal(once.colorways[0].activeLayerId, 'l1');
});
