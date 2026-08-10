// Central app state (CLAUDE.md: "one central app-state object; modules read/write
// through defined functions, not by reaching into each other's internals"). Lifted
// out of main.js's inline object literal in Phase 4 — now spans view state (which
// screen is showing), the open IndexedDB handle, preferences, the in-memory design
// list, and the current design id, alongside the existing per-design/editor fields
// carried over from Phase 1–3.

import { COLOR_LIBRARIES } from '../palette/colorLibrary.js';
import { createHistory } from './historyStore.js';

export function createAppState() {
  return {
    // App shell / navigation
    view: 'library', // 'library' | 'editor' — app always boots into the library (Phase 4 plan)
    db: null,
    preferences: null,
    designs: [], // in-memory list, kept sorted by `order`
    currentDesignId: null,

    // Per-design/editor fields (Phase 1–3, unchanged in shape)
    beadTypeKey: 'delica11',
    rows: 20,
    cols: 20,
    units: 'mm',
    gridParams: null,
    viewport: { originXmm: 0, originYmm: 0, scalePxPerMm: 10 },
    tool: 'draw',
    selectedColorId: COLOR_LIBRARIES.delica11[0].id,
    cells: new Map(), // row,col -> { colorId } — materialized *active* colorway, see src/state/cellStore.js
    history: createHistory(),

    // Phase 6 (colorways): in-memory mirror of the open design's colorway list —
    // same role appState.designs plays for the library. No live shapeEntries field:
    // the shape is always Array.from(appState.cells.keys()) at the moment it's
    // needed, so there's nowhere for a separate copy to drift out of sync.
    colorways: [],
    activeColorwayId: null,
  };
}
