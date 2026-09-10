// Custom color palette CRUD on top of db.js (Phase 8). Mirrors designStore.js's
// shape exactly. Colors are scoped per bead type — delica11/rocaille11 each get
// their own independent list, not a shared global one.

import { getAll, put, del } from './db.js';
import { generateId } from './id.js';

const STORE = 'customColors';

// Additive, optional appearance fields (.work/feature-bead-finish-effects-mvp-plan.md)
// — defaulted at the read layer rather than migrated/rewritten, the same
// "spread stored data over defaults" idiom already used by driveSyncStore.js's
// getDriveSyncMeta and preferences.actualSizeCalibration/defaultDropCount.
// No DB_VERSION bump: purely additive, not a design-record shape change.
// overlay/overlayHex are reserved for the full-feature plan — never written or
// offered by this MVP, just carried along so later work needs no migration.
const DEFAULT_APPEARANCE = { alphaPercent: 100, luster: 'matte', overlay: 'none', overlayHex: null };

export async function listCustomColorsSorted(db, beadTypeKey) {
  const all = await getAll(db, STORE);
  return all
    .filter((c) => c.beadTypeKey === beadTypeKey)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ ...DEFAULT_APPEARANCE, ...c }));
}

export async function createCustomColor(db, {
  beadTypeKey, name, hex, alphaPercent = 100, luster = 'matte', overlay = 'none', overlayHex = null,
}) {
  const existing = (await getAll(db, STORE)).filter((c) => c.beadTypeKey === beadTypeKey);
  const maxOrder = existing.reduce((max, c) => Math.max(max, c.order), -Infinity);
  const now = Date.now();
  const color = {
    id: generateId(),
    beadTypeKey,
    name,
    hex,
    alphaPercent,
    luster,
    overlay,
    overlayHex,
    order: existing.length === 0 ? 0 : maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await put(db, STORE, color);
  return color;
}

export async function saveCustomColor(db, color) {
  const updated = { ...color, updatedAt: Date.now() };
  await put(db, STORE, updated);
  return updated;
}

export async function deleteCustomColor(db, id) {
  await del(db, STORE, id);
}
