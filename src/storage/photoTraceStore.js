// CRUD for a design's photo trace reference image, keyed by designId. Kept in its
// own object store rather than embedded in the design record — see db.js's comment
// on the photoTraces store for why. No node:test coverage here: no IndexedDB in
// Node (same reasoning as designStore.js/preferencesStore.js) — verified in
// headless Chromium instead.

import { get, put, del } from './db.js';

const STORE = 'photoTraces';

export const getPhotoTrace = (db, designId) => get(db, STORE, designId);

export const savePhotoTrace = (db, designId, record) =>
  put(db, STORE, { ...record, designId, updatedAt: Date.now() });

export const deletePhotoTrace = (db, designId) => del(db, STORE, designId);
