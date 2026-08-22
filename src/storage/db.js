// Generic IndexedDB promise wrapper. No design- or preference-shaped logic here —
// designStore.js/preferencesStore.js are the shape-specific layers on top.

const DB_NAME = 'bead-pattern-designer';
// Bumped 6 -> 7 for the row/col-axis rename (see
// .work/refactor-row-col-axis-naming-plan.md) — no new object store is needed
// for this migration (it's a record-shape change, handled entirely by
// migrateDesign.js/preferencesStore.js on read), but the version bump alone
// still trips main.js's attemptPreMigrationDriveBackup() pre-migration warning,
// the same safety net every prior schema version bump has gotten.
const DB_VERSION = 7;

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences', { keyPath: 'id' });
      // Its own store, not embedded in a design record: a design is rewritten on
      // every debounced autosave while drawing, and a photo trace's image Blob can
      // be several MB — position/opacity change far less often than cell data does,
      // so keeping this separate avoids re-serializing the blob on every cell edit.
      if (!db.objectStoreNames.contains('photoTraces')) db.createObjectStore('photoTraces', { keyPath: 'designId' });
      // Phase 8: user-built palette, scoped per bead type (see customColorStore.js)
      // rather than one global list — a Delica and a Rocaille aren't interchangeable
      // even painted the same color.
      if (!db.objectStoreNames.contains('customColors')) db.createObjectStore('customColors', { keyPath: 'id' });
      // User-defined bead type catalog (see beadCatalogStore.js) — replaces the
      // earlier fixed Delica/Rocaille pair + per-field beadSpecOverrides store
      // (DB_VERSION 4, dropped here). Global, not per-design: a bead type's
      // physical dimensions apply to every design that uses it.
      if (!db.objectStoreNames.contains('beadCatalog')) db.createObjectStore('beadCatalog', { keyPath: 'id' });
      // Google Drive backup/sync bookkeeping (see driveSyncStore.js) — Drive
      // folder/file ids and per-design last-synced markers, never the OAuth
      // token itself (that stays in memory only, per session).
      if (!db.objectStoreNames.contains('driveSync')) db.createObjectStore('driveSync', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const CURRENT_DB_VERSION = DB_VERSION;

// Opens the database at whatever version is already on disk, without
// upgrading it — a version-less indexedDB.open() connects at the existing
// version, or creates an empty one at version 1 if none exists yet.
// `wasBrandNew` distinguishes "just created, nothing to protect" from "really
// is on an old version." Used by main.js's boot() to read/back-up existing
// data (via the returned db handle) *before* openDatabase() runs the real
// upgrade to CURRENT_DB_VERSION — see .work/feature-cloud-sync-plan.md's
// Phase A risks section ("pre-migration backup must block the migration").
// Caller is responsible for closing the returned db once done with it.
export function openExistingDatabase() {
  return new Promise((resolve, reject) => {
    let wasBrandNew = false;
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = (event) => {
      wasBrandNew = event.oldVersion === 0;
    };
    request.onsuccess = () => resolve({ db: request.result, wasBrandNew });
    request.onerror = () => reject(request.error);
  });
}

function run(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const store = db.transaction(storeName, mode).objectStore(storeName);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const getAll = (db, storeName) => run(db, storeName, 'readonly', (s) => s.getAll());
export const get = (db, storeName, key) => run(db, storeName, 'readonly', (s) => s.get(key));
export const put = (db, storeName, value) => run(db, storeName, 'readwrite', (s) => s.put(value));
export const del = (db, storeName, key) => run(db, storeName, 'readwrite', (s) => s.delete(key));
