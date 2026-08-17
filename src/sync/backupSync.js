// Shape-aware Google Drive backup/restore layer (Phase A of
// .work/feature-cloud-sync-plan.md). Assembles/disassembles the Drive-side
// file set ("Data shape on the Drive side" in the plan) from what the
// existing store modules already read/write, via dbSnapshot.js/snapshot.js —
// no parallel storage layer of its own beyond the small driveSync bookkeeping
// row (driveSyncStore.js) needed for the overwrite guard below.
//
// googleDriveClient.js knows nothing about "designs" or "colorways"; this is
// the one place that translates between this app's records and Drive files.

import { readAllStoreData, applyRestorePlan } from './dbSnapshot.js';
import { planRestore } from './snapshot.js';
import { getDriveSyncMeta, saveDriveSyncMeta } from '../storage/driveSyncStore.js';

const ROOT_FOLDER_NAME = 'Bead Pattern Designer Backups';
const DESIGNS_FOLDER_NAME = 'designs';
const CUSTOM_COLORS_FOLDER_NAME = 'customColors';
const BEAD_CATALOG_FOLDER_NAME = 'beadCatalog';
const PRE_MIGRATION_FOLDER_NAME = 'pre-migration-backups';
// Legacy Phase-A-first-draft filenames — see the "why per-record files" note
// on pushRecordsToFolder below. Cleaned up opportunistically on push so a
// device that backed up under the old scheme doesn't leave a stale, unread
// file sitting in the root folder indefinitely.
const LEGACY_CUSTOM_COLORS_FILE = 'customColors.json';
const LEGACY_BEAD_CATALOG_FILE = 'beadCatalog.json';

async function ensureFolders(drive, meta) {
  const rootId = meta.rootFolderId ?? (await drive.ensureFolder(ROOT_FOLDER_NAME));
  const designsFolderId = meta.designsFolderId ?? (await drive.ensureFolder(DESIGNS_FOLDER_NAME, rootId));
  const customColorsFolderId = meta.customColorsFolderId ?? (await drive.ensureFolder(CUSTOM_COLORS_FOLDER_NAME, rootId));
  const beadCatalogFolderId = meta.beadCatalogFolderId ?? (await drive.ensureFolder(BEAD_CATALOG_FOLDER_NAME, rootId));
  return { rootId, designsFolderId, customColorsFolderId, beadCatalogFolderId };
}

// customColors and beadCatalog are each pushed as one file per record (id.json
// in their own folder) — the same reason designs already are one file each,
// not a single combined array: a single shared array file gets *overwritten
// wholesale* by whichever device pushes last, silently dropping anything the
// other device had that this device doesn't also have locally. Per-record
// files make each device's push additive/non-destructive toward the other's
// records, exactly like designs already are. (This app has no cross-device
// live sync yet — Phase B — so per-record files are what make even Phase A's
// simple "each device backs up its own library" story actually safe once more
// than one device is in play.) Deliberately does not replicate designs' own
// modifiedTime overwrite guard (see pushBackupToDrive below) — a genuine
// same-id conflict here would need the same color/bead type to have first
// been Restored onto both devices and then edited differently on each, a
// much narrower case than two devices independently drawing the same design,
// and colors/bead types are cheap to just re-edit if that ever does collide.
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

// Pushes every local design plus the support files (library/preferences/
// customColors/beadCatalog) to Drive, live-overwriting each — this is the
// routine "on design close" / "Back Up Now" trigger, not the retained
// pre-migration checkpoint (see runPreMigrationBackup below).
//
// Guard rail (plan's Phase A risk #3, "single-device-safe, not multi-device-
// safe"): before overwriting a design's Drive file, this compares Drive's own
// modifiedTime against what this device recorded the last time *it* wrote
// that file. A mismatch means something else touched the file since — most
// likely another device, once more than one is ever used — so that design is
// skipped rather than silently clobbered, and reported back as "conflicted"
// for the UI to surface. Designs never pushed from this device before have no
// baseline to compare against and are pushed unconditionally (first push, or
// this device has simply never backed this one up).
//
// Also propagates pending local deletes (meta.deletedDesignIds, populated by
// main.js whenever a design is deleted locally) by removing the
// corresponding Drive file, so a later restore doesn't resurrect it.
export async function pushBackupToDrive(db, drive) {
  const meta = await getDriveSyncMeta(db);
  const { rootId, designsFolderId, customColorsFolderId, beadCatalogFolderId } = await ensureFolders(drive, meta);
  const { designs, preferences, customColors, beadCatalog } = await readAllStoreData(db);

  const designSyncedModifiedTime = { ...meta.designSyncedModifiedTime };
  const pushed = [];
  const conflicted = [];

  for (const design of designs) {
    const fileName = `${design.id}.json`;
    const knownModifiedTime = designSyncedModifiedTime[design.id];
    if (knownModifiedTime) {
      const remote = await drive.findByName(fileName, designsFolderId);
      if (remote && remote.modifiedTime !== knownModifiedTime) {
        conflicted.push(design.id);
        continue;
      }
    }
    const result = await drive.uploadJson(fileName, designsFolderId, design);
    designSyncedModifiedTime[design.id] = result.modifiedTime;
    pushed.push(design.id);
  }

  const deletedDesignIds = await propagateDeletes(drive, designsFolderId, meta.deletedDesignIds);
  for (const id of meta.deletedDesignIds) {
    if (!deletedDesignIds.includes(id)) delete designSyncedModifiedTime[id];
  }

  await drive.uploadJson('library.json', rootId, { designs: designs.map((d) => ({ id: d.id, order: d.order })) });
  await drive.uploadJson('preferences.json', rootId, preferences);
  await pushRecordsToFolder(drive, customColorsFolderId, customColors);
  const deletedCustomColorIds = await propagateDeletes(drive, customColorsFolderId, meta.deletedCustomColorIds);
  await pushRecordsToFolder(drive, beadCatalogFolderId, beadCatalog);
  const deletedBeadTypeIds = await propagateDeletes(drive, beadCatalogFolderId, meta.deletedBeadTypeIds);
  await removeLegacyCombinedFiles(drive, rootId);

  await saveDriveSyncMeta(db, {
    ...meta,
    hasConnectedBefore: true,
    rootFolderId: rootId,
    designsFolderId,
    customColorsFolderId,
    beadCatalogFolderId,
    designSyncedModifiedTime,
    deletedDesignIds,
    deletedCustomColorIds,
    deletedBeadTypeIds,
    lastBackupAt: Date.now(),
    lastError: null,
  });

  return { pushed, conflicted };
}

// One-time cleanup for a device that backed up under Phase A's first draft
// (a single combined customColors.json/beadCatalog.json) before the
// per-record fix above — leaves no stale, no-longer-read file behind in the
// root folder. No-ops once already cleaned up (findByName just returns null).
async function removeLegacyCombinedFiles(drive, rootId) {
  for (const name of [LEGACY_CUSTOM_COLORS_FILE, LEGACY_BEAD_CATALOG_FILE]) {
    const legacy = await drive.findByName(name, rootId);
    if (legacy) await drive.deleteFile(legacy.id);
  }
}

// Wraps pushBackupToDrive with a "did this actually finish" flag persisted
// *before* the upload starts and cleared only on confirmed success — guards
// against iPad Safari backgrounding/killing the network request mid-flight
// right at the moment a design closes (the plan's "secondary risks" section).
// main.js calls this (not pushBackupToDrive directly) for both the design-
// close trigger and the on-boot retry-if-still-pending check.
export async function pushBackupToDriveTracked(db, drive) {
  const meta = await getDriveSyncMeta(db);
  await saveDriveSyncMeta(db, { ...meta, pendingBackup: true });
  try {
    const result = await pushBackupToDrive(db, drive);
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

// Downloads everything currently on Drive into the same shape planRestore()
// expects — {designs, preferences, customColors, beadCatalog}.
async function pullSnapshotFromDrive(drive, meta) {
  const { rootId, designsFolderId, customColorsFolderId, beadCatalogFolderId } = await ensureFolders(drive, meta);

  const designFiles = await drive.listFiles(designsFolderId);
  const designs = await Promise.all(designFiles.map((f) => drive.downloadJson(f.id)));
  const customColors = await pullRecordsFromFolder(drive, customColorsFolderId);
  const beadCatalog = await pullRecordsFromFolder(drive, beadCatalogFolderId);

  const preferencesFile = await drive.findByName('preferences.json', rootId);
  const preferences = preferencesFile ? await drive.downloadJson(preferencesFile.id) : null;

  return { designs, preferences, customColors, beadCatalog };
}

// Restore, for a fresh install, a second device, or genuine data-loss
// recovery. Merge-by-id, never overwrite (see snapshot.js's planRestore) —
// every incoming design is run through migrateDesign() there. Returns the
// plan so the UI can show counts of what was actually added vs. already
// present, before/after the write.
export async function restoreFromDrive(db, drive) {
  const meta = await getDriveSyncMeta(db);
  const remoteSnapshot = await pullSnapshotFromDrive(drive, meta);
  const existing = await readAllStoreData(db);
  const plan = planRestore(remoteSnapshot, existing);
  await applyRestorePlan(db, plan);
  return plan;
}

// The pre-migration retained checkpoint (plan Decision #6): a distinct,
// timestamped snapshot that a routine push can never overwrite, taken right
// before a schema migration runs — the one moment this app actually controls
// that could otherwise silently corrupt data with no way back. Deliberately
// does NOT touch driveSyncMeta's routine-push bookkeeping (designSyncedModifiedTime
// etc.) — this is a side copy, not part of the live mirror.
export async function runPreMigrationBackup(db, drive) {
  const rootId = await drive.ensureFolder(ROOT_FOLDER_NAME);
  const checkpointRootId = await drive.ensureFolder(PRE_MIGRATION_FOLDER_NAME, rootId);
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
