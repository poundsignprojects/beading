# Phase 6 Implementation Plan — Colorways

## Context

Phases 1–5 shipped the full v1 must-have set (Decision #12: draw, erase, undo/redo, print/export) plus save/load and a project library. Per CLAUDE.md's Phase Plan, Phase 6 is: "Same-grid/alternate-palette variant (Decision #8), lightweight relative to a full duplicate (fixes prior-app pain point #3)."

Decision #8 is the literal spec: "Colorways = same grid, different color-to-cell mapping only. Not different bead counts or sizes." Pain point #3 is the motivation: in the prior app, trying a pattern in different colors means a full duplicate file — wasteful, and the two copies silently drift apart since nothing keeps them in sync.

No Phase 6 code is written yet.

## The core design question, and the decision made

Two ways to model "same grid, different color mapping":

1. **Shared shape.** All colorways of a pattern share one physical bead layout (which cells are occupied). Draw/erase always edit that shared layout, visible in every colorway immediately. Only the *color* assigned to an occupied cell is stored per-colorway.
2. **Independent copies.** Each colorway is a full standalone cell map, seeded by copying the active colorway's cells when created. Draw/erase in one colorway never touches another.

**Decided: shared shape (option 1), confirmed by the user.** It's what Decision #8 says literally, and it's the only option that can't silently drift into two different patterns the way independent copies (and the prior app's full-duplicate approach) can — drift is exactly pain point #3. The cost is real: occupancy and color become two separate concepts instead of one, and several existing modules (resize, word chart, print, undo/redo's mental model) need to know the difference. The sections below work through that cost precisely so it doesn't get discovered mid-implementation.

## Decisions confirmed for this plan

- **Storage: colorways nest inside one design record, not separate records.** A colorway isn't a first-class pattern — it's a variant of one. One library row = one design = one physical bead layout with N named colorways. This is what actually fixes pain point #3: today's the prior app problem is that colorways *are* separate top-level files; this app should not reproduce that at the storage layer even if the UI groups them visually. Switching colorways is an in-editor action (a control in `#controls`, not a library operation) — the editor stays mounted, only `cells`/`history`/the active-colorway indicator change.
- **The design record keeps an explicit top-level `shapeEntries` field — the canonical set of occupied cell keys — rather than deriving shape implicitly from the union of every colorway's color keys.** A cell that's occupied but has never been colored in *any* colorway (see the unassigned-color case below) would be invisible to a union-based derivation, since no colorway would mention its key. An explicit field also makes the invariant ("this is the one shape, colorways can't disagree about it") a single source of truth instead of an emergent property callers have to trust.
- **Occupied-but-uncolored cells get a real value, not an absence.** When cell (r,c) is drawn while colorway A is active, colorway A gets a real `colorId` for it — but colorway B, which hasn't been touched, now has a cell that's *in the shape* but has no color of its own. Represented as `{ colorId: null }` in the materialized `cells` Map (so it still renders as an occupied bead, not an empty cell — canvasRenderer already branches on cell *presence*, not colorId truthiness, so this needs no renderer change) and rendered with a distinct placeholder fill via a null-aware `resolveColor`. The user resolves it the same way they place any bead: draw over it with a real color, in that colorway.
- **Creating a colorway always seeds it as a copy of the currently active colorway's colors** (never a blank slate — a blank colorway would just mean every cell renders unassigned, which isn't a useful starting point). This means there's no separate "duplicate colorway" action; create *is* duplicate, scoped to one pattern instead of the whole library.
- **A design always has at least one colorway; deleting the last one is blocked.** Deleting the active colorway switches to the first remaining one.
- **No manual reordering of colorways in v1.** Manual ordering matters for the library (pain point #2, already solved in Phase 4) because that list can get long. A pattern's colorway list is expected to stay short (a handful of variants), so this is scoped out rather than rebuilding `designOrder.js`'s machinery for a list that doesn't need it yet.
- **Resize and regenerate must account for every colorway, not just the active one.** These already exist (Phase 5.x's resize-preserving-design work, and the original regenerate-clears-everything flow) and both mutate the shared shape — under this model that means touching every colorway's stored color data, not just what's currently on screen. Detailed below; this is the main place a shared-shape design has to be threaded carefully through existing code.
- **Destructive-action confirm copy is updated to say when more than one colorway is affected.** Today's "Clear" and bead-type-change confirms were written assuming one cell map. Under shared shape, clearing or regenerating wipes every colorway's colors, not just the one visible — the confirm text should say so when `appState.colorways.length > 1`, otherwise this reads as a silent scope change from the user's last mental model of what "Clear" does (prior-app pain point #4: never lose state silently).
- **Existing saved designs (Phase 4/5-era, already on the user's iPad) get migrated on load, not broken.** They're stored as flat `cellEntries`, no `colorways` field. A pure `migrateDesign()` step wraps any pre-Phase-6 record into a single-colorway record the first time it's read, and the migrated shape is opportunistically re-saved so the migration only has to run once per design system-wide.
- **The print/export word chart and materials table gain an explicit "unassigned" state**, distinct from a genuinely blank cell, so a colorway that's missing colors doesn't silently print as if those beads don't exist (undercounting `totalBeadCount`) or worse, print as blank/skip instructions a stitcher would follow literally. Printing isn't blocked when unassigned cells exist — same philosophy Phase 5 used for an empty design (a clear notice, not a hard stop).

## Scope boundary

Not in this phase: bead-type conversion between Delica/Rocaille (CLAUDE.md's "Later/optional" backlog item — a different, still-unscheduled feature: same grid, different bead type, vs. Phase 6's same bead type, different color); real Miyuki catalog color data (COLOR_LIBRARIES stays placeholder — irrelevant to this phase, since colorways don't care what a colorId *means*, only that it's consistent); manual colorway reordering; a library-list indicator of how many colorways a pattern has (nice-to-have, not required by Decision #8 or pain point #3); any change to fill/color-replace/cut/copy/mirror/photo-trace (Phase 7); any change to how draw/erase/pan/zoom work at the gesture level.

## Data model

**Design record, current shape (Phase 4/5) — being replaced:**
```js
{ id, name, beadTypeKey, rows, cols, cellEntries: [[cellKey, {colorId}], ...], order, createdAt, updatedAt }
```

**Design record, Phase 6 shape:**
```js
{
  id, name, beadTypeKey, rows, cols, order, createdAt, updatedAt,
  shapeEntries: [cellKey, ...],           // which cells are occupied — one set, shared by every colorway
  colorways: [
    {
      id: string,
      name: string,                        // e.g. "Colorway 1", user-renamable
      colorEntries: [[cellKey, colorId], ...],  // only cells this colorway has actually assigned a color to;
                                                 // a shapeEntries key missing here materializes as unassigned
      createdAt: number,
      updatedAt: number,
    },
    // ...
  ],
  activeColorwayId: string,
}
```

Note `colorEntries` pairs are `[cellKey, colorId]` (colorId a bare string), not `[cellKey, {colorId}]` like the old flat `cellEntries` — there's no need to wrap a single primitive, and keeping the persisted shape visually distinct from the in-memory materialized `Map<cellKey, {colorId}>` (`appState.cells`, unchanged from Phase 1) makes it harder to accidentally conflate "persisted per-colorway color data" with "the currently rendered cell map" while reading the code.

**`appState` additions** (`src/state/appState.js`):
```js
colorways: [],        // in-memory mirror of the open design's colorway list — same role appState.designs plays for the library
activeColorwayId: null,
```
`appState.cells` keeps its existing shape and role (`Map<cellKey, {colorId}>`, the materialized *active* colorway) — every existing reader (canvasRenderer, drawTool, eraseTool, historyStore, pointerRouter, resizeGrid's `resizeCells`/`countCellsLost`, wordChart) keeps working against it completely unchanged. `appState` does **not** gain a live `shapeEntries` field — the shape is always just `Array.from(appState.cells.keys())` at the moment it's needed (switching colorways, saving), so there's nowhere for a separate copy to drift out of sync with what's actually drawn.

## Why the existing tool/render/undo pipeline needs zero changes

Worth stating explicitly, since it's the thing that makes this plan tractable rather than a rewrite: every module that touches `cells` already branches on **cell presence**, not **colorId truthiness** —

- `canvasRenderer.js`: `const cell = cells?.get(key); if (cell) { ...fill with resolveColor(cell.colorId)... } else { ...empty dot... }` — a `{colorId: null}` entry already takes the filled path.
- `drawTool.js`'s `applyDrawAtCell`: compares `before.colorId === colorId`, drawing a real color over an unassigned cell (`before.colorId === null`) already produces a correct diff.
- `eraseTool.js`'s `applyEraseAtCell`: `if (!before) return null` — an unassigned cell is still a present object, erase still works.
- `historyStore.js`'s `applyPatch`: `setCell(cells, row, col, value.colorId)` is generic over whatever `colorId` is, including `null`.

So `null` as a real, storable `colorId` value falls straight through the existing pipeline. The only places that need to change are the ones that read `colorId` for *display or export* — `resolveColor` (editorView.js) and `wordChart.js` — plus the modules that didn't exist yet in a multi-colorway world: persistence, resize, and regenerate.

## File-by-file breakdown

```
/src
  /palette
    colorLibrary.js       — ADD: export UNASSIGNED_SWATCH (a fixed placeholder
                             { id: null, name: 'Unassigned', hex: <distinct color> })
                             so editorView.js and printView.js render the same thing
                             for "occupied, not yet colored" without duplicating it.

  /state
    colorwaySync.js        — NEW: pure. materializeColorwayCells(shapeEntries,
                              colorEntries) -> Map<cellKey,{colorId}>; decomposeCellsForSave(cells)
                              -> {shapeEntries, colorEntries}; pruneColorwaysToShape(colorways,
                              shapeEntries) -> colorways with out-of-shape colorEntries dropped.
    resizeGrid.js           — REFACTOR: extract the existing per-cell remap loop (shared
                              by resizeCells and countCellsLost) into a generic remapEntries()
                              over [key, value] pairs; add resizeKeyList() (for shapeEntries)
                              and resizeColorEntries() (for each colorway's colorEntries) on
                              top of it. resizeCells/countCellsLost keep their exact existing
                              signatures and behavior — no call site outside this file changes.
    appState.js             — ADD: colorways: [], activeColorwayId: null.

  /storage
    migrateDesign.js         — NEW: pure. migrateDesign(record) -> record. Passes through
                                any record that already has `colorways`; wraps a legacy
                                { cellEntries } record into a single default colorway.
    designStore.js           — UPDATE: createDesign seeds one default colorway instead of
                                cellEntries: []; duplicateDesign deep-copies shapeEntries +
                                every colorway (regenerating colorway ids); listDesignsSorted
                                runs migrateDesign() over every fetched record and re-saves
                                any that changed.

  /export
    wordChart.js             — UPDATE: distinguish "cell absent" (blank run, unchanged
                                meaning) from "cell present with colorId: null" (new:
                                unassigned run) using an exported UNASSIGNED sentinel;
                                add unassignedCount to the return value; totalBeadCount
                                includes it.

  /ui
    editorView.js             — ADD: colorway select + new/rename/delete controls and their
                                 handlers (switchColorway, handleColorwayNew/Rename/Delete);
                                 UPDATE: resolveColor handles colorId === null; regenerateGrid
                                 and handleClear wipe every colorway's colorEntries (not just
                                 appState.cells) and use colorway-aware confirm copy;
                                 applyResize remaps every colorway's colorEntries through the
                                 same anchors as the active cells Map.
    printView.js               — UPDATE: formatRun handles the UNASSIGNED sentinel; materials
                                 section shows a warning line when chart.unassignedCount > 0.

  /test
    state/colorwaySync.test.js     — NEW
    state/resizeGrid.test.js       — EXTEND (existing suite + remapEntries/resizeKeyList/
                                      resizeColorEntries cases)
    storage/migrateDesign.test.js  — NEW
    export/wordChart.test.js       — EXTEND (unassigned-run cases)

main.js                      — UPDATE: openDesign() materializes appState.cells from
                                design.shapeEntries + the active colorway's colorEntries
                                instead of entriesToCells(design.cellEntries);
                                persistCurrentDesign() decomposes + prunes + saves
                                shapeEntries/colorways instead of writing flat cellEntries.
index.html                    — ADD: #colorway-controls (select + new/rename/delete buttons)
                                 in #controls.
style.css                     — ADD: #colorway-controls layout (matches #tool-toggle/
                                 #history-controls' existing group styling), .print-warning
                                 styling for the unassigned-colors notice.
```

## `colorwaySync.js` — the core new module

```js
// The shared-shape/per-colorway-color split lives entirely in this module. Every
// other module keeps treating appState.cells as a plain Map<cellKey,{colorId}> —
// this is the only place that knows a persisted design has more than one of those.

export function materializeColorwayCells(shapeEntries, colorEntries) {
  const colorMap = new Map(colorEntries);
  const cells = new Map();
  for (const key of shapeEntries) {
    cells.set(key, { colorId: colorMap.get(key) ?? null });
  }
  return cells;
}

// The inverse: what a colorway's persisted fields should be after cells was edited
// while it was active. shapeEntries is every occupied key (this pattern's canonical
// shape, post-edit); colorEntries is only the cells this colorway actually has a
// real color for — an unassigned cell (colorId: null) is left out, not persisted
// as a null entry, since "missing" already means unassigned on the way back in.
export function decomposeCellsForSave(cells) {
  const shapeEntries = Array.from(cells.keys());
  const colorEntries = Array.from(cells.entries())
    .filter(([, value]) => value.colorId !== null)
    .map(([key, value]) => [key, value.colorId]);
  return { shapeEntries, colorEntries };
}

// After a shape edit (draw adds a key, erase removes one), every colorway's stored
// colorEntries needs to agree with the new shape — erased cells must not leave a
// stale color behind that could resurface if the same key is ever redrawn.
export function pruneColorwaysToShape(colorways, shapeEntries) {
  const shapeSet = new Set(shapeEntries);
  return colorways.map((cw) => ({
    ...cw,
    colorEntries: cw.colorEntries.filter(([key]) => shapeSet.has(key)),
  }));
}
```

All three are pure, plain-data-in/plain-data-out — fully covered by `node:test`, no DOM.

## Switching colorways (in `editorView.js`)

No design remount — canvas/tools/palette stay mounted, only `cells`/`history`/the select's value change. This is the one place the shared-shape model's "edit the active one, reconcile, then load the target" sequencing has to be gotten right:

```js
function switchColorway(newColorwayId) {
  if (newColorwayId === appState.activeColorwayId) return;

  // 1. Fold whatever's currently drawn back into the colorway list before leaving it.
  const { shapeEntries, colorEntries } = decomposeCellsForSave(appState.cells);
  appState.colorways = pruneColorwaysToShape(appState.colorways, shapeEntries).map((cw) =>
    cw.id === appState.activeColorwayId ? { ...cw, colorEntries, updatedAt: Date.now() } : cw
  );

  // 2. Materialize the target colorway against the (now up to date) shared shape.
  const target = appState.colorways.find((cw) => cw.id === newColorwayId);
  appState.cells = materializeColorwayCells(shapeEntries, target.colorEntries);
  appState.activeColorwayId = newColorwayId;

  // 3. Old undo/redo patches' before/after colors belong to the colorway that was
  //    just left — same reasoning Phase 4 already applies to design switches, and
  //    resizeGrid.js already applies to resize (a patch's meaning is only valid
  //    against the context it was recorded under).
  clearHistory(appState.history);
  updateHistoryButtons();

  updateColorwaySelect();
  scheduleRedraw();
  hooks.onImmediateSave();
}
```

`handleColorwayNew()`: decompose current cells → `colorEntries`, push a new `{ id: generateId(), name, colorEntries, createdAt, updatedAt }` onto `appState.colorways`, then call `switchColorway(newId)` — reuses the exact same materialize/clear-history/save path, and since the new colorway was seeded from what's already on screen, materializing it renders identically until the user starts recoloring.

`handleColorwayDelete()`: no-op (or disabled button) when `appState.colorways.length <= 1`; otherwise `confirm()`-guarded (matches `libraryView.js`'s delete pattern), removes the colorway, and if it was active, switches to `appState.colorways[0]` of what remains.

## Resize and regenerate: the parts that touch every colorway

**`applyResize`** (already exists, Phase 5.x): today it only remaps `appState.cells`. Under shared shape it must apply the *identical* row/col anchor offsets to every colorway's `colorEntries`, not just the active one — otherwise switching to an untouched colorway after a resize would show colors sitting at pre-resize coordinates that no longer line up with the new shape.

```js
function applyResize(newRows, newCols, rowAnchor, colAnchor) {
  appState.cells = resizeCells(appState.cells, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor);
  appState.colorways = appState.colorways.map((cw) => ({
    ...cw,
    colorEntries: resizeColorEntries(cw.colorEntries, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor),
  }));
  appState.rows = newRows;
  appState.cols = newCols;
  // ...unchanged from Phase 5.x below this line (rebuildGridParams, clearHistory, etc.)
}
```

`resizeDialog.js`'s live "this will remove N beads" warning needs **no change** — `countCellsLost` already runs against `appState.cells`, and under shared shape the active colorway's key set *is* the shape, so the count it shows is already correct for every colorway at once, not just the visible one. Worth confirming this in testing rather than assuming it, since it's the one place a bug would be silent (the dialog would just under-warn).

**`regenerateGrid`** (bead-type or forced-resize-with-clear path): already clears `appState.cells` behind a confirm. Under shared shape it must also blank every colorway's `colorEntries` — a coordinate-space change invalidates all of them, not just what's on screen — while leaving the colorway list itself (names, count) intact, since regenerating doesn't change how many colorways this pattern has, only that their contents no longer apply:

```js
appState.cells.clear();
appState.colorways = appState.colorways.map((cw) => ({ ...cw, colorEntries: [] }));
```

**Confirm copy**: `CLEAR_CONFIRM_MESSAGE` and the regenerate confirm both get a colorway-aware variant, e.g. `appState.colorways.length > 1 ? 'This will clear beads across all N colorways. Continue?' : 'This pattern has beads placed. Clear them?'` — same message when there's only one colorway (no behavior change from Phase 2–5's existing wording in the common case), explicit when there's more than one to lose.

## `migrateDesign.js`

```js
// Phase 4/5 designs were saved as flat cellEntries — no colorways field. Wraps any
// such record into a single default colorway the first time it's read. Idempotent:
// a record that already has `colorways` passes through unchanged.
export function migrateDesign(record) {
  if (record.colorways) return record;
  const now = Date.now();
  const { cellEntries, ...rest } = record;
  return {
    ...rest,
    shapeEntries: cellEntries.map(([key]) => key),
    colorways: [{
      id: generateId(),
      name: 'Colorway 1',
      colorEntries: cellEntries.map(([key, value]) => [key, value.colorId]),
      createdAt: now,
      updatedAt: now,
    }],
    activeColorwayId: /* the id just generated above */,
  };
}
```

`designStore.js`'s `listDesignsSorted` runs every fetched record through this and re-saves (`Promise.all`) any that actually changed, so the migration happens once per design, system-wide, the next time the library loads — not on every boot indefinitely, and not deferred until a design happens to be opened (a design that's never reopened would otherwise sit in the old shape forever, harmlessly but messily).

## Word chart / print changes

```js
// wordChart.js
export const UNASSIGNED = Symbol('unassigned-color');

// inside the per-cell loop, replacing `const colorId = cell ? cell.colorId : null;`
let colorId;
if (!cell) {
  colorId = null; // genuinely empty — unchanged meaning, still a blank run
} else if (cell.colorId === null) {
  colorId = UNASSIGNED;
  unassignedCount++;
} else {
  colorId = cell.colorId;
  colorCounts.set(colorId, (colorCounts.get(colorId) ?? 0) + 1);
}
```
`colorCounts`/`totalBeadCount`'s existing shape and Phase 5's existing tests are untouched — `unassignedCount` is purely additive, folded into `totalBeadCount` separately so a colorway missing colors doesn't silently undercount its own bead total.

`printView.js`'s `formatRun` gains one branch (`run.colorId === UNASSIGNED → '${run.count} ??'`), and `buildMaterials` prepends a `.print-warning` line — `"⚠ N bead(s) in this colorway have no color assigned yet."` — when `chart.unassignedCount > 0`, above the materials table rather than buried in it, so it's the first thing visible on a printout of a colorway nobody's finished coloring in yet.

## Build order + verification

1. **`colorwaySync.js` + tests.** *Verify* (`node --test`): materialize fills every shape key, defaulting to `colorId: null` for keys missing from colorEntries; decompose splits a mixed Map (some real colors, some null) into the right shapeEntries/colorEntries, excluding null entries from colorEntries; prune drops out-of-shape entries and leaves in-shape ones untouched; round-trip (materialize → decompose) on a Map with no unassigned cells reproduces the original colorEntries exactly.
2. **`resizeGrid.js` refactor + tests.** *Verify*: existing `resizeCells`/`countCellsLost` test cases still pass unchanged (behavior-preserving refactor); new `resizeKeyList`/`resizeColorEntries` cases mirror the existing grow/shrink/anchor combinations, confirming they drop the same cells `resizeCells` would for an equivalent Map.
3. **`migrateDesign.js` + tests.** *Verify*: a legacy `{cellEntries}` record produces a single colorway whose `colorEntries` matches the old data exactly, with `shapeEntries` equal to its key list; a record that already has `colorways` is returned as the same object (or a deep-equal copy — pick one and assert it); an empty legacy design (`cellEntries: []`) migrates to a colorway with empty `colorEntries` and an empty shape, not an error.
4. **`designStore.js` updates.** `createDesign` seeds one colorway; `duplicateDesign` copies `shapeEntries` and every colorway with fresh ids, remapping `activeColorwayId` to the corresponding new id; `listDesignsSorted` migrates + re-saves. No `node:test` coverage possible (no IndexedDB in Node, same as Phase 4) — verified in headless Chromium.
5. **`appState.js`, `main.js` wiring.** `openDesign` materializes from `shapeEntries` + the active colorway; `persistCurrentDesign` decomposes/prunes/saves. *Verify* (Playwright): opening a freshly created design shows one colorway; opening a **pre-existing Phase-4/5-era design** (seed the DB directly with the old flat-`cellEntries` shape before booting) loads correctly with its pattern intact under a single migrated colorway, and reloading afterward reads back the migrated (not re-migrated) shape.
6. **`editorView.js`: colorway switcher UI + `switchColorway`/new/rename/delete handlers.** *Verify* (Playwright): draw a few cells in colorway A, create colorway B (starts identical), draw a *different* cell in B (a shape change — a genuinely new cell) and recolor an existing one; switch back to A and confirm: the new cell B added now appears in A too, rendered as unassigned (distinct placeholder fill, confirmed via pixel sampling, not just presence in the DOM); the cell recolored in B did **not** change color in A (colors are per-colorway); erase a cell in A, switch to B, confirm it's gone there too (shape shrink propagates). Rename and delete both update the select and persist; deleting down to one colorway disables further deletion.
7. **`resolveColor`/canvas rendering of unassigned cells.** *Verify* (Playwright, pixel sampling): an unassigned cell renders with the placeholder fill, distinguishable from every real palette swatch and from the empty-cell dot style.
8. **`applyResize` / `regenerateGrid` colorway propagation.** *Verify* (Playwright): with 2+ colorways populated differently, resize with an anchor that shifts coordinates, then switch to the non-active colorway and confirm its beads landed in the same *relative* positions as the active one did (both shifted identically); trigger a bead-type change (regenerate) with 2+ colorways populated, confirm both colorways come back empty after confirming, and that the colorway list itself (names/count) survived.
9. **`wordChart.js`/`printView.js` unassigned handling + tests.** *Verify* (`node --test`): a row mixing real-color, blank, and unassigned cells produces three distinct run types; `unassignedCount` matches a hand-counted fixture; `totalBeadCount` includes it. *Verify* (Playwright): printing a colorway with unassigned cells shows the warning line and `??` markers in the chart; printing a fully-colored colorway shows neither (no regression from Phase 5's existing verified behavior).
10. **Full regression pass** (Playwright): run through Phases 1–5's existing verification scenarios (draw/erase/undo/redo/resize/save-reload/print) against a **single-colorway** design end to end, confirming nothing in the shared-shape plumbing changed single-colorway behavior — this is the case every existing saved design and every prior phase's testing assumed, so it's the one that must not regress.
11. **Real iPad pass**: colorway select + new/rename/delete controls at iPad touch size in `#controls` (already a fairly full toolbar — confirm it doesn't wrap awkwardly or crowd existing controls); switching colorways feels instant (no visible flash/rebuild, since the editor never remounts); the unassigned-cell placeholder fill is visually distinct enough to notice while actually stitching-testing a design, not just in a side-by-side pixel diff; confirm a **real pre-Phase-6 design already saved on the iPad** opens correctly post-migration before relying on this in practice.

## Open, low-stakes implementation calls

Both are easy to revisit later without touching the data model or any of the modules above — deliberately not blocking on them:

1. **Exact unassigned-cell placeholder color/pattern.** Plan assumes a flat, distinct fill (`UNASSIGNED_SWATCH` in `colorLibrary.js`) rather than a hatch/stripe pattern — flat is a few lines in `canvasRenderer.js`'s existing fill path, a pattern would need `ctx.createPattern` plumbed through, which is real added complexity for a v1 visual nicety. Easy to upgrade later since it's isolated to `resolveColor`.
2. **Colorway control layout** (`select` + three icon buttons vs. a tab strip). Plan assumes the simpler select+icons form, consistent with `#tool-toggle`/`#history-controls`'s existing compact grouped-button style — worth a look on the real iPad screen at step 11 before treating it as final, same as the orientation/layout notes already logged from earlier phases' iPad testing.

## Next step after this plan

No code has been written for this phase yet. Build order above; step 1 (`colorwaySync.js`) has no dependencies on anything else in this plan and is the natural starting point.
