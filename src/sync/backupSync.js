// Shape-aware Google Drive backup/restore layer (Phase A of
// .work/feature-cloud-sync-plan.md). Assembles/disassembles the Drive-side
// file set from what the existing store modules already read/write, via
// dbSnapshot.js/snapshot.js — no parallel storage layer of its own beyond the
// small driveSync bookkeeping row (driveSyncStore.js).
//
// googleDriveClient.js knows nothing about "designs" or "colorways"; this is
// the one place that translates between this app's records and Drive files.
//
// Layout on Drive — one folder per device, never shared:
//   Bead Pattern Designer Backups/
//     devices/
//       {deviceName}/
//         designs/{id}.json
//         customColors/{id}.json
//         beadCatalog/{id}.json
//         library.json
//         preferences.json
//         pre-migration-backups/{timestamp}/... (same shape, a retained checkpoint)
// Per-device folders (see deviceName.js) exist specifically so a device used
// for local dev/testing never mixes its backups with a device's real library
// — each device only ever writes inside its own folder, and Restore lets the
// user choose which device's backup to pull from (listDeviceBackups below),
// rather than blindly merging everything Drive has ever seen.

import { readAllStoreData, applyRestorePlan } from './dbSnapshot.js';
import { planRestore } from './snapshot.js';
import { getDriveSyncMeta, saveDriveSyncMeta } from '../storage/driveSyncStore.js';

const ROOT_FOLDER_NAME = 'Bead Pattern Designer Backups';
const DEVICES_FOLDER_NAME = 'devices';
const DESIGNS_FOLDER_NAME = 'designs';
const CUSTOM_COLORS_FOLDER_NAME = 'customColors';
const BEAD_CATALOG_FOLDER_NAME = 'beadCatalog';
const PRE_MIGRATION_FOLDER_NAME = 'pre-migration-backups';

// Resolves (creating if needed) one device's full folder tree. Not cached in
// driveSyncMeta on purpose — a device can be renamed (deviceName.js has no
// rename UI yet, but backupDialog.js's "Change" button lets a user retype
// it), and re-resolving by name on every push is cheap at this app's scale,
// versus a cached folder id silently going stale after a rename.
async function ensureDeviceFolders(drive, deviceName) {
  const rootId = await drive.ensureFolder(ROOT_FOLDER_NAME);
  const devicesRootId = await drive.ensureFolder(DEVICES_FOLDER_NAME, rootId);
  const deviceFolderId = await drive.ensureFolder(deviceName, devicesRootId);
  const designsFolderId = await drive.ensureFolder(DESIGNS_FOLDER_NAME, deviceFolderId);
  const customColorsFolderId = await drive.ensureFolder(CUSTOM_COLORS_FOLDER_NAME, deviceFolderId);
  const beadCatalogFolderId = await drive.ensureFolder(BEAD_CATALOG_FOLDER_NAME, deviceFolderId);
  return { rootId, devicesRootId, deviceFolderId, designsFolderId, customColorsFolderId, beadCatalogFolderId };
}

// customColors, beadCatalog, and designs are each pushed as one file per
// record (id.json in their own folder) rather than a single combined array —
// makes a push additive/non-destructive record-by-record, which matters even
// within one device's own folder (e.g. two rapid pushes racing).
async function pushRecordsToFolder(drive, folderId, records) {
  for (const record of records) {
    await drive.uploadJson(`${record.id}.json`, folderId, record);
  }
}

async function pullRecordsFromFolder(drive, folderId) {
  const files = await drive.listFiles(folderId);
  return Promise.all(files.map((f) => drive.downloadJson(f.id)));
}

// Propagates pending local deletes for one record type by removing the
// matching Drive file, so a later restore doesn't resurrect something deleted
// on purpose — used for designs, customColors, and beadCatalog alike. Returns
// the ids still left pending (only non-empty if this throws partway through,
// e.g. a network failure — whatever wasn't reached yet stays queued for the
// next push, same retry story as pushBackupToDriveTracked relies on).
async function propagateDeletes(drive, folderId, pendingIds) {
  const remaining = [...pendingIds];
  for (const id of pendingIds) {
    const remote = await drive.findByName(`${id}.json`, folderId);
    if (remote) await drive.deleteFile(remote.id);
    remaining.splice(remaining.indexOf(id), 1);
  }
  return remaining;
}

// Lists every device that has ever backed up here — [{id, name}], one per
// subfolder under devices/. Used by backupDialog.js to build the Restore
// picker. An empty list just means nobody's backed up to this Drive account
// yet (not an error).
export async function listDeviceBackups(drive) {
  const rootId = await drive.ensureFolder(ROOT_FOLDER_NAME);
  const devicesRootId = await drive.ensureFolder(DEVICES_FOLDER_NAME, rootId);
  return drive.listFolders(devicesRootId);
}

// Pushes this device's entire local library into its own folder — live-
// overwriting only files inside that folder, which no other device ever
// writes to, so there's no cross-device conflict to guard against (unlike an
// earlier version of this file, which shared one pool across devices and had
// to compare Drive's modifiedTime before every write; per-device folders make
// that guard unnecessary rather than just harder to get right).
export async function pushBackupToDrive(db, drive, deviceName) {
  const meta = await getDriveSyncMeta(db);
  const { designsFolderId, customColorsFolderId, beadCatalogFolderId, deviceFolderId } = await ensureDeviceFolders(drive, deviceName);
  const { designs, preferences, customColors, beadCatalog } = await readAllStoreData(db);

  await pushRecordsToFolder(drive, designsFolderId, designs);
  const deletedDesignIds = await propagateDeletes(drive, designsFolderId, meta.deletedDesignIds);

  await pushRecordsToFolder(drive, customColorsFolderId, customColors);
  const deletedCustomColorIds = await propagateDeletes(drive, customColorsFolderId, meta.deletedCustomColorIds);

  await pushRecordsToFolder(drive, beadCatalogFolderId, beadCatalog);
  const deletedBeadTypeIds = await propagateDeletes(drive, beadCatalogFolderId, meta.deletedBeadTypeIds);

  await drive.uploadJson('library.json', deviceFolderId, { designs: designs.map((d) => ({ id: d.id, order: d.order })) });
  await drive.uploadJson('preferences.json', deviceFolderId, preferences);

  await saveDriveSyncMeta(db, {
    ...meta,
    hasConnectedBefore: true,
    deletedDesignIds,
    deletedCustomColorIds,
    deletedBeadTypeIds,
    lastBackupAt: Date.now(),
    lastError: null,
  });

  return { designCount: designs.length };
}

// Wraps pushBackupToDrive with a "did this actually finish" flag persisted
// *before* the upload starts and cleared only on confirmed success — guards
// against iPad Safari backgrounding/killing the network request mid-flight
// right at the moment a design closes (the plan's "secondary risks" section).
// main.js calls this (not pushBackupToDrive directly) for both the design-
// close trigger and the on-boot retry-if-still-pending check.
export async function pushBackupToDriveTracked(db, drive, deviceName) {
  const meta = await getDriveSyncMeta(db);
  await saveDriveSyncMeta(db, { ...meta, pendingBackup: true });
  try {
    const result = await pushBackupToDrive(db, drive, deviceName);
    const latest = await getDriveSyncMeta(db);
    await saveDriveSyncMeta(db, { ...latest, pendingBackup: false });
    return result;
  } catch (err) {
    const latest = await getDriveSyncMeta(db);
    await saveDriveSyncMeta(db, { ...latest, pendingBackup: true, lastError: err.message });
    throw err;
  }
}

// Marks a design as pending deletion on Drive — called from main.js's
// handleDelete alongside the local deleteDesign(). The actual Drive file
// removal happens on the next push (batched with everything else, rather than
// firing an extra network call per delete).
export async function recordDesignDeletedLocally(db, designId) {
  const meta = await getDriveSyncMeta(db);
  if (meta.deletedDesignIds.includes(designId)) return;
  await saveDriveSyncMeta(db, { ...meta, deletedDesignIds: [...meta.deletedDesignIds, designId] });
}

// Same idea as recordDesignDeletedLocally, for a deleted custom color —
// without this, a color deleted locally would never be removed from Drive,
// and a later restore (on this device or another) would silently bring it
// back, exactly the "deletes need to propagate" risk the plan flagged.
export async function recordCustomColorDeletedLocally(db, colorId) {
  const meta = await getDriveSyncMeta(db);
  if (meta.deletedCustomColorIds.includes(colorId)) return;
  await saveDriveSyncMeta(db, { ...meta, deletedCustomColorIds: [...meta.deletedCustomColorIds, colorId] });
}

// Same idea, for a deleted bead type.
export async function recordBeadTypeDeletedLocally(db, beadTypeId) {
  const meta = await getDriveSyncMeta(db);
  if (meta.deletedBeadTypeIds.includes(beadTypeId)) return;
  await saveDriveSyncMeta(db, { ...meta, deletedBeadTypeIds: [...meta.deletedBeadTypeIds, beadTypeId] });
}

// Restores from one specific device's backup folder (deviceFolderId, from
// listDeviceBackups above) — merge-by-id, never overwrite (see snapshot.js's
// planRestore); every incoming design is run through migrateDesign() there.
// Returns the plan so the UI can show counts of what was actually added vs.
// already present, before/after the write. Deliberately does not pull from
// *every* device at once — that's the whole point of the per-device layout;
// the caller picks a specific backup via listDeviceBackups + a UI picker.
export async function restoreFromDeviceBackup(db, drive, deviceFolderId) {
  const designsFolderId = await drive.ensureFolder(DESIGNS_FOLDER_NAME, deviceFolderId);
  const customColorsFolderId = await drive.ensureFolder(CUSTOM_COLORS_FOLDER_NAME, deviceFolderId);
  const beadCatalogFolderId = await drive.ensureFolder(BEAD_CATALOG_FOLDER_NAME, deviceFolderId);

  const designs = await pullRecordsFromFolder(drive, designsFolderId);
  const customColors = await pullRecordsFromFolder(drive, customColorsFolderId);
  const beadCatalog = await pullRecordsFromFolder(drive, beadCatalogFolderId);
  const preferencesFile = await drive.findByName('preferences.json', deviceFolderId);
  const preferences = preferencesFile ? await drive.downloadJson(preferencesFile.id) : null;

  const remoteSnapshot = { designs, preferences, customColors, beadCatalog };
  const existing = await readAllStoreData(db);
  const plan = planRestore(remoteSnapshot, existing);
  await applyRestorePlan(db, plan);
  return plan;
}

// The pre-migration retained checkpoint (plan Decision #6): a distinct,
// timestamped snapshot inside *this device's own* folder that a routine push
// can never overwrite, taken right before a schema migration runs — the one
// moment this app actually controls that could otherwise silently corrupt
// data with no way back.
export async function runPreMigrationBackup(db, drive, deviceName) {
  const { deviceFolderId } = await ensureDeviceFolders(drive, deviceName);
  const checkpointRootId = await drive.ensureFolder(PRE_MIGRATION_FOLDER_NAME, deviceFolderId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const checkpointFolderId = await drive.ensureFolder(timestamp, checkpointRootId);
  const checkpointDesignsFolderId = await drive.ensureFolder(DESIGNS_FOLDER_NAME, checkpointFolderId);
  const checkpointCustomColorsFolderId = await drive.ensureFolder(CUSTOM_COLORS_FOLDER_NAME, checkpointFolderId);
  const checkpointBeadCatalogFolderId = await drive.ensureFolder(BEAD_CATALOG_FOLDER_NAME, checkpointFolderId);

  const { designs, preferences, customColors, beadCatalog } = await readAllStoreData(db);
  await pushRecordsToFolder(drive, checkpointDesignsFolderId, designs);
  await pushRecordsToFolder(drive, checkpointCustomColorsFolderId, customColors);
  await pushRecordsToFolder(drive, checkpointBeadCatalogFolderId, beadCatalog);
  await drive.uploadJson('library.json', checkpointFolderId, { designs: designs.map((d) => ({ id: d.id, order: d.order })) });
  await drive.uploadJson('preferences.json', checkpointFolderId, preferences);

  return { timestamp, folderId: checkpointFolderId };
}
