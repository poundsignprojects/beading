// Design-record CRUD on top of db.js. Only the fields listed in the Phase 4/6
// plans' data models are ever persisted — gridParams/viewport are re-derived on
// open, never stored (see CLAUDE.md Phase 4 status / plan's "Decisions confirmed"
// section).

import { getAll, get, put, del } from './db.js';
import { generateId } from './id.js';
import { migrateDesign } from './migrateDesign.js';

const STORE = 'designs';

// Migrates any pre-Phase-6 record (flat cellEntries, no colorways) and any
// pre-row/col-axis-refactor record (see .work/refactor-row-col-axis-naming-
// plan.md) the first time each is read, and opportunistically re-saves whatever
// changed so each migration only has to run once per design, system-wide — not
// on every boot indefinitely.
export async function listDesignsSortedWithMigrationInfo(db) {
  const designs = await getAll(db, STORE);
  let ranAxisMigration = false;
  let ranLayersMigration = false;
  const migrated = await Promise.all(
    designs.map(async (design) => {
      if (design.axisVersion !== 2) ranAxisMigration = true;
      if (!design.layers) ranLayersMigration = true;
      const result = migrateDesign(design);
      if (result !== design) await put(db, STORE, result);
      return result;
    })
  );
  return { designs: migrated.sort((a, b) => a.order - b.order), ranAxisMigration, ranLayersMigration };
}

export async function listDesignsSorted(db) {
  return (await listDesignsSortedWithMigrationInfo(db)).designs;
}

export async function createDesign(db, { name, beadTypeKey, stitchType = 'peyote', dropCount = 1, rows, cols }) {
  const existing = await getAll(db, STORE);
  const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), -Infinity);
  const now = Date.now();
  const activeColorwayId = generateId();
  const defaultLayerId = generateId();
  const design = {
    id: generateId(),
    name,
    beadTypeKey,
    stitchType,
    // Meaningful only for peyote — square-stitch designs still carry
    // dropCount: 1 for schema uniformity (see .work/feature-multi-drop-
    // peyote-plan.md), so nothing has to undefined-guard it elsewhere.
    dropCount,
    rows,
    cols,
    // A brand-new design starts with exactly one default layer, matching how
    // colorway count isn't a creation-time choice either — layers are built
    // up during editing (see .work/feature-layers-plan.md).
    layers: [{ id: defaultLayerId, name: 'Layer 1', visible: true, order: 0, shapeEntries: [] }],
    activeLayerId: defaultLayerId,
    colorways: [{ id: activeColorwayId, name: 'Colorway 1', layerColorEntries: { [defaultLayerId]: [] }, createdAt: now, updatedAt: now }],
    activeColorwayId,
    thumbnailDataUrl: null,
    order: existing.length === 0 ? 0 : maxOrder + 1,
    createdAt: now,
    updatedAt: now,
    axisVersion: 2,
    // No legacy convention to match — a brand-new design has never rendered
    // under any other stagger rule (see src/grid/peyote.js's isRaised /
    // migrateDesign.js's migrateStaggerFlip).
    staggerFlipped: false,
  };
  await put(db, STORE, design);
  return design;
}

// Creates a new, independent design record from an already-resolved layers/
// colorways — the output of the Convert Bead Type flow (Part C of
// .work/feature-bead-catalog-and-conversion-plan.md's clone-based conversion:
// same pattern, new bead type, colors resolved per the user's chosen mapping,
// leaving the source design completely untouched). Same shape/defaults as
// createDesign/duplicateDesign (fresh id, order = maxOrder + 1, thumbnailDataUrl:
// null) but takes layers/colorways/activeLayerId/activeColorwayId directly
// rather than starting empty or copying another record verbatim — the caller
// (main.js) is responsible for producing a fully independent layer/colorway
// structure (fresh ids throughout), exactly as it already is for colorway ids.
// staggerFlipped/stitchType are passed through from the source design by
// default (same shape, so it must render under the same stagger/stitch
// convention as what's being converted) — dropCount defaults to 1 (matching
// createDesign's own default) but every real caller passes it explicitly per
// .work/feature-multi-drop-peyote-plan.md (bead-type conversion always
// preserves it; stitch-type conversion preserves it only when converting to
// peyote, resets to 1 for square stitch). A stitch-type conversion (see
// .work/feature-square-stitch-plan.md) is the one caller that overrides
// stitchType explicitly, since that's the one field the conversion is
// actually changing.
export async function createConvertedDesign(db, { name, beadTypeKey, stitchType = 'peyote', dropCount = 1, rows, cols, staggerFlipped = false, layers, colorways, activeLayerId, activeColorwayId }) {
  const existing = await getAll(db, STORE);
  const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), -Infinity);
  const now = Date.now();
  const design = {
    id: generateId(),
    name,
    beadTypeKey,
    stitchType,
    dropCount,
    rows,
    cols,
    staggerFlipped,
    layers,
    activeLayerId,
    colorways,
    activeColorwayId,
    thumbnailDataUrl: null,
    order: existing.length === 0 ? 0 : maxOrder + 1,
    createdAt: now,
    updatedAt: now,
    axisVersion: 2,
  };
  await put(db, STORE, design);
  return design;
}

// bumpUpdatedAt: false preserves design.updatedAt verbatim instead of stamping
// Date.now() — used for saves that don't represent a genuine content edit (a
// library reorder, or a routine flush of an already-clean open design) so the
// library's "last updated" reading only reflects real changes to beads/geometry/
// colors, not passive actions like reordering or simply opening/closing a
// design (see .work/feature-ruler-rotation-viewmode-datefix-plan.md §4).
export async function saveDesign(db, design, { bumpUpdatedAt = true } = {}) {
  const updated = bumpUpdatedAt ? { ...design, updatedAt: Date.now() } : { ...design };
  await put(db, STORE, updated);
  return updated;
}

export async function deleteDesign(db, id) {
  await del(db, STORE, id);
}

export async function duplicateDesign(db, id) {
  const original = migrateDesign(await get(db, STORE, id));
  const existing = await getAll(db, STORE);
  const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), -Infinity);
  const now = Date.now();

  // Every layer and every colorway gets a fresh id — a duplicate must not
  // share identity with the original's, even though its contents start out
  // identical (see .work/feature-layers-plan.md — layerIdMap mirrors the
  // pre-existing colorway idMap treatment exactly).
  const layerIdMap = new Map(original.layers.map((layer) => [layer.id, generateId()]));
  const colorwayIdMap = new Map(original.colorways.map((cw) => [cw.id, generateId()]));
  const copy = {
    ...original,
    id: generateId(),
    // An unnamed original stays unnamed — no "copy" suffix with nothing to
    // suffix (see main.js's handleCreate for why a design can be unnamed).
    name: original.name ? `${original.name} copy` : '',
    layers: original.layers.map((layer) => ({
      ...layer,
      id: layerIdMap.get(layer.id),
      shapeEntries: [...layer.shapeEntries],
    })),
    activeLayerId: layerIdMap.get(original.activeLayerId),
    colorways: original.colorways.map((cw) => ({
      ...cw,
      id: colorwayIdMap.get(cw.id),
      layerColorEntries: Object.fromEntries(
        Object.entries(cw.layerColorEntries).map(([layerId, entries]) => [
          layerIdMap.get(layerId),
          entries.map(([key, colorId]) => [key, colorId]),
        ])
      ),
      createdAt: now,
      updatedAt: now,
    })),
    activeColorwayId: colorwayIdMap.get(original.activeColorwayId),
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await put(db, STORE, copy);
  return copy;
}
