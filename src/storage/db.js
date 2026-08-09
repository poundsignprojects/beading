// Generic IndexedDB promise wrapper. No design- or preference-shaped logic here —
// designStore.js/preferencesStore.js are the shape-specific layers on top.

const DB_NAME = 'bead-pattern-designer';
const DB_VERSION = 1;

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences', { keyPath: 'id' });
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
