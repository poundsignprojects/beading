// Design-record CRUD on top of db.js. Only the fields listed in the Phase 4/6
// plans' data models are ever persisted — gridParams/viewport are re-derived on
// open, never stored (see CLAUDE.md Phase 4 status / plan's "Decisions confirmed"
// section).

import { getAll, get, put, del } from './db.js';
import { generateId } from './id.js';
import { migrateDesign } from './migrateDesign.js';

const STORE = 'designs';

// Migrates any pre-Phase-6 record (flat cellEntries, no colorways), any
// pre-row/col-axis-refactor record (see .work/refactor-row-col-axis-naming-
// plan.md), any pre-layers record, and any pre-per-colorway-layers record
// (see .work/feature-per-colorway-layers-plan.md) the first time each is
// read, and opportunistically re-saves whatever changed so each migration
// only has to run once per design, system-wide — not on every boot
// indefinitely.
export async function listDesignsSortedWithMigrationInfo(db) {
  const designs = await getAll(db, STORE);
  let ranAxisMigration = false;
  let ranLayersMigration = false;
  let ranLayersPerColorwayMigration = false;
  const migrated = await Promise.all(
    designs.map(async (design) => {
      if (design.axisVersion !== 2) ranAxisMigration = true;
      // A record already on per-colorway layers (every colorway carries its
      // own `layers` array) has no top-level `layers`/`shapeEntries` field
      // either — same ambiguity migrateLayers' own gate has to resolve (see
      // its comment in migrateDesign.js) — so "no top-level layers" alone
      // can't tell "genuinely pre-layers" apart from "already fully
      // migrated." Only flag this when the record hasn't reached ANY
      // layers shape yet (old shared OR new per-colorway).
      const alreadyPerColorwayLayers = design.colorways?.length > 0 && design.colorways.every((cw) => cw.layers);
      if (!design.layers && !alreadyPerColorwayLayers) ranLayersMigration = true;
      // `design.layers` here means "still on the old shared-layers shape" —
      // it's the field migrateLayersPerColorway folds away, so its presence
      // on the pre-migration record (regardless of how far back the record
      // otherwise is) means that step will genuinely change it.
      if (design.layers) ranLayersPerColorwayMigration = true;
      const result = migrateDesign(design);
      if (result !== design) await put(db, STORE, result);
      return result;
    })
  );
  return { designs: migrated.sort((a, b) => a.order - b.order), ranAxisMigration, ranLayersMigration, ranLayersPerColorwayMigration };
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
    // A brand-new design starts with exactly one colorway holding exactly one
    // default layer — colorway/layer count isn't a creation-time choice
    // either, both are built up during editing (see .work/feature-layers-
    // plan.md, .work/feature-per-colorway-layers-plan.md). Layers belong to
    // exactly one colorway, not shared across them.
    colorways: [{
      id: activeColorwayId,
      name: 'Colorway 1',
      activeLayerId: defaultLayerId,
      layers: [{ id: defaultLayerId, name: 'Layer 1', visible: true, order: 0, shapeEntries: [], colorEntries: [] }],
      createdAt: now,
      updatedAt: now,
    }],
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

// Creates a new, independent design record from an already-resolved set of
// colorways — the output of the Convert Bead Type flow (Part C of
// .work/feature-bead-catalog-and-conversion-plan.md's clone-based conversion:
// same pattern, new bead type, colors resolved per the user's chosen mapping,
// leaving the source design completely untouched). Same shape/defaults as
// createDesign/duplicateDesign (fresh id, order = maxOrder + 1, thumbnailDataUrl:
// null) but takes colorways/activeColorwayId directly rather than starting
// empty or copying another record verbatim — each colorway already carries
// its own layers/activeLayerId (layers belong to exactly one colorway, see
// .work/feature-per-colorway-layers-plan.md), so the caller (main.js) is
// responsible for producing a fully independent structure (fresh ids
// throughout, per colorway), exactly as it already is for colorway ids.
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
export async function createConvertedDesign(db, { name, beadTypeKey, stitchType = 'peyote', dropCount = 1, rows, cols, staggerFlipped = false, colorways, activeColorwayId }) {
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

  // Every colorway gets a fresh id, and — since layers belong to exactly one
  // colorway (see .work/feature-per-colorway-layers-plan.md) — every layer
  // gets its own fresh id scoped to its own colorway's own id map, not one
  // map shared across colorways. A duplicate must not share identity with
  // the original's, even though its contents start out identical.
  const colorwayIdMap = new Map(original.colorways.map((cw) => [cw.id, generateId()]));
  const copy = {
    ...original,
    id: generateId(),
    // An unnamed original stays unnamed — no "copy" suffix with nothing to
    // suffix (see main.js's handleCreate for why a design can be unnamed).
    name: original.name ? `${original.name} copy` : '',
    colorways: original.colorways.map((cw) => {
      const layerIdMap = new Map(cw.layers.map((layer) => [layer.id, generateId()]));
      return {
        ...cw,
        id: colorwayIdMap.get(cw.id),
        activeLayerId: layerIdMap.get(cw.activeLayerId),
        layers: cw.layers.map((layer) => ({
          ...layer,
          id: layerIdMap.get(layer.id),
          shapeEntries: [...layer.shapeEntries],
          colorEntries: [...layer.colorEntries],
        })),
        createdAt: now,
        updatedAt: now,
      };
    }),
    activeColorwayId: colorwayIdMap.get(original.activeColorwayId),
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await put(db, STORE, copy);
  return copy;
}
