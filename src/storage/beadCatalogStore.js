// Bead type catalog CRUD on top of db.js (Part A of
// .work/feature-bead-catalog-and-conversion-plan.md). Mirrors customColorStore.js's
// shape — global, not scoped to a design, since a bead type's physical dimensions
// apply to every design that uses it.

import { getAll, put, del } from './db.js';
import { generateId } from './id.js';
import { DEFAULT_BEAD_CATALOG } from '../palette/beadSpecs.js';

const STORE = 'beadCatalog';

// DEFAULT_BEAD_CATALOG's rocaille11 entry was renamed from "Round Rocaille 11/0"
// to "Rocaille 11/0" — seedDefaultBeadCatalog only ever runs once (a no-op for
// every existing install), so an already-persisted row needs its own one-time
// rename, same opportunistic-migration-on-read idea as migrateDesign.js. Keyed
// on the old name specifically (not just the id), so a user who has since
// renamed their own rocaille11 row to something else is left untouched.
const LEGACY_ROCAILLE_NAME = 'Round Rocaille 11/0';

export async function listBeadCatalogSorted(db) {
  const all = await getAll(db, STORE);
  const migrated = await Promise.all(
    all.map(async (bead) => {
      if (bead.id !== 'rocaille11' || bead.name !== LEGACY_ROCAILLE_NAME) return bead;
      const renamed = { ...bead, name: 'Rocaille 11/0', updatedAt: Date.now() };
      await put(db, STORE, renamed);
      return renamed;
    })
  );
  return migrated.sort((a, b) => a.order - b.order);
}

// No-ops if the store already has rows — called once from boot(), same idea as
// migrateDesign.js seeding a default colorway for a pre-Phase-6 record.
export async function seedDefaultBeadCatalog(db) {
  const existing = await getAll(db, STORE);
  if (existing.length > 0) return;
  const now = Date.now();
  for (const [index, bead] of DEFAULT_BEAD_CATALOG.entries()) {
    await put(db, STORE, { ...bead, order: index, createdAt: now, updatedAt: now });
  }
}

export async function createBeadType(db, { name, widthMm, heightMm, cornerRadiusFraction = null, holeMm = null, diameterMm = null }) {
  const existing = await getAll(db, STORE);
  const maxOrder = existing.reduce((max, b) => Math.max(max, b.order), -Infinity);
  const now = Date.now();
  const beadType = {
    id: generateId(),
    name,
    widthMm,
    heightMm,
    cornerRadiusFraction,
    holeMm,
    diameterMm,
    order: existing.length === 0 ? 0 : maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await put(db, STORE, beadType);
  return beadType;
}

export async function saveBeadType(db, beadType) {
  const updated = { ...beadType, updatedAt: Date.now() };
  await put(db, STORE, updated);
  return updated;
}

export async function deleteBeadType(db, id) {
  await del(db, STORE, id);
}
