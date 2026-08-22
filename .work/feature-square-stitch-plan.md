# Square stitch — implementation plan

Status: **implemented in full** — see CLAUDE.md's Phase Status "Square stitch" entry for the build/verification writeup. Originally written per direct request, grounded in the current codebase (peyote engine post-`refactor-row-col-axis-naming-plan.md`, Phase 8 custom colors, bead catalog, colorways), with both open decisions below (print-direction alternation, word-chart-vs-picture-chart) confirmed with the user before implementation — see "Confirmed with the user" notes inline. Implemented exactly per this plan's build order and file-by-file scope, with one bug caught and fixed during implementation beyond what the plan anticipated: the plan's own peyote row-label sketch (`Row ${row + 2}` for both halves of a split row) would have mislabeled the second half of every row past the foundation — the real formula needs `row * 2 + 1` / `row * 2 + 2` for the raised/non-raised halves respectively, derived and verified against the pre-existing `formatRowLabel` this replaced before trusting it (see `wordChart.js`'s `buildWordChart`).

## Goal

Add square stitch as a second stitch/grid type, alongside peyote, without disturbing peyote's own (already fragile, already-bug-prone) grid math. A design's stitch type is chosen once and is fixed — the same "no in-place geometry mutation" rule this app already applies to bead type (see `.work/feature-bead-catalog-and-conversion-plan.md`'s Part C).

Square stitch, geometrically, is much simpler than peyote: beads sit in a true row/col grid, stacked directly on top of and beside each other, with **no offset between passes**. There's no stagger, no `isRaised`, no "which parity is raised" concept, and adjacency is plain 4-connectivity (up/down/left/right) instead of peyote's 6.

## Why this touches so much of the codebase

Every render/interaction/export module currently imports `src/grid/peyote.js`'s functions directly and assumes peyote's offset-row geometry:

- `src/render/canvasRenderer.js` (`drawPeyoteGrid`)
- `src/interaction/pointerRouter.js` (hit-testing: `peyoteCellAtPoint`/`peyoteCellAtPointClamped`/`peyoteCellAtPointUnbounded`)
- `src/render/selectionOverlay.js`, `src/render/pastePreviewOverlay.js`, `src/render/thumbnailRenderer.js` (all call `peyoteCellOriginMm` directly)
- `src/tools/fillTool.js` (`peyoteNeighbors` for flood-fill adjacency)
- `src/export/wordChart.js` (`isRaised`, plus peyote-specific row-splitting/foundation-combining logic)

The fix is a small grid-engine abstraction these modules go through instead of importing `peyote.js` directly — see "Architecture" below. The good news, confirmed by reading each module below: **most of the tool/state layer needs zero changes**, because it was already written stitch-agnostic:

| Module | Stitch-aware today? | Needs changes for square? |
|---|---|---|
| `src/tools/drawTool.js`, `eraseTool.js`, `colorReplaceTool.js` | No | No |
| `src/tools/cutCopyTool.js` (`buildClipboard`/`applyEraseRegion`/`applyPaste`) | No | No |
| `src/tools/mirrorTool.js` (`applyMirror`) | No | No — the even-width-horizontal-flip restriction is enforced by the **UI**, not this function |
| `src/state/resizeGrid.js` | No | No |
| `src/state/colorwaySync.js`, `cellStore.js`, `historyStore.js`, `strokePatch.js` | No | No |
| `src/render/viewport.js` | No | No |
| `src/ui/beadCatalogDialog.js` | No | No (see "Bead dimension mapping" below) |

Only the grid-geometry and export layers need real work.

## Architecture: a grid-engine resolver, peyote.js untouched

`src/grid/peyote.js` is dense, heavily-commented, and has been the source of multiple real bugs already (see CLAUDE.md's Phase Status — the axis rename, the resize-stagger-flip bug, the stagger-flip migration). **It gets zero changes in this plan.** Instead:

### New file: `src/grid/square.js`

Square stitch's own grid math, mirroring `peyote.js`'s exported function names but far simpler (no stagger, no `flipped`, no `positiveMod2` concerns since there's no negative-parity case to guard against):

```js
export function squareCellOriginMm(row, col, beadWidthMm, beadHeightMm) {
  return { xMm: col * beadHeightMm, yMm: row * beadWidthMm };
}

export function generateSquareGrid({ rows, cols, beadWidthMm, beadHeightMm }) {
  return {
    rows, cols, beadWidthMm, beadHeightMm,
    boundingBoxMm: { widthMm: cols * beadHeightMm, heightMm: rows * beadWidthMm },
  };
}

export function squareCellAtPoint(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) { /* floor + bounds check, returns null outside */ }
export function squareCellAtPointClamped(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) { /* floor + clamp into bounds */ }
export function squareCellAtPointUnbounded(xMm, yMm, beadWidthMm, beadHeightMm) { /* floor, no bounds check */ }
export function squareNeighbors(row, col) {
  return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]];
}
```

**Bead dimension mapping — deliberately identical to peyote's, not "corrected."** `peyoteCellOriginMm` spaces columns by `beadHeightMm` and rows by `beadWidthMm` — which reads backwards until you know why: the Bead Catalog dialog's "W"/"H" labels were deliberately bound to those same swapped fields (`beadCatalogDialog.js`, see CLAUDE.md Phase Status — "growing the value under the 'W' label... grew the pattern's on-screen bounding-box *width*") specifically so the dialog's labels match peyote's *on-screen* effect, not the bead's raw internal field name. That fix already established what "W" and "H" mean to a user of this app: on-screen width and height, for whichever bead type is open. If square stitch used the opposite mapping (`col * widthMm`, `row * heightMm`), the same bead type — same catalog entry, same "W"/"H" values the user already set — would render a visibly different-sized bead depending on which stitch type the open design happens to use, with no indication why. That's exactly the kind of silent, confusing mismatch this project's history (the whole row/col saga) shows is worth avoiding. So `square.js` reuses the identical field mapping, just without the stagger-offset term — a bead type looks the same size on screen in both stitch types, and the Bead Catalog dialog needs no changes at all.

### New file: `src/grid/gridEngine.js`

```js
import { peyoteCellOriginMm, generatePeyoteGrid, peyoteCellAtPoint, peyoteCellAtPointClamped, peyoteCellAtPointUnbounded, peyoteNeighbors } from './peyote.js';
import { squareCellOriginMm, generateSquareGrid, squareCellAtPoint, squareCellAtPointClamped, squareCellAtPointUnbounded, squareNeighbors } from './square.js';

const peyoteEngine = {
  generateGrid: (p) => generatePeyoteGrid(p),
  cellOrigin: (row, col, p) => peyoteCellOriginMm(row, col, p.beadWidthMm, p.beadHeightMm, p.cols, p.staggerFlipped),
  cellAtPoint: (xMm, yMm, p) => peyoteCellAtPoint(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.rows, p.cols, p.staggerFlipped),
  cellAtPointClamped: (xMm, yMm, p) => peyoteCellAtPointClamped(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.rows, p.cols, p.staggerFlipped),
  cellAtPointUnbounded: (xMm, yMm, p) => peyoteCellAtPointUnbounded(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.cols, p.staggerFlipped),
  neighbors: (row, col, p) => peyoteNeighbors(row, col, p.cols, p.staggerFlipped),
};

const squareEngine = {
  generateGrid: (p) => generateSquareGrid(p),
  cellOrigin: (row, col, p) => squareCellOriginMm(row, col, p.beadWidthMm, p.beadHeightMm),
  cellAtPoint: (xMm, yMm, p) => squareCellAtPoint(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.rows, p.cols),
  cellAtPointClamped: (xMm, yMm, p) => squareCellAtPointClamped(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.rows, p.cols),
  cellAtPointUnbounded: (xMm, yMm, p) => squareCellAtPointUnbounded(xMm, yMm, p.beadWidthMm, p.beadHeightMm),
  neighbors: (row, col) => squareNeighbors(row, col),
};

export function resolveGridEngine(stitchType) {
  return stitchType === 'square' ? squareEngine : peyoteEngine; // peyote is the default/fallback
}
```

Every engine function takes the same `gridParams`-shaped object every consumer already has in hand (it already carries `rows`/`cols`/`beadWidthMm`/`beadHeightMm`/`staggerFlipped`) — so call sites change from e.g. `peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm, cols, staggerFlipped)` to `engine.cellOrigin(row, col, gridParams)`, resolving `engine` once via `resolveGridEngine(gridParams.stitchType)` at the top of the function rather than threading it through every call. This is mechanical but touches every render/interaction file listed above.

One consequence worth calling out: `canvasRenderer.js`'s visible-range culling (`visibleIndexRange`, called once for cols with `beadHeightMm` and once for rows with `beadWidthMm`) needs **no change** — because square's origin mapping deliberately reuses the same field-to-axis pairing as peyote (see above), the same culling math is already correct for both engines. Only the per-cell origin lookup inside the render loop routes through the engine.

### `wordChart.js` — real second algorithm, not just a parameterized adapter

Peyote's word chart isn't just "peyote's geometry" — it encodes a real structural fact about how peyote is *stitched* (each physical row beyond the foundation is worked as two separate alternating-position thread passes; see the existing file's own long comment). Square stitch has no such structure: each physical row is one straight pass. This can't be handled by the grid-engine abstraction above; it needs its own branch inside `buildWordChart`.

Concretely, `buildWordChart(cells, rows, cols, stitchType = 'peyote', flipped = false)` gains:

```js
if (stitchType === 'square') {
  for (let row = 0; row < rows; row++) {
    pushEntry(rowCellsAt(row), `Row ${row + 1}`);
  }
} else {
  // existing peyote logic: foundation row combined, every later row split by isRaised
}
```

`pushEntry` is extended to take a `rowLabel` string and store it on the returned chart-row object, computed by whichever branch produced it. This lets `printView.js`'s peyote-specific `formatRowLabel` (the `entryIndex === 0 ? 'Row 1 & 2' : Row ${entryIndex+2}` logic) be **deleted** — it just reads `chartRow.rowLabel` — so `printView.js` needs no stitch-type awareness of its own. `isRowReversed`/`displayRuns`/`buildRuns`/`UNASSIGNED` are already generic (keyed off `entryIndex` parity, not stitch structure) and are reused unchanged for both.

**Confirmed with the user**: square stitch entries alternate print direction (→/←) per row, same convention as peyote, respecting the existing `printStartDirection` preference. Reuses `isRowReversed`/`displayRuns` unchanged — no new UI needed.

**Confirmed with the user**: square stitch's printout uses the same row-by-row **word chart** (run-length text lines: `"Row 3 →: 5A 3blank 2B"`) as peyote, not a visual pixel/grid chart. Reuses this app's entire existing print/materials/color-code infrastructure with no new rendering path — the existing "print reference image" feature (a small rendered picture of the whole pattern) already covers the at-a-glance visual need on top of the word chart.

## Data model + migration

New field on a design record: **`stitchType: 'peyote' | 'square'`**.

- `src/storage/migrateDesign.js` gains a fourth step, `migrateStitchType`, gated on field presence (same pattern as `migrateStaggerFlip` — independent of `axisVersion`): a record with no `stitchType` gets `stitchType: 'peyote'`. Composed as the outermost step: `migrateStitchType(migrateStaggerFlip(migrateAxisConvention(migrateLegacyColorways(record))))`.
- `src/storage/designStore.js`: `createDesign`/`createConvertedDesign` gain a required `stitchType` param, stamped directly (no migration needed for freshly-created records, same as `axisVersion`/`staggerFlipped` today).
- `src/storage/preferencesStore.js`: `DEFAULT_PREFERENCES` gains `defaultStitchType: 'peyote'` — same "last-used becomes the new default" role `defaultBeadTypeKey`/`defaultRows`/`defaultCols` already play. No axis-style migration needed (a simple new field, not a row/col swap).
- `src/state/appState.js` gains `stitchType: 'peyote'`.
- `db.js`'s `DB_VERSION` bumps by 1 (no schema change, same as the last few bumps — purely to trip the existing pre-migration Drive-backup warning per `.work/refactor-row-col-axis-naming-plan.md`'s Backup Safety precedent).

No changes needed to `shapeEntries`/`colorways`/cell-key format — a cell's `(row, col)` address means the same thing regardless of stitch type; only how it's *rendered* changes. This is why a stitch-type conversion (below) can carry `shapeEntries`/`colorways` over completely unchanged, unlike bead-type conversion which had to remap colors.

## UI/UX

**Where it's chosen**: a new "Stitch Type" `<select>` in `#settings-dialog` (`index.html`), next to the existing Bead Type select. `handleCreate()` (`main.js`) seeds new designs from `prefs.defaultStitchType`, exactly mirroring how `defaultBeadTypeKey`/`defaultRows`/`defaultCols` already work — no new dialog at "+ New" time.

**Changing it on an existing design** follows the same fork `handleBeadTypeChange` already uses:
- **Empty design** (`appState.cells.size === 0`): switches directly — set `appState.stitchType`, rebuild grid params, refit viewport, redraw, save. No confirmation needed (nothing to lose).
- **Non-empty design**: **clone-based**, not in-place — same rationale as Convert Bead Type (Part C of `.work/feature-bead-catalog-and-conversion-plan.md`): preserves the "always reversible, original never touched" guarantee and sidesteps the undo-history-clearing question a live geometry change would otherwise force. Simpler than bead-type conversion, though: **no color-remapping dialog is needed at all**, since the palette doesn't change — only geometry does, and `shapeEntries`/`colorways` carry over verbatim. So instead of `convertBeadTypeDialog.js`'s full mapping UI, this is just a `window.confirm()` ("This will create a new pattern using Square Stitch instead of Peyote — the two use different bead geometry, so a new pattern is created and the original is left untouched.").
- New `main.js` handler `handleStitchTypeConvertConfirmed(targetStitchType)` — structurally a trimmed copy of `handleBeadTypeConvertConfirmed` (same flush-then-clone-then-reopen sequence) minus the mapping-table step, calling `createConvertedDesign` with the *same* `beadTypeKey`/`colorways`/`shapeEntries` and the new `stitchType`. The new design keeps the source's exact name (no suffix), matching the already-established "distinguish by a library-row label, not a name suffix" convention from the Convert Bead Type naming simplification (see CLAUDE.md Phase Status).

**Mirror tool constraint**: `editorView.js`'s `updateSelectionButtons()` currently disables Mirror Horizontal on an even-width selection *unconditionally*, because peyote's stagger makes an even-width horizontal flip land content on the wrong parity (see `mirrorTool.js`'s own comment). Square stitch has no stagger at all, so this restriction doesn't apply — the check becomes `appState.stitchType === 'peyote' && widthEven`. `mirrorTool.js`'s `applyMirror` itself needs no change (it's pure coordinate-flipping, already stitch-agnostic).

**Fill tool adjacency**: `fillTool.js`'s `applyFill` currently imports `peyoteNeighbors` directly and takes `(cells, startRow, startCol, colorId, rows, cols, flipped)`. Changes to take an injected `neighborsFn(row, col) => [[row,col], ...]` instead of `cols`/`flipped` — keeps `fillTool.js` itself grid-engine-agnostic (consistent with its existing "pure function, no grid-math imports beyond adjacency" role). The caller (`pointerRouter.js`'s `performDiscreteAction`) passes `(r, c) => engine.neighbors(r, c, gridParams)`.

**Library display**: `libraryView.js`'s existing per-row bead-type line (`.library-row-beadtype`, added in the "bead type shown per row" session) gets the stitch type appended — e.g. `"Delica 11/0 — Peyote"` / `"Delica 11/0 — Square Stitch"` — via a new `callbacks.resolveStitchTypeLabel(stitchType)`, rather than a new row/line (list rows are already fairly tall with rename/duplicate/delete/colorway-badge). Low-stakes, easy to change to a separate line later if it reads as crowded.

**Print header**: `printView.js`'s `buildHeader` spec line (`"${bead.name} — ${rows} rows × ${cols} cols"`) gets the stitch type folded in too (`"${bead.name}, ${stitchLabel} — ..."`) — minor, not load-bearing.

## File-by-file scope

| File | Change |
|---|---|
| `src/grid/square.js` | **New.** Square's grid math (see above). |
| `src/grid/gridEngine.js` | **New.** `resolveGridEngine(stitchType)` resolver. |
| `src/grid/peyote.js` | **Unchanged.** |
| `src/render/canvasRenderer.js` | `drawPeyoteGrid` → renamed `drawGrid`; resolves engine from `gridParams.stitchType`, calls `engine.cellOrigin(...)` instead of `peyoteCellOriginMm(...)` directly. Culling math (`visibleIndexRange` calls) unchanged. |
| `src/interaction/pointerRouter.js` | Every `peyoteCellAtPoint*` call → `engine.cellAtPoint*(..., gridParams)`, engine resolved from `gridParams.stitchType` at each call site (`applyToolAtWorld`, `performDiscreteAction`, `performEyedropperAction`, `clampedHit`, `unboundedHit`). `performDiscreteAction`'s fill branch passes a `neighborsFn` closure to `applyFill`. |
| `src/render/selectionOverlay.js`, `pastePreviewOverlay.js`, `thumbnailRenderer.js` | `peyoteCellOriginMm(...)` calls → `engine.cellOrigin(..., gridParams)`, engine resolved from `gridParams.stitchType`. |
| `src/tools/fillTool.js` | `applyFill` signature: `(cells, startRow, startCol, colorId, rows, cols, neighborsFn)` — drops the `peyoteNeighbors` import and `flipped` param, takes an injected adjacency function instead. |
| `src/tools/mirrorTool.js` | **Unchanged.** |
| `src/tools/cutCopyTool.js`, `drawTool.js`, `eraseTool.js`, `colorReplaceTool.js` | **Unchanged.** |
| `src/export/wordChart.js` | `buildWordChart` gains `stitchType` param and a square-specific row-grouping branch (see above); chart-row objects gain a pre-computed `rowLabel`. `isRowReversed`/`displayRuns`/`buildRuns`/`UNASSIGNED` unchanged. |
| `src/ui/printView.js` | `formatRowLabel` deleted (reads `chartRow.rowLabel` instead); `buildWordChart(...)` call passes `appState.stitchType`; header spec line mentions stitch type. |
| `src/state/appState.js` | New `stitchType: 'peyote'` field. |
| `src/state/resizeGrid.js`, `colorwaySync.js`, `cellStore.js`, `historyStore.js`, `strokePatch.js` | **Unchanged.** |
| `src/storage/migrateDesign.js` | New `migrateStitchType` step. |
| `src/storage/designStore.js` | `createDesign`/`createConvertedDesign` take/stamp `stitchType`. |
| `src/storage/preferencesStore.js` | `DEFAULT_PREFERENCES` gains `defaultStitchType: 'peyote'`. |
| `src/storage/db.js` | `DB_VERSION` bump (no schema change, trips pre-migration backup warning). |
| `src/ui/editorView.js` | `rebuildGridParams()` resolves engine, stashes `stitchType` onto `gridParams` (same pattern as `staggerFlipped`). New `handleStitchTypeChange()` (mirrors `handleBeadTypeChange`'s empty/non-empty fork, simpler — plain confirm, no mapping dialog). `updateSelectionButtons()`'s mirror-horizontal guard becomes peyote-only. New `#stitch-type` select wiring. |
| `src/ui/libraryView.js` | Bead-type line also shows stitch type, via new `callbacks.resolveStitchTypeLabel`. |
| `main.js` | New `resolveStitchTypeLabel`; `handleCreate()` seeds `stitchType` from preferences; new `handleStitchTypeConvertConfirmed` (trimmed copy of `handleBeadTypeConvertConfirmed`, no color-mapping step); `openDesign()` sets `appState.stitchType = design.stitchType ?? 'peyote'`; `handleRequestColorwayPreviews()`'s direct `generatePeyoteGrid(...)` call routed through `resolveGridEngine(design.stitchType).generateGrid(...)`. |
| `index.html` | New `#stitch-type` select in `#settings-dialog`. |
| `src/ui/beadCatalogDialog.js`, `resizeDialog.js`, `colorwayPickerDialog.js`, `convertBeadTypeDialog.js` | **Unchanged.** |

## Build order

1. `src/grid/square.js` + `src/test/grid/square.test.js` (round-trip `cellAtPoint`↔`cellOrigin`, clamped/unbounded bounds behavior, `squareNeighbors` symmetry, `generateSquareGrid` bounding-box math) — no dependency on anything else.
2. `src/grid/gridEngine.js` + a small `src/test/grid/gridEngine.test.js` (resolves the right engine per `stitchType`; both engines expose an identical function-name surface, so a future engine can't silently omit one).
3. Data model: `appState.js`, `migrateDesign.js` (+ tests), `designStore.js`, `preferencesStore.js`, `db.js` version bump.
4. Render/interaction layer: `canvasRenderer.js`, `pointerRouter.js`, `selectionOverlay.js`, `pastePreviewOverlay.js`, `thumbnailRenderer.js`, `fillTool.js` (+ updated `fillTool.test.js` fixtures, using an injected `neighborsFn` for both stitch types, plus a new square-specific 4-vs-6-connectivity fixture).
5. `editorView.js`: `rebuildGridParams`, `handleStitchTypeChange`, mirror-button guard, `#stitch-type` select wiring; `index.html` markup.
6. `main.js`: `handleCreate`, `handleStitchTypeConvertConfirmed`, `openDesign`, `handleRequestColorwayPreviews`.
7. `wordChart.js` (+ updated `wordChart.test.js` fixtures for the square branch and the new `rowLabel` field) and `printView.js`.
8. `libraryView.js` stitch-type label.
9. Full regression: `node --test 'src/test/**/*.js'`.
10. Playwright verification (below).

## Verification approach

Following this project's established convention (`node:test` for pure modules, headless Chromium/Playwright for DOM/canvas/IndexedDB, cell coordinates computed by reimplementing the grid math directly in the driver script rather than trusting the same code under test):

- **Golden-reference migration check**, same technique as `.work/refactor-row-col-axis-naming-plan.md`'s: seed a pre-existing (no `stitchType` field) design directly into IndexedDB, boot, confirm it renders identically to before (peyote, unchanged) and that `stitchType: 'peyote'` was stamped.
- **Square-stitch geometry sanity**: build a square-stitch design, pixel-sample two vertically-adjacent same-column cells and confirm their x-coordinates are identical (no offset) — the direct visual test that would catch an accidental reuse of peyote's stagger.
- **Bead-size consistency**: same bead type, same rows/cols, compare a peyote design's and a square design's rendered bead footprint (width/height in px) — should match exactly, confirming the "same on-screen size regardless of stitch type" decision above actually holds.
- Draw/erase/undo/redo, fill (confirm 4-connectivity — a diagonal-only-adjacent seed does *not* get filled, unlike some peyote parities), color-replace, cut/copy/paste, resize (grow/shrink each anchor), mirror (both axes always enabled, no even-width restriction) — full tool pass on a square-stitch design, mirroring each existing peyote Playwright pass.
- Stitch-type conversion: empty design switches directly with no confirm; non-empty design clones (confirm dialog blocks otherwise), original design provably untouched afterward (same "reopen the original, confirm it's unchanged" check `handleBeadTypeConvertConfirmed`'s own verification used), new design's `shapeEntries`/`colorEntries` byte-identical to the source's (proving no accidental remap).
- Print/export: word chart for a square design has one line per physical row, no "Row 1 & 2" combining, correct direction alternation.
- Library row shows the correct stitch-type label for both types; gallery mode unaffected.

## Explicitly out of scope

- **Brick stitch, loom** — not touched. The grid-engine resolver is designed so either could be added later as a third engine module, but neither is built here.
- **In-place stitch-type conversion** — always clone-based, per the "Changing it" section above; never an in-place geometry mutation.
- **A visual/picture grid chart for square stitch's printout** — confirmed with the user: text word-chart, same model as peyote (see above).
- **Per-stitch-type bead catalogs** — a bead type's physical dimensions are global, shared across both stitch types (per the "Bead dimension mapping" reasoning above), not duplicated per stitch type.
