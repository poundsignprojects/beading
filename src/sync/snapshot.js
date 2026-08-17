// Assembles/restores a portable snapshot of everything in IndexedDB except
// photoTraces (see .work/feature-cloud-sync-plan.md's Scope — multi-MB Blobs,
// regeneratable from the user's own photo library, not app-authored data).
// Shared by both the Google-free local JSON-file export/import
// (localBackupFile.js) and the Google Drive backup transport (backupSync.js) —
// this module knows nothing about *where* the JSON ends up, only its shape and
// how to merge one back in safely. Pure: takes already-loaded arrays in,
// returns plain data out, never touches IndexedDB itself.

import { migrateDesign } from '../storage/migrateDesign.js';

export const SNAPSHOT_VERSION = 1;

export function assembleSnapshot({ designs, preferences, customColors, beadCatalog }) {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    exportedAt: Date.now(),
    designs,
    preferences,
    customColors,
    beadCatalog,
  };
}

// Pure planning step: decides what a restore would actually do, without
// writing anything. A record whose id already exists locally is always
// skipped, never overwritten — restore is additive-only (plan Decision #7,
// "merge-by-id, never wipe-and-replace"). Every incoming design is run
// through migrateDesign() here (Decision #9) so an old snapshot survives the
// same shape changes a local record already would on load. `existing` is
// `{designs, customColors, beadCatalog}` — the current local lists.
export function planRestore(snapshot, existing) {
  const existingDesignIds = new Set(existing.designs.map((d) => d.id));
  const existingColorIds = new Set(existing.customColors.map((c) => c.id));
  const existingBeadIds = new Set(existing.beadCatalog.map((b) => b.id));

  const designsToCreate = [];
  const designsSkipped = [];
  for (const rawDesign of snapshot.designs ?? []) {
    const design = migrateDesign(rawDesign);
    (existingDesignIds.has(design.id) ? designsSkipped : designsToCreate).push(design);
  }

  const customColorsToCreate = [];
  const customColorsSkipped = [];
  for (const color of snapshot.customColors ?? []) {
    (existingColorIds.has(color.id) ? customColorsSkipped : customColorsToCreate).push(color);
  }

  const beadCatalogToCreate = [];
  const beadCatalogSkipped = [];
  for (const bead of snapshot.beadCatalog ?? []) {
    (existingBeadIds.has(bead.id) ? beadCatalogSkipped : beadCatalogToCreate).push(bead);
  }

  return {
    designsToCreate,
    designsSkipped,
    customColorsToCreate,
    customColorsSkipped,
    beadCatalogToCreate,
    beadCatalogSkipped,
    // Preferences are a single global settings row, not user-created pattern
    // content — applying them on restore (a deliberate, user-initiated action)
    // isn't the same kind of risk as silently overwriting a design, so there's
    // no skip/keep split for it the way there is above.
    preferences: snapshot.preferences ?? null,
  };
}
