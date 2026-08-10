// Global preferences record — fixes prior-app pain point #1 (CLAUDE.md). A single
// row, id: 'global'. No dedicated preferences UI: main.js writes this record back
// whenever regenerateGrid()/units-toggle run (see Phase 4 plan's "Decisions confirmed").

import { get, put } from './db.js';

const STORE = 'preferences';
const PREFERENCES_ID = 'global';

const DEFAULT_PREFERENCES = {
  id: PREFERENCES_ID,
  units: 'mm',
  defaultBeadTypeKey: 'delica11',
  defaultRows: 20,
  defaultCols: 20,
  panelCollapsed: false,
  libraryViewMode: 'list',
};

export async function getPreferences(db) {
  const stored = await get(db, STORE, PREFERENCES_ID);
  return stored ?? { ...DEFAULT_PREFERENCES };
}

export async function savePreferences(db, preferences) {
  const updated = { ...preferences, id: PREFERENCES_ID };
  await put(db, STORE, updated);
  return updated;
}
