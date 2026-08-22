// Google Drive backup/sync bookkeeping — a single global row (mirrors
// preferencesStore.js's shape exactly), separate from `preferences` since this
// is sync plumbing, not a user-facing setting. Tracks pending delete
// tombstones (per record type, so a local delete gets propagated to Drive
// rather than silently resurrected by a later restore — see backupSync.js)
// and status for the UI ("last backed up: …", last error). Never stores the
// OAuth access token itself (memory-only for the session, see
// googleDriveClient.js) or Drive folder ids (backupSync.js re-resolves those
// by name on every push — cheap at this app's scale, and avoids a cached id
// going stale if a device is renamed via deviceName.js).

import { get, put } from './db.js';

const STORE = 'driveSync';
const META_ID = 'global';

const DEFAULT_META = {
  id: META_ID,
  hasConnectedBefore: false,
  deletedDesignIds: [], // local deletes not yet propagated to Drive
  deletedCustomColorIds: [],
  deletedBeadTypeIds: [],
  pendingBackup: false, // a push started but never confirmed complete (e.g. backgrounded mid-upload) — retried on next boot
  lastBackupAt: null,
  lastError: null,
  // Set by boot() when listDesignsSortedWithMigrationInfo() reports it actually
  // ran the row/col-axis migration on at least one design (see
  // .work/refactor-row-col-axis-naming-plan.md's Backup Safety section) — holds
  // the automatic "push on design close" behind a review banner until an
  // explicit manual Back Up Now, so a bad migration can't silently overwrite the
  // live Drive backup before anyone's looked. Never set for a fresh install or a
  // library already fully on axisVersion: 2.
  pendingAxisMigrationReview: false,
};

// Merges over DEFAULT_META rather than returning a stored row verbatim — this
// shape has already grown fields more than once (deletedCustomColorIds/
// deletedBeadTypeIds were added after this store first shipped), and a row
// saved under an older shape must still get sensible defaults (empty arrays,
// not undefined) for whatever's been added since, or callers like
// backupSync.js's propagateDeletes() crash spreading an undefined array.
export async function getDriveSyncMeta(db) {
  const stored = await get(db, STORE, META_ID);
  return { ...DEFAULT_META, ...stored };
}

export async function saveDriveSyncMeta(db, meta) {
  const updated = { ...meta, id: META_ID };
  await put(db, STORE, updated);
  return updated;
}
