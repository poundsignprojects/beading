// Google Drive backup/sync bookkeeping — a single global row (mirrors
// preferencesStore.js's shape exactly), separate from `preferences` since this
// is sync plumbing, not a user-facing setting. Tracks Drive folder/file ids
// (so repeat backups don't have to re-search Drive for them), the last-known
// Drive `modifiedTime` per design this device pushed (the Phase A overwrite
// guard — see backupSync.js), pending delete tombstones, and status for the
// UI ("last backed up: …", last error). Never stores the OAuth access token
// itself — that's memory-only for the session (see googleDriveClient.js).

import { get, put } from './db.js';

const STORE = 'driveSync';
const META_ID = 'global';

const DEFAULT_META = {
  id: META_ID,
  hasConnectedBefore: false,
  rootFolderId: null,
  designsFolderId: null,
  customColorsFolderId: null,
  beadCatalogFolderId: null,
  designSyncedModifiedTime: {}, // designId -> Drive modifiedTime string, as of our last successful push
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
