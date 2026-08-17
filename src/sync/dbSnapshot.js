// The one place snapshot.js's pure assemble/restore-plan functions meet real
// IndexedDB reads/writes. Deliberately thin — all the actual decisions
// (what to skip, what migrateDesign() does) live in snapshot.js where they're
// unit-testable; this module just wires that to db.js/the store modules.

import { put } from '../storage/db.js';
import { listDesignsSorted } from '../storage/designStore.js';
import { getPreferences } from '../storage/preferencesStore.js';
import { listCustomColorsSorted } from '../storage/customColorStore.js';
import { listBeadCatalogSorted } from '../storage/beadCatalogStore.js';
import { assembleSnapshot } from './snapshot.js';

// Fresh from IndexedDB, not from in-memory appState — a backup should reflect
// what's actually durable, and listDesignsSorted/listBeadCatalogSorted already
// run their own opportunistic migrate-on-read pass, so what gets backed up is
// always in current shape.
export async function readAllStoreData(db) {
  const [designs, preferences, customColors, beadCatalog] = await Promise.all([
    listDesignsSorted(db),
    getPreferences(db),
    listAllCustomColors(db),
    listBeadCatalogSorted(db),
  ]);
  return { designs, preferences, customColors, beadCatalog };
}

// listCustomColorsSorted is scoped to one bead type at a time (Phase 8 — colors
// are per bead type); a backup needs every bead type's colors together, so this
// reads the catalog first and unions each type's list.
async function listAllCustomColors(db) {
  const beadCatalog = await listBeadCatalogSorted(db);
  const lists = await Promise.all(beadCatalog.map((bead) => listCustomColorsSorted(db, bead.id)));
  return lists.flat();
}

export async function buildSnapshotFromDb(db) {
  return assembleSnapshot(await readAllStoreData(db));
}

// Writes a restore plan's records straight into IndexedDB via the shared low-
// level put() (not designStore.js's createDesign etc., which mint fresh ids/
// order — a restore must preserve the original identity, order, and
// timestamps for future merge-by-id restores to keep working correctly).
export async function applyRestorePlan(db, plan) {
  for (const design of plan.designsToCreate) await put(db, 'designs', design);
  for (const color of plan.customColorsToCreate) await put(db, 'customColors', color);
  for (const bead of plan.beadCatalogToCreate) await put(db, 'beadCatalog', bead);
  if (plan.preferences) await put(db, 'preferences', { ...plan.preferences, id: 'global' });
}
