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
  defaultStitchType: 'peyote',
  // "Last-used becomes the new default," same role as defaultStitchType/
  // defaultRows/defaultCols. A stored preferences row saved before this field
  // existed comes back with defaultDropCount: undefined, not this default —
  // read `prefs.defaultDropCount ?? 1` at consuming call sites rather than
  // trusting the stored object to already have it (see
  // .work/feature-multi-drop-peyote-plan.md's caveat, same class of gap
  // already found once in driveSyncStore.js's getDriveSyncMeta).
  defaultDropCount: 1,
  defaultRows: 20,
  defaultCols: 20,
  panelCollapsed: false,
  libraryViewMode: 'list',
  // Whether the library shows each multi-colorway design's colorways inline as
  // their own (non-draggable) cards, off by default — same "added screen real
  // estate a user should opt into" reasoning as showRuler below.
  libraryShowColorways: false,
  printStartDirection: 'right',
  showBeadOutlines: true,
  printIncludeReferenceImage: true,
  // Global multiplier applied on top of the CSS spec's 96px/inch assumption when
  // rendering Actual Size (see editorView.js's setViewportToActualSize) — 1 means
  // "trust the raw assumption completely." Corrects for real screen DPI varying
  // by device/browser/OS zoom, via the Actual Size calibration control.
  actualSizeCalibration: 1,
  // Whether the top/left ruler is shown alongside the canvas — off by default
  // (added screen real estate a new feature shouldn't impose until opted in),
  // see .work/feature-ruler-rotation-viewmode-datefix-plan.md §1.
  showRuler: false,
  // Live pattern canvas background, for previewing transparent beads against
  // something other than white while working — DOM swatches (palette, Manage
  // Colors, picker preview) always stay pinned to white regardless of this.
  // canvasBackgroundHex is only meaningful when mode === 'custom'; retained
  // even after switching away so re-selecting Custom doesn't lose the last
  // pick. See .work/feature-bead-finish-effects-mvp-plan.md.
  canvasBackgroundMode: 'white', // 'white' | 'dark' | 'checkerboard' | 'custom'
  canvasBackgroundHex: null,
  // Whether Move/Paste snap a sideways shift to the nearest column delta that
  // can't flip peyote's raised/recessed stagger for the moved content (see
  // nearestParityPreservingColDelta in grid/peyote.js and pointerRouter.js's
  // use of it). Defaults on, since an un-snapped odd-column shift silently
  // distorts the pattern with no visual warning. Same "stored row saved before
  // this field existed comes back undefined, not this default" gotcha as
  // defaultDropCount above — read `prefs.preserveStaggerOnShift !== false`
  // at consuming call sites, never trust the stored object already has it.
  preserveStaggerOnShift: true,
  // Which mode the custom color picker (colorPickerDialog.js) opens in —
  // 'hsv' (saturation/value square + hue bar) or 'hsl' (three sliders).
  // Same "stored row saved before this field existed comes back undefined,
  // not this default" gotcha as defaultDropCount/preserveStaggerOnShift
  // above — read `prefs.colorPickerMode === 'hsl' ? 'hsl' : 'hsv'` at
  // consuming call sites, never trust the stored object already has it.
  colorPickerMode: 'hsv',
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
