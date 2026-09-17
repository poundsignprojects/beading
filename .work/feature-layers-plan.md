# Layers (Photoshop-style show/hide layers) — implementation plan

Status: **implemented in full.** Written per direct request, grounded in the current codebase (post-multi-drop-peyote, post-bead-finish-effects-MVP — `colorwaySync.js`'s shared-shape/per-colorway-color split, `historyStore.js`'s single chronological undo/redo timeline, `resizeGrid.js`/`rotateGrid.js`'s generic `[key,value]` remap primitives). Two load-bearing behavioral questions were confirmed with the user before writing this plan (see "Confirmed with the user" below) since they shape the whole design and would be expensive to reverse after the fact. Implemented per this plan's own build order in the following session — see CLAUDE.md's Phase Status for the build/verification writeup. Two small deviations worth knowing about: `resizeGrid.js`/`rotateGrid.js` gained one new small primitive each (`cropKeyList`, mirroring the pre-existing `resizeKeyList`/`rotateKeyList`) rather than staying fully unchanged as this plan's file table predicted, since a non-active layer's shape genuinely needs cropping too; and `colorUsage.js`'s `findPatternsUsingColor` (not listed in this plan's file table at all) needed generalizing to the per-layer shape, a real gap found during implementation.

## Goal

Add Photoshop-style layers to a design: multiple independent "sheets" of bead placement stacked on top of each other, each with its own filled/transparent cells, each independently showable/hideable while editing. Switching colorways keeps every layer's own filled cells exactly as they are — only the colors assigned to them can differ per colorway, generalizing the existing single-shape/per-colorway-color model (Phase 6) to be **per layer** instead of per whole design. Printing/exporting acts as if the visible layers were merged into one pattern, without ever actually merging the underlying per-layer data — the layer stack itself is always fully recoverable.

**Confirmed with the user** (`AskUserQuestion`, both recommended options taken):
1. **Print/export scope**: only *visible* layers are included in the word chart, materials table, reference image, and library thumbnail — matching Photoshop's own "Flatten Image" behavior exactly (a hidden layer is dropped, not silently merged in). A clear warning appears wherever a hidden layer still has beads in it, so nothing is ever lost without the user knowing.
2. **Layer overlap**: allowed, top-of-stack wins. Nothing stops a user from placing a bead on any layer at any cell, including one another layer already occupies — again matching Photoshop exactly. When more than one layer occupies a cell, whichever is highest in the stack *and visible* is the one that actually renders/prints there.

## The one idea that keeps this from touching everything: flatten before rendering, not while rendering

The single biggest risk with "add layers" is that every renderer, hit-tester, and export path in this app currently assumes one flat `cells` Map. The square-stitch and bead-finish-effects features already established the pattern this plan leans on hardest: **push the new complexity into one narrow seam, and let everything downstream of that seam stay exactly as ignorant as it already is.**

Concretely: a pure function computes one ordinary flat `Map<"row,col", {colorId}>` — the *composite* of every visible layer, top of stack wins per cell — and that Map is handed to `drawGrid`/`renderThumbnailDataUrl`/`buildWordChart` exactly the way `appState.cells` is handed to them today. **None of `canvasRenderer.js`, `thumbnailRenderer.js`, `wordChart.js`, `printView.js`, `selectionOverlay.js`, or `pastePreviewOverlay.js` need to change at all** — they already only ever wanted "a flat cells Map," and that's still exactly what they get. Only the one or two call sites that used to hand them `appState.cells` directly now hand them the composite instead.

Editing tools (draw, erase, fill, replace, mirror, cut/copy/paste, select) go the opposite direction: they keep operating on `appState.cells` completely unchanged, because `appState.cells` simply comes to mean "the *active layer's* materialized cells for the active colorway" instead of "the whole design's materialized cells for the active colorway" — one more level of the exact same scoping `colorwaySync.js` already does for colorways. **`drawTool.js`, `eraseTool.js`, `fillTool.js`, `colorReplaceTool.js`, `mirrorTool.js`, `cutCopyTool.js`, `historyStore.js`, `strokePatch.js`, and `pointerRouter.js`'s core dispatch logic need zero changes.** Switching the active layer works exactly like switching colorway already does: decompose the outgoing layer's live cells back into storage, materialize the incoming layer's cells, clear history (old patches are only meaningful against the layer+colorway they were recorded under — already true for colorway switches today).

The real work is concentrated in three places: (1) the data model gains one more level of nesting (layer → colorway → color, instead of just colorway → color), (2) every place that currently loops "for each colorway" to apply a geometry change (resize/crop/rotate) or a bead-type-conversion color remap now has to loop "for each layer, for each colorway," and (3) a small, genuinely new Layers management UI (list, add, rename, delete, reorder, show/hide) that's structurally a close cousin of the existing colorway controls and Manage Colors list.

## Data model + migration

### New shape

```js
design.layers = [
  { id, name: 'Layer 1', visible: true, order: 0, shapeEntries: [cellKey, ...] },
  // ...
];
design.activeLayerId = <id>;

design.colorways = [
  {
    id, name, createdAt, updatedAt,
    layerColorEntries: { [layerId]: [[cellKey, colorId], ...] },
  },
  // ...
];
design.activeColorwayId = <id>; // unchanged
```

`design.shapeEntries` (today's single global shape) is gone — folded into each layer. Each colorway's flat `colorEntries` is gone — folded into `layerColorEntries`, keyed by layer id. `rows`/`cols`/`staggerFlipped`/`stitchType`/`dropCount`/`beadTypeKey` are unaffected — the grid geometry is shared across every layer of one design; only *which cells are filled, and with what color* is now layer-scoped.

A layer's `shapeEntries` is shared across every colorway (by construction — it lives on the layer object, not inside any colorway), which is exactly the property the user asked for: switching colorways never changes which cells are filled on a layer, only what color fills them.

`order` follows the existing fractional-sort-key convention (`designOrder.js`'s `orderForInsertAt`, already used for the design library and Manage Colors) — **higher `order` = higher in the stack = painted later = wins ties**, matching how a Photoshop layers panel's topmost row is the frontmost layer.

### Migration

`migrateDesign.js` gains a sixth, outermost step, `migrateLayers`, appended after every existing step (so it always runs against an already-fully-normalized old-shape record, and no earlier step ever needs to learn about layers):

```js
function migrateLayers(record) {
  if (record.layers) return record;
  const defaultLayerId = generateId();
  const { shapeEntries, ...rest } = record;
  return {
    ...rest,
    layers: [{ id: defaultLayerId, name: 'Layer 1', visible: true, order: 0, shapeEntries }],
    activeLayerId: defaultLayerId,
    colorways: record.colorways.map(({ colorEntries, ...cw }) => ({
      ...cw,
      layerColorEntries: { [defaultLayerId]: colorEntries },
    })),
  };
}

export function migrateDesign(record) {
  return migrateLayers(migrateDropCount(migrateStitchType(migrateStaggerFlip(migrateAxisConvention(migrateLegacyColorways(record))))));
}
```

Every design that exists before this feature ships was implicitly single-layer — no ambiguity, same "gated on field presence" idiom every step in this file already uses. `designStore.js`'s `listDesignsSorted` already re-saves any record a migration step changes, so this runs once per design, system-wide, exactly like every prior step.

### `designStore.js`

- `createDesign`: seeds `layers: [{ id: defaultLayerId, name: 'Layer 1', visible: true, order: 0, shapeEntries: [] }]`, `activeLayerId: defaultLayerId`; the single default colorway's `colorEntries: []` becomes `layerColorEntries: { [defaultLayerId]: [] }`.
- `createConvertedDesign` (bead-type/stitch-type conversion's clone target): takes `layers`/`activeLayerId` as already-resolved params in place of today's `shapeEntries` param — the caller (main.js) is responsible for producing a fully independent layer/colorway structure, exactly as it already is for `colorways`/`activeColorwayId` today.
- `duplicateDesign`: gains a `layerIdMap` (fresh id per layer), the exact same treatment the existing `idMap` already gives colorway ids — every layer gets a fresh id, `activeLayerId` is remapped through it, and every colorway's `layerColorEntries` keys get remapped through it too (two independent remaps land in the same structure: the object *keys* via `layerIdMap`, the *colorId values* are untouched since duplicating never changes what a color means).

### `db.js`

`DB_VERSION` bumps (9 → 10). Unlike some of the recent additive-only bumps (bead finish effects' MVP fields explicitly did *not* bump the version, since they were optional/defaulted fields with no shape change), this one **must** bump — it's a genuine destructive restructuring of `shapeEntries`/`colorEntries` into `layers`/`layerColorEntries`, the same class of change the row/col axis refactor was. The bump's only job is to trip the existing `attemptPreMigrationDriveBackup()` pre-migration warning (no new object store needed — layers live inline in the design record, same as colorways).

## Architecture: the active-layer editing model

### `appState.js`

```js
layers: [],          // in-memory mirror of the open design's layer list — same role appState.colorways plays
activeLayerId: null,
```

`appState.cells`'s own doc comment updates from "materialized *active* colorway" to "materialized cells for the active layer, within the active colorway" — the Map's own shape (`Map<"row,col", {colorId}>`) is completely unchanged, only what it's scoped to grows one level deeper.

### `colorwaySync.js` — extended, not replaced

`materializeColorwayCells`/`decomposeCellsForSave` are already layer-agnostic (they just turn a flat shape + flat colorEntries pair into/out of a Map — they never assumed that pair was "the whole design's"), so they're reused completely unchanged as the primitive underneath a new, one-layer-scoped helper:

```js
// Rebuilds one layer's materialized cells against a specific colorway's stored
// per-layer colors.
export function materializeLayerCells(layer, colorway) {
  return materializeColorwayCells(layer.shapeEntries, colorway.layerColorEntries[layer.id] ?? []);
}

// Composites every visible layer (bottom of stack to top, by `order`) into one
// flat cells Map for a given colorway — the topmost visible layer's bead wins
// at any cell more than one layer occupies (confirmed with the user). This is
// the one place "as if flattened" actually happens; nothing downstream of it
// (canvasRenderer/thumbnailRenderer/wordChart/printView) needs to know layers
// exist.
//
// overrideLayerId/overrideCells let the live editor substitute one layer's
// current, not-yet-saved cells in place of what's actually persisted for it —
// every other caller (a library preview, a design record freshly read from
// storage) omits them and gets a pure function of the design record's own data.
export function composeVisibleLayers(layers, colorway, { overrideLayerId, overrideCells, visibleOnly = true } = {}) {
  const ordered = [...layers].sort((a, b) => a.order - b.order);
  const flat = new Map();
  for (const layer of ordered) {
    if (visibleOnly && !layer.visible) continue;
    const cells = layer.id === overrideLayerId ? overrideCells : materializeLayerCells(layer, colorway);
    for (const [key, value] of cells) flat.set(key, value);
  }
  return flat;
}

// Prunes one layer's stored color entries, across every colorway, down to
// that layer's own current shape — the layer-scoped generalization of the
// existing pruneColorwaysToShape (renamed from that; every call site updated).
// A cell erased from a layer must not leave a stale color behind in some
// *other*, currently-inactive colorway either, which is why this loops over
// every colorway, not just the active one — same reasoning the function it
// replaces already had.
export function pruneColorwayLayerToShape(colorways, layerId, shapeEntries) {
  const shapeSet = new Set(shapeEntries);
  return colorways.map((cw) => ({
    ...cw,
    layerColorEntries: {
      ...cw.layerColorEntries,
      [layerId]: (cw.layerColorEntries[layerId] ?? []).filter(([key]) => shapeSet.has(key)),
    },
  }));
}
```

The file's own header comment gets a small update: the "shared-shape/per-colorway-color split" is now "per-layer shape, shared across colorways; per-(layer,colorway) color."

### Where the composite gets called

Every one of these already has every field it needs in hand (`appState.layers`, `appState.colorways`, `appState.activeColorwayId`, `appState.activeLayerId`, `appState.cells`) — none of them need a new hook or a new piece of state, just one extra function call before the existing one:

- **`editorView.js`'s `render()`**: replaces `appState.cells` with a freshly computed composite as the Map handed to `drawGrid`. Recomputed on every `render()` call (no caching) — consistent with this codebase's stated "no dirty tracking" philosophy elsewhere (e.g. `persistCurrentDesign`'s thumbnail regenerates unconditionally on every save), and cheap: it's a handful of `Map` constructions and iterations per redraw, not a re-render of anything expensive.
  ```js
  function composedCellsForDisplay() {
    const colorway = appState.colorways.find((cw) => cw.id === appState.activeColorwayId);
    return composeVisibleLayers(appState.layers, colorway, {
      overrideLayerId: appState.activeLayerId,
      overrideCells: appState.cells,
    });
  }
  ```
- **`main.js`'s `persistCurrentDesign()`** (thumbnail regeneration): same call, same overrides — a design's library thumbnail always reflects what the canvas currently shows.
- **`printView.js`'s `mountPrintView`**: same call at mount time, feeding `buildWordChart` and the reference-image render — see "Word chart / print / thumbnails" below for the accompanying hidden-layer warning.
- **`main.js`'s `handleRequestColorwayPreviews`** (the library's multi-colorway badge/picker, previewing a design that *isn't* the one currently open): same function, **no override** — nothing is "live" for a design sitting in the library, so it's a pure read of that design record's own persisted `layers`/`colorways`.

### Eyedropper samples the composite, not the active layer

The one deliberate exception to "editing tools stay scoped to the active layer": the eyedropper is a color *picker*, and a user picking a color naturally means "the color I'm looking at," which could visually belong to a different, non-active layer. Matching Photoshop's own default eyedropper behavior (samples the merged image, not just the active layer, unless explicitly told otherwise), `pointerRouter.js` gains a second cells-getter — `getDisplayCells()` (the same composite `render()` computes, threaded down instead of recomputed twice) — and `performEyedropperAction` hit-tests against that instead of `getCells()`. Every other tool keeps using `getCells()` (the active layer) unchanged.

## Layer management (new — mirrors the existing colorway controls closely)

New functions in `editorView.js`, structurally parallel to the existing `switchColorway`/`handleColorwayNew`/`handleColorwayRename`/`handleColorwayDelete`:

- **`switchLayer(newLayerId)`**: decomposes `appState.cells` into `{shapeEntries, colorEntries}`; writes `shapeEntries` back onto the *leaving* layer in `appState.layers`; writes `colorEntries` into *only the active colorway's* slice of the leaving layer (`appState.colorways[active].layerColorEntries[leavingLayerId]`) — every other colorway's stored colors for that layer are untouched, since only the active colorway's view of it was ever live. Materializes the *incoming* layer's cells (its own `shapeEntries`, against the active colorway's `layerColorEntries[newLayerId] ?? []`) into `appState.cells`. Sets `appState.activeLayerId`. `clearHistory()` — same reasoning colorway switching already applies (a patch's before/after values are only meaningful against the (layer, colorway) pair they were recorded under). `hooks.onImmediateSave()`.
- **`handleLayerNew()`**: creates `{id, name: 'Layer N', visible: true, order: <max order + 1>, shapeEntries: []}` and adds an empty `layerColorEntries[newLayerId] = []` slot to **every** colorway (a colorway must be able to hold colors for every layer that exists, even ones with nothing drawn on them yet). Deliberately **does not copy any content** — unlike a new colorway (which is explicitly a duplicate of the active one's appearance), a new layer's whole purpose is fresh, empty space to draw on. Calls `switchLayer(newLayer.id)` to make it active, matching how creating a colorway also switches into it.
- **`handleLayerRename(id)`** / **`handleLayerDelete(id)`**: `window.prompt`/`window.confirm`-guarded, mirroring the colorway equivalents exactly. Deleting is blocked at exactly one remaining layer (a design must always have ≥1 layer — same "can't delete the last one" rule colorways already enforce). Deleting also removes that layer's slot (`delete layerColorEntries[deletedLayerId]`) from every colorway, so no dead per-layer data lingers forever (small tidiness step, not required for correctness — an orphaned slot would just never be read again). If the deleted layer was active, switches to another remaining layer first.
- **`handleLayerVisibilityToggle(id)`**: flips `layer.visible`. **Not undo-tracked** (a view-state toggle, not a content edit — same category as `showBeadOutlines`/the panel-collapse toggle) but **is** persisted immediately (`hooks.onImmediateSave()`) and triggers `scheduleRedraw()` (the composite changes). Never touches `appState.cells`/history at all — no `switchLayer`/reconciliation needed, since visibility doesn't move any data.
- **`handleLayerReordered(id, newOrder)`**: drag-reorder, structurally identical to the existing bead-catalog/custom-color/library drag-reorder handlers (`orderForInsertAt`, pointer-capture-on-the-list-container convention). Not undo-tracked, matches those precedents. Immediately re-persisted and redrawn (the visual stack order changed).

Colorway-side changes needed for this to hold together:

- **`switchColorway`**: today decomposes `appState.cells` straight into the leaving colorway's `colorEntries`. Now it decomposes into `leavingColorway.layerColorEntries[appState.activeLayerId]` specifically — the shape write-back (onto `appState.layers`, not the colorway) is unaffected. Materializing the target colorway re-reads the **same active layer's** `shapeEntries` against `targetColorway.layerColorEntries[appState.activeLayerId] ?? []` — colorways never change which layer is active, only what colors that layer's colorway-view holds.
- **`handleColorwayNew`**: today copies the single active shape's current colors into the new colorway. Now it must copy **every layer's** current colors — i.e. deep-copy the whole `layerColorEntries` object from the active colorway, then overwrite just the active layer's slot with the freshly-decomposed *live* `colorEntries` (so an edit not yet reconciled into `appState.colorways` isn't lost). This is a direct generalization of "create = duplicate the active colorway," just spanning every layer instead of the one (former) global shape.
- **`handleColorwayDelete`**: unaffected in shape — still filters the colorway list and falls back to the first remaining one; the re-materialize step reads `next.layerColorEntries[appState.activeLayerId] ?? []` in place of today's `next.colorEntries`.
- **`main.js`'s `persistCurrentDesign()`**: the exact same decompose → prune-every-colorway → fold-into-active-colorway sequence as `switchColorway`, generalized the same way, called on every autosave — mirrors today's shape one-for-one, just layer-scoped.

## Geometry operations (resize, crop, rotate) — the biggest mechanical surface

`resizeGrid.js`/`rotateGrid.js`'s actual math (`resizeKeyList`, `resizeColorEntries`, `cropCells`, `cropColorEntries`, `rotateKeyList`, `rotateColorEntries`, `compensatedStaggerFlipped`, `boundingBoxForCells`, `rotatedCoord`, ...) is **already generic over plain `[key, value]` pairs and needs zero changes** — this is the payoff of that module never having known what a "colorway" or "design" even was. What changes is `editorView.js`'s `applyResize`/`applyCrop`/`applyRotate`/`captureGeometrySnapshot`/`commitGeometrySnapshot`, which today loop "for each colorway" and now have to loop "for each layer, for each colorway":

```js
function captureGeometrySnapshot() {
  return {
    rows: appState.rows,
    cols: appState.cols,
    staggerFlipped: appState.staggerFlipped,
    cellEntries: [...appState.cells.entries()], // active layer's live cells
    layers: appState.layers.map((l) => ({ ...l, shapeEntries: [...l.shapeEntries] })),
    colorways: appState.colorways.map((cw) => ({
      ...cw,
      layerColorEntries: Object.fromEntries(
        Object.entries(cw.layerColorEntries).map(([layerId, entries]) => [layerId, [...entries]])
      ),
    })),
  };
}
```

`applyResize` (crop and rotate follow the identical shape, swapping in `cropCells`/`cropColorEntries`/`rotateKeyList`/`rotateColorEntries` as appropriate):

```js
function applyResize(newRows, newCols, rowAnchor, colAnchor) {
  const before = captureGeometrySnapshot();
  const newCells = resizeCells(appState.cells, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor);

  const newLayers = appState.layers.map((layer) => ({
    ...layer,
    shapeEntries: layer.id === appState.activeLayerId
      ? Array.from(newCells.keys())
      : resizeKeyList(layer.shapeEntries, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor),
  }));

  const newColorways = appState.colorways.map((cw) => ({
    ...cw,
    layerColorEntries: Object.fromEntries(appState.layers.map((layer) => [
      layer.id,
      resizeColorEntries(cw.layerColorEntries[layer.id] ?? [], appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor),
    ])),
  }));

  const colOffset = axisOffset(appState.cols, newCols, colAnchor);
  const newStaggerFlipped = appState.stitchType === 'peyote'
    ? compensatedStaggerFlipped(appState.staggerFlipped, colOffset)
    : appState.staggerFlipped;

  const after = { rows: newRows, cols: newCols, staggerFlipped: newStaggerFlipped, cellEntries: [...newCells.entries()], layers: newLayers, colorways: newColorways };
  pushGeometryChange(appState.history, before, after, commitGeometrySnapshot);
  commitGeometrySnapshot(after);
}
```

`commitGeometrySnapshot` restores `appState.rows`/`cols`/`staggerFlipped`/`cells` exactly as today, plus `appState.layers = snapshot.layers` (deep-copied the same way `colorways` already is). `appState.activeLayerId`/`activeColorwayId` never change across a resize/crop/rotate (or its undo/redo) — same as today, no new snapshot field needed for either.

**Crop to Design's bounding box** is computed from the **union of every layer's occupied cells, visible or not** — a crop is a whole-design geometry operation, and content on a currently-hidden layer is still real content the operation must never silently clip away just because it isn't on screen right now. (`boundingBoxForCells` itself needs no change — it already accepts any iterable of keys; the caller just unions every layer's `shapeEntries`, substituting the active layer's live keys, before calling it.)

## Bead-type / stitch-type conversion generalization

`main.js`'s `handleRequestBeadTypeConversionData` ("every color actually used") today walks each colorway's flat `colorEntries`; it now walks every `(layer, colorway)` pair, substituting the live decomposed `colorEntries` only for the active `(layer, colorway)` pair:

```js
for (const cw of appState.colorways) {
  for (const layer of appState.layers) {
    const entries = (layer.id === appState.activeLayerId && cw.id === appState.activeColorwayId)
      ? decomposeCellsForSave(appState.cells).colorEntries
      : cw.layerColorEntries[layer.id] ?? [];
    for (const [, colorId] of entries) usedColorIds.add(colorId);
  }
}
```

`beadTypeConversion.js`'s `remapColorwayColorIds(colorways, mappingTable)` generalizes to remap colorId values inside every layer's entries, for every colorway:

```js
export function remapColorwayColorIds(colorways, mappingTable) {
  return colorways.map((cw) => ({
    ...cw,
    layerColorEntries: Object.fromEntries(
      Object.entries(cw.layerColorEntries).map(([layerId, entries]) => [
        layerId,
        entries.map(([key, colorId]) => [key, mappingTable.get(colorId) ?? colorId]),
      ])
    ),
  }));
}
```

`handleBeadTypeConvertConfirmed`/`handleStitchTypeConvertConfirmed` clone `appState.layers` into the new design with fresh layer ids (a `layerIdMap`, exactly the same treatment already given to colorway ids), remapping every colorway's `layerColorEntries` **keys** through that map (a second, independent remap from the colorId-value remap `remapColorwayColorIds` already does — one remaps which layer a color-entries list belongs to, the other remaps what colorId is inside it). `convertBeadTypeDialog.js` itself needs **no changes** — it only ever sees a flat `usedColors` list and returns mapping decisions; every bit of layer-awareness lives in the data gathered for it and applied after it, in `main.js`.

## Word chart / print / thumbnails

Per the confirmed decision, print/export uses the exact same `composeVisibleLayers(..., { visibleOnly: true })` the live canvas already uses — "what you see is what prints," with zero separate print-only toggle to keep in sync.

`printView.js` gains a hidden-content warning, styled and positioned like the existing "N bead(s) in this colorway have no color assigned yet" warning: whenever any layer is currently hidden and has at least one occupied cell (checked conservatively — a hidden layer with content trips the warning regardless of whether that content would have been covered by a layer above it anyway, since a false-positive warning is harmless and a missed one isn't), a line reads e.g. *"⚠ 1 layer is hidden and not included in this printout: 'Background'."* This sits above the materials table, next to (not replacing) the existing unassigned-color warning — a design can trip both at once.

## UI/UX

New **Layers** section in the side panel (`index.html`), a `<section id="layer-section">` alongside the existing palette/colorway/photo-trace sections — placed *above* the colorway section, since the natural editing flow is "pick your layer → pick your colorway → pick your color → draw." A `<ul id="layer-list">` of rows, each structurally a close cousin of a Manage Colors row: drag handle (reorder = re-stack), a visibility toggle button (eye / eye-off icon, new vendored icons — see below), the layer's name (clicking the row activates that layer — same "click to select" convention the colorway `<select>` doesn't currently use but a list naturally affords), and rename/delete icon-buttons. The currently active layer gets a visual highlight (border/background), the same affordance the selected color swatch's `aria-pressed` styling already gives. Top of the list = top of the stack (frontmost), matching a Photoshop layers panel and this plan's `order` convention. A "+ New Layer" button sits below the list.

Two new vendored icons needed (Lucide, same fetch-and-verify convention as every prior icon batch): `eye`, `eye-off`. Every other icon needed already exists in `/vendor/icons/` (`grip-vertical`, `pencil`, `trash-2`, `plus`).

## Backup safety

This migration restructures the core identity of every saved design record — the same class of risk the row/col axis refactor was, and this project has an established four-layer treatment for exactly that (see `.work/refactor-row-col-axis-naming-plan.md`'s "Backup safety" section, which this mirrors directly rather than reinventing):

1. **Manual, off-app checkpoint first** — before this ships to the device with real data, use the existing "Export Backup File" flow (`localBackupFile.js`) to write a JSON snapshot and set it aside somewhere the app can't touch. This is the actual last line of defense and happens before implementation starts, not as a build step.
2. **Reuse the existing retained Drive checkpoint** — the `DB_VERSION` bump above (9 → 10) is exactly what's needed to trip `attemptPreMigrationDriveBackup()`'s existing version check; no new mechanism required.
3. **Hold the automatic push-on-close until a human has looked** — a new `pendingLayerMigrationReview` flag in `driveSyncStore.js`'s meta (same `{...DEFAULT_META, ...stored}` merge-on-read convention already established there), set from `boot()` when `listDesignsSortedWithMigrationInfo` (or a sibling helper) reports it actually ran `migrateLayers` on at least one design. While set, `pushBackupIfConnected()` skips the silent push and shows a new variant of `driveReconnectBanner.js`'s existing singleton banner (reusing its `showBanner` implementation, same pattern `showAxisMigrationReviewBanner` already established) pointing at Backup & Sync. Cleared only by an explicit manual **Back Up Now** click, never automatically — exactly the existing axis-migration-review flag's behavior, given a new name and a new trigger condition.
4. **Manual spot-check before trusting it** — look at a handful of real patterns (anything with more than one colorway, since that's the combination most exercised by this change) after updating, before ever clicking Back Up Now.

## File-by-file scope

| File | Change |
|---|---|
| `src/state/colorwaySync.js` | New `materializeLayerCells`, `composeVisibleLayers`. `pruneColorwaysToShape` renamed/generalized to `pruneColorwayLayerToShape(colorways, layerId, shapeEntries)`. `materializeColorwayCells`/`decomposeCellsForSave` unchanged, reused as primitives. |
| `src/state/appState.js` | New `layers: []`, `activeLayerId: null`. `cells`'s doc comment updated. |
| `src/state/historyStore.js`, `strokePatch.js` | **Unchanged.** |
| `src/state/resizeGrid.js`, `rotateGrid.js` | **Unchanged** (already generic over `[key,value]` pairs). |
| `src/state/beadTypeConversion.js` | `remapColorwayColorIds` generalized to remap colorId values inside every layer's entries, for every colorway. |
| `src/tools/drawTool.js`, `eraseTool.js`, `fillTool.js`, `colorReplaceTool.js`, `mirrorTool.js`, `cutCopyTool.js` | **Unchanged.** |
| `src/interaction/pointerRouter.js` | New `getDisplayCells()` getter, used only by `performEyedropperAction`. Everything else unchanged. |
| `src/render/canvasRenderer.js`, `thumbnailRenderer.js`, `selectionOverlay.js`, `pastePreviewOverlay.js` | **Unchanged.** |
| `src/export/wordChart.js` | **Unchanged** (already takes a plain flat `cells` Map). |
| `src/ui/printView.js` | Computes the composite via `composeVisibleLayers` instead of reading `appState.cells` directly; new hidden-layer warning. |
| `src/storage/migrateDesign.js` | New `migrateLayers` step, appended outermost. |
| `src/storage/designStore.js` | `createDesign`/`createConvertedDesign` take/stamp `layers`/`activeLayerId`; `duplicateDesign` gains a `layerIdMap`, mirroring the existing colorway-id remap. |
| `src/storage/db.js` | `DB_VERSION` bump (destructive shape change — required, not just precedent). |
| `src/storage/driveSyncStore.js` | New `pendingLayerMigrationReview` flag on `DEFAULT_META`. |
| `src/ui/driveReconnectBanner.js` | New banner variant (reuses existing `showBanner`), mirroring `showAxisMigrationReviewBanner`. |
| `src/ui/editorView.js` | New `switchLayer`/`handleLayerNew`/`handleLayerRename`/`handleLayerDelete`/`handleLayerVisibilityToggle`/`handleLayerReordered`. `switchColorway`/`handleColorwayNew`/`handleColorwayDelete` generalized per-layer as described above. `applyResize`/`applyCrop`/`applyRotate`/`captureGeometrySnapshot`/`commitGeometrySnapshot` loop over every layer × colorway. `render()` computes the display composite. Crop-to-Design's bounding box unions every layer. New Layers panel DOM wiring. |
| `src/ui/convertBeadTypeDialog.js` | **Unchanged.** |
| `index.html` | New `#layer-section`/`#layer-list`/"+ New Layer" markup. |
| `style.css` | New `.layer-row`/`.layer-row-active`/etc., structurally reusing `.color-manage-row`'s existing rules where possible. |
| `main.js` | `openDesign`/`persistCurrentDesign` read/write `layers`/`activeLayerId` alongside `colorways`/`activeColorwayId`. `handleRequestBeadTypeConversionData`/`handleBeadTypeConvertConfirmed`/`handleStitchTypeConvertConfirmed` generalized per-layer. `handleRequestColorwayPreviews` uses `composeVisibleLayers`. New `pendingLayerMigrationReview` wiring in `boot()`/`pushBackupIfConnected()`, mirroring the existing axis-migration-review wiring exactly. |
| `vendor/icons/eye.svg`, `eye-off.svg` | **New.** |

## Build order

1. Data model: `migrateDesign.js`'s `migrateLayers` + tests (isolated, highest-risk, build and verify before anything depends on it rendering correctly). `designStore.js`'s `createDesign`/`createConvertedDesign`/`duplicateDesign`. `db.js` version bump.
2. `colorwaySync.js`'s new/renamed functions + tests (`materializeLayerCells`, `composeVisibleLayers` including its `overrideLayerId`/visibility/top-wins behavior, `pruneColorwayLayerToShape`).
3. Backup safety: `driveSyncStore.js`'s flag, `driveReconnectBanner.js`'s new variant, `main.js`'s `boot()`/`pushBackupIfConnected()` wiring — built and tested alongside step 1, not deferred, since it needs to be live before this ever runs against real data.
4. `editorView.js`: `switchLayer` and the new layer CRUD handlers, generalizing `switchColorway`/`handleColorwayNew`/`handleColorwayDelete` alongside them (these two families are tightly coupled and easiest to get right together).
5. `editorView.js`: `applyResize`/`applyCrop`/`applyRotate`/`captureGeometrySnapshot`/`commitGeometrySnapshot` generalized to loop over every layer.
6. `pointerRouter.js`'s `getDisplayCells()` + eyedropper change.
7. `render()`'s composite call; `printView.js`'s composite call + hidden-layer warning; `main.js`'s `persistCurrentDesign`/`handleRequestColorwayPreviews` composite calls.
8. `beadTypeConversion.js` generalization + `main.js`'s conversion-flow generalization.
9. Layers panel UI: `index.html`, `style.css`, new icons, `editorView.js` DOM wiring.
10. Full regression: `node --test 'src/test/**/*.js'`.
11. Playwright verification (below).

## Verification approach

Following this project's established convention (`node:test` for pure modules, headless Chromium/Playwright for DOM/canvas/IndexedDB, cell coordinates computed by reimplementing the grid math directly in the driver script):

- **Golden-reference migration check**, same technique as the axis refactor and square-stitch plans: build a real multi-colorway design under the *current, unmodified* app, screenshot it, seed that exact pre-layers-shaped record into a fresh IndexedDB, boot under the new code, confirm pixel-identical rendering and that `layers`/`activeLayerId` were stamped correctly.
- **Composite correctness**: two layers with distinct, known content — confirm the visible composite shows the top layer's color at an overlapping cell and the bottom layer's color at a non-overlapping one; hide the top layer and confirm the bottom layer's color now shows through at the overlap; hide both and confirm the cell renders empty.
- **Active-layer edit isolation**: draw on layer A, switch to layer B, draw different content, switch back to A — confirm A's content is exactly what was drawn (not merged with B's), and vice versa; confirm Undo after switching only affects the layer that was active when the stroke was made (history was cleared on switch, so nothing "bleeds" across the switch).
- **Colorway × layer independence**: two layers, two colorways — recolor layer A's cells in colorway 1, switch to colorway 2, confirm layer A's *shape* is identical but its colors are whatever colorway 2 has (starts as colorway 1's copy on creation, then diverges once independently recolored); confirm layer B is unaffected by anything done to layer A in either colorway.
- **Resize/crop/rotate with multiple layers**: build a two-layer design, resize/crop/rotate, confirm both layers' shapes and colors moved identically and correctly (not just the active one) — including a Crop to Design that must union both layers' bounding boxes, confirmed by hiding one layer's content region and cropping without losing it.
- **Bead-type conversion with multiple layers**: convert a two-layer, two-colorway design; confirm the new design has independently-remapped colors for every (layer, colorway) pair and the original design's layers/colorways are completely untouched.
- **Eyedropper samples the composite**: hide the active layer, tap a cell whose visible color actually belongs to a different (visible) layer beneath it — confirm the picked color matches what's on screen, not a no-op.
- **Print/export**: a two-layer design with one layer hidden — confirm the printout's word chart/materials/reference image reflect only the visible layer's content, and the hidden-layer warning appears; un-hide it and confirm the printout changes and the warning disappears.
- **Backup safety mechanisms**: confirm the `DB_VERSION` bump trips the pre-migration warning; confirm `pendingLayerMigrationReview` holds the automatic push and shows the new banner variant, clearing only on manual Back Up Now; confirm a fresh install or an already-migrated library never sets the flag.

## Explicitly out of scope

- **Merge layers / flatten permanently** — not requested; the layer stack is always fully recoverable data, with no destructive "flatten image" action offered. Worth adding later if wanted.
- **"Sample all layers" toggle for tools other than the eyedropper** (fill, replace, select) — every editing tool besides the eyedropper stays scoped to the active layer only, matching Photoshop's own default tool behavior.
- **A per-print toggle for including hidden layers** — deliberately not built; print always mirrors what the canvas currently shows, no separate setting to keep in sync.
- **Choosing a layer count at design-creation time** — a new design always starts with exactly one default layer, matching how colorway count isn't a creation-time choice either; layers are built up during editing.
- **Layer opacity/blend modes** — this plan's "filled vs. transparent" model is binary per layer (a cell is either occupied or not); a bead's own finish transparency (`.work/feature-bead-finish-effects-mvp-plan.md`'s `alphaPercent`) is unrelated and untouched — it still governs how *one winning bead* renders against the background, independent of layers.
