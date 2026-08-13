// Generic IndexedDB promise wrapper. No design- or preference-shaped logic here —
// designStore.js/preferencesStore.js are the shape-specific layers on top.

const DB_NAME = 'bead-pattern-designer';
const DB_VERSION = 5;

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
    };
    request.onsuccess = () => resolve(request.result);
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
