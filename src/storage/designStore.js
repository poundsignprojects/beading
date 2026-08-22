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
  const migrated = await Promise.all(
    designs.map(async (design) => {
      if (design.axisVersion !== 2) ranAxisMigration = true;
      const result = migrateDesign(design);
      if (result !== design) await put(db, STORE, result);
      return result;
    })
  );
  return { designs: migrated.sort((a, b) => a.order - b.order), ranAxisMigration };
}

export async function listDesignsSorted(db) {
  return (await listDesignsSortedWithMigrationInfo(db)).designs;
}

export async function createDesign(db, { name, beadTypeKey, rows, cols }) {
  const existing = await getAll(db, STORE);
  const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), -Infinity);
  const now = Date.now();
  const activeColorwayId = generateId();
  const design = {
    id: generateId(),
    name,
    beadTypeKey,
    rows,
    cols,
    shapeEntries: [],
    colorways: [{ id: activeColorwayId, name: 'Colorway 1', colorEntries: [], createdAt: now, updatedAt: now }],
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

// Creates a new, independent design record from an already-resolved shape/
// colorways — the output of the Convert Bead Type flow (Part C of
// .work/feature-bead-catalog-and-conversion-plan.md's clone-based conversion:
// same pattern, new bead type, colors resolved per the user's chosen mapping,
// leaving the source design completely untouched). Same shape/defaults as
// createDesign/duplicateDesign (fresh id, order = maxOrder + 1, thumbnailDataUrl:
// null) but takes shapeEntries/colorways/activeColorwayId directly rather than
// starting empty or copying another record verbatim. staggerFlipped is passed
// through from the source design (same shape, so it must render with the same
// stagger convention as what's being converted), not defaulted to false.
export async function createConvertedDesign(db, { name, beadTypeKey, rows, cols, staggerFlipped = false, shapeEntries, colorways, activeColorwayId }) {
  const existing = await getAll(db, STORE);
  const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), -Infinity);
  const now = Date.now();
  const design = {
    id: generateId(),
    name,
    beadTypeKey,
    rows,
    cols,
    staggerFlipped,
    shapeEntries,
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

export async function saveDesign(db, design) {
  const updated = { ...design, updatedAt: Date.now() };
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

  // Every colorway gets a fresh id — a duplicate must not share identity with the
  // original's colorways, even though its contents start out identical.
  const idMap = new Map(original.colorways.map((cw) => [cw.id, generateId()]));
  const copy = {
    ...original,
    id: generateId(),
    name: `${original.name} copy`,
    shapeEntries: [...original.shapeEntries],
    colorways: original.colorways.map((cw) => ({
      ...cw,
      id: idMap.get(cw.id),
      colorEntries: cw.colorEntries.map(([key, colorId]) => [key, colorId]),
      createdAt: now,
      updatedAt: now,
    })),
    activeColorwayId: idMap.get(original.activeColorwayId),
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await put(db, STORE, copy);
  return copy;
}
