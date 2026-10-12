// Custom color palette CRUD on top of db.js (Phase 8). Mirrors designStore.js's
// shape exactly. Colors are scoped per bead type — delica11/rocaille11 each get
// their own independent list, not a shared global one.

import { getAll, put, del } from './db.js';
import { generateId } from './id.js';
import { normalizeFinish } from '../palette/colorLibrary.js';

const STORE = 'customColors';

// Additive, optional appearance fields (.work/feature-bead-finish-effects-mvp-plan.md)
// — defaulted at the read layer rather than migrated/rewritten, the same
// "spread stored data over defaults" idiom already used by driveSyncStore.js's
// getDriveSyncMeta and preferences.actualSizeCalibration/defaultDropCount.
// No DB_VERSION bump: purely additive, not a design-record shape change.
// overlay/overlayHex are reserved for the full-feature plan — never written or
// offered by this MVP, just carried along so later work needs no migration.
const DEFAULT_APPEARANCE = { alphaPercent: 100, overlay: 'none', overlayHex: null };

// The finish flags (matte/metallic) replaced a single `luster` field — see
// normalizeFinish. Converted here on read, like the defaults above, so a
// record from before the split (or restored from an old backup) needs no
// migration; the legacy field is dropped so the next save writes it out clean.
function withAppearance(stored) {
  const { luster, ...rest } = stored;
  return { ...DEFAULT_APPEARANCE, ...DEFAULT_STASH, ...rest, ...normalizeFinish(stored) };
}

// Optional, additive — same "spread stored data over defaults" idiom as
// DEFAULT_APPEARANCE above, no DB_VERSION bump needed. null means "not
// tracked," deliberately distinct from 0 ("tracked, have none") — see
// stashCheck.js, which only ever compares a color whose stashCount isn't
// null/undefined.
const DEFAULT_STASH = { stashCount: null };

export async function listCustomColorsSorted(db, beadTypeKey) {
  const all = await getAll(db, STORE);
  return all
    .filter((c) => c.beadTypeKey === beadTypeKey)
    .sort((a, b) => a.order - b.order)
    .map(withAppearance);
}

export async function createCustomColor(db, {
  beadTypeKey, name, hex, alphaPercent = 100, matte = false, metallic = false, overlay = 'none', overlayHex = null, stashCount = null,
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
    matte,
    metallic,
    overlay,
    overlayHex,
    stashCount,
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
