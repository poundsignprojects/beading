// Design-record CRUD on top of db.js. Only the fields listed in the Phase 4 plan's
// data model are ever persisted — gridParams/viewport are re-derived on open, never
// stored (see CLAUDE.md Phase 4 status / plan's "Decisions confirmed" section).

import { getAll, get, put, del } from './db.js';
import { generateId } from './id.js';

const STORE = 'designs';

export async function listDesignsSorted(db) {
  const designs = await getAll(db, STORE);
  return designs.sort((a, b) => a.order - b.order);
}

export async function createDesign(db, { name, beadTypeKey, rows, cols }) {
  const existing = await getAll(db, STORE);
  const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), -Infinity);
  const now = Date.now();
  const design = {
    id: generateId(),
    name,
    beadTypeKey,
    rows,
    cols,
    cellEntries: [],
    order: existing.length === 0 ? 0 : maxOrder + 1,
    createdAt: now,
    updatedAt: now,
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
  const original = await get(db, STORE, id);
  const existing = await getAll(db, STORE);
  const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), -Infinity);
  const now = Date.now();
  const copy = {
    ...original,
    id: generateId(),
    name: `${original.name} copy`,
    cellEntries: original.cellEntries.map(([key, value]) => [key, { ...value }]),
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await put(db, STORE, copy);
  return copy;
}
