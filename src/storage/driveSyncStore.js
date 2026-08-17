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
};

export async function getDriveSyncMeta(db) {
  const stored = await get(db, STORE, META_ID);
  return stored ?? { ...DEFAULT_META };
}

export async function saveDriveSyncMeta(db, meta) {
  const updated = { ...meta, id: META_ID };
  await put(db, STORE, updated);
  return updated;
}
