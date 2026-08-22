// Central app state (CLAUDE.md: "one central app-state object; modules read/write
// through defined functions, not by reaching into each other's internals"). Lifted
// out of main.js's inline object literal in Phase 4 — now spans view state (which
// screen is showing), the open IndexedDB handle, preferences, the in-memory design
// list, and the current design id, alongside the existing per-design/editor fields
// carried over from Phase 1–3.

import { createHistory } from './historyStore.js';

export function createAppState() {
  return {
    // App shell / navigation
    view: 'library', // 'library' | 'editor' — app always boots into the library (Phase 4 plan)
    db: null,
    preferences: null,
    designs: [], // in-memory list, kept sorted by `order`
    currentDesignId: null,
    // User-defined bead type catalog (see src/storage/beadCatalogStore.js,
    // src/palette/beadSpecs.js's findBeadType) — full in-memory list, loaded once
    // at boot (like preferences) and mutated in place, same role
    // appState.designs/appState.customColors play for their own stores.
    beadCatalog: [],

    // Per-design/editor fields (Phase 1–3, unchanged in shape)
    beadTypeKey: 'delica11',
    // A design's stitch type is chosen once and is fixed (same "no in-place
    // geometry mutation" rule as bead type) — see src/grid/gridEngine.js and
    // .work/feature-square-stitch-plan.md.
    stitchType: 'peyote',
    rows: 20,
    cols: 20,
    // Per-design constant deciding which parity of column renders "raised" vs
    // "recessed" (see src/grid/peyote.js's isRaised) — set once, at migration
    // or creation time, and never recomputed from a design's current column
    // count, so it can't reintroduce the resize-stagger-flip bug that rule was
    // written to fix. false reproduces this file's own default stagger; true
    // restores the exact look a pre-existing odd-column design always had,
    // before this constant existed (see migrateDesign.js's migrateStaggerFlip).
    staggerFlipped: false,
    units: 'mm',
    showBeadOutlines: true, // whether drawGrid strokes a bead outline or fills edge-to-edge; mirrors `units`' preference-backed-default-then-session-toggle pattern
    gridParams: null,
    viewport: { originXmm: 0, originYmm: 0, scalePxPerMm: 10 },
    tool: 'draw',
    // Phase 8: no static catalog to point to anymore (see src/palette/colorLibrary.js)
    // — resolved once appState.customColors loads for whichever bead type is open.
    // null is a real "nothing picked yet" state, not just Phase 6's "unassigned cell".
    selectedColorId: null,
    customColors: [], // current beadTypeKey's user-built palette only — see customColorStore.js
    cells: new Map(), // row,col -> { colorId } — materialized *active* colorway, see src/state/cellStore.js
    history: createHistory(),

    // Phase 6 (colorways): in-memory mirror of the open design's colorway list —
    // same role appState.designs plays for the library. No live shapeEntries field:
    // the shape is always Array.from(appState.cells.keys()) at the moment it's
    // needed, so there's nowhere for a separate copy to drift out of sync.
    colorways: [],
    activeColorwayId: null,

    // Phase 7: editor-session state layered on top of appState.cells — none of
    // these follow the shared-shape colorway model, and none are part of a
    // design's saved shape/color data (clipboard and selection aren't persisted
    // at all; photoTrace persists separately, to its own store — see
    // src/storage/photoTraceStore.js).
    selection: null, // { rowStart, rowEnd, colStart, colEnd } (inclusive) or null
    clipboard: null, // { rows, cols, cells: [[relRow, relCol, colorId], ...] } or null
    photoTrace: null, // { image, opacityPercent, xMm, yMm, widthMm, heightMm } or null

    // Draggable paste placement: which side wins where a pending paste overlaps
    // existing beads ('front' = pasted content wins, matching Phase 7's original
    // one-shot-stamp behavior; 'behind' = existing beads win) — session-only like
    // appState.tool, not persisted with the design. pastePreview holds the anchor
    // of a pending, not-yet-confirmed paste while the 'paste' tool is active.
    pasteMode: 'front', // 'front' | 'behind'
    pastePreview: null, // { anchorRow, anchorCol } or null
  };
}
