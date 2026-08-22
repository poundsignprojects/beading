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
  printStartDirection: 'right',
  showBeadOutlines: true,
  printIncludeReferenceImage: true,
};

// defaultRows/defaultCols ("last resize becomes the new default size") need the
// identical one-time swap migrateDesign.js's migrateAxisConvention applies to a
// design's own rows/cols — same axisVersion marker convention, on this store's
// one global record (see .work/refactor-row-col-axis-naming-plan.md).
function migratePreferencesAxisConvention(record) {
  if (record.axisVersion === 2) return record;
  return {
    ...record,
    defaultRows: record.defaultCols,
    defaultCols: record.defaultRows,
    axisVersion: 2,
  };
}

export async function getPreferences(db) {
  const stored = await get(db, STORE, PREFERENCES_ID);
  if (!stored) return { ...DEFAULT_PREFERENCES, axisVersion: 2 };
  const migrated = migratePreferencesAxisConvention(stored);
  if (migrated !== stored) await savePreferences(db, migrated);
  return migrated;
}

export async function savePreferences(db, preferences) {
  const updated = { ...preferences, id: PREFERENCES_ID };
  await put(db, STORE, updated);
  return updated;
}
