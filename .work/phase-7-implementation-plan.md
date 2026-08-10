# Phase 7 Implementation Plan — Remaining Tools

## Context

Phases 1–6 shipped the full v1 must-have set (draw, erase, undo/redo, save/load, print/export, colorways). Per CLAUDE.md's Phase Plan, Phase 7 is the v1.x tool set: "Fill, color-replace, cut/copy, mirror, photo trace overlay with adjustable transparency (Decision #10), grid/canvas orientation toggle."

**The orientation toggle item is dropped from this plan.** It was logged after Phase 2's iPad testing as a possible backlog item, with an explicit open question about what "orientation" even meant. Revisited this session: the user considers it a misunderstanding of an issue that's since been resolved (the row/col transpose fix done between Phases 5 and 6 — see CLAUDE.md's "two sessions ago" status entry — already made rows run horizontally/cols run vertically, which was the actual complaint). CLAUDE.md's Phase Plan line for Phase 7 should be trimmed to drop the orientation-toggle clause once this plan is committed to; noted again in this plan's "Next step" section as a housekeeping item.

So Phase 7, as planned here, covers five features: **fill, color-replace, cut/copy (+paste), mirror, photo trace overlay.** No Phase 7 code is written yet.

## Scope boundary

Not in this phase: bead-type conversion (still-unscheduled backlog item, unrelated); real Miyuki catalog color data; photo-to-pattern auto-conversion (Decision #10 is explicit that this is out of scope — only a manual reference overlay is wanted); freeform/lasso selection (rectangular marquee only, matching the grid's own row/col structure); "mirror & append" (producing a translated flipped copy alongside the original, for building symmetric patterns from a half-drawn design) — a real and likely-wanted feature, but a materially different and riskier operation (it can collide with existing content outside the selection, unlike an in-place flip) — flagged under "Open, low-stakes implementation calls" as a natural fast-follow, not attempted here; color-replace scoped to a selection (v1 always replaces across the whole active colorway, matching the plain meaning of "replace this color everywhere"); photo trace image rotation/skew (position + uniform scale only); the orientation toggle (see above — considered resolved, not part of this plan).

## New `appState` fields

```js
selection: null,     // { rowStart, rowEnd, colStart, colEnd } — normalized (start <= end)
                      // inclusive row/col index bounds, or null when nothing selected
clipboard: null,     // { rows, cols, cells: [[relRow, relCol, colorId], ...] } or null —
                      // in-memory only, never persisted (see "Clipboard" below)
photoTrace: null,     // { image, opacityPercent, xMm, yMm, widthMm, heightMm } or null —
                      // `image` is a decoded ImageBitmap, in-memory only; the persisted
                      // form (Blob + numbers) lives in a new photoTraces store, see below
```

None of `selection`/`clipboard`/`photoTrace` follow the shared-shape colorway model — they're editor-session state layered on top of `appState.cells`, not part of a design's saved shape/color data (clipboard and selection aren't persisted at all; photoTrace persists separately, to its own store, on its own save cadence — see below).

## Why the existing draw/erase/undo pipeline mostly needs zero changes

Same observation Phase 6 made and leaned on: every tool function that mutates `cells` already follows one contract — mutate in place, return `{row, col, before, after} | null` (drawTool, eraseTool) or, for a multi-cell action, an **array** of such diffs. `historyStore.js`'s `pushPatch`/`undo`/`redo` already operate on an array of `{row, col, before, after}` entries with no assumption about how many cells one user gesture touched or where the array came from — a fill that changes 400 cells and a single draw tap that changes 1 cell are both just "a patch," pushed once. So fill, color-replace, cut, paste, and mirror all reuse `historyStore.js`, `pushPatch`, and the existing `onStrokeCommitted` wiring completely unchanged; they only need a tool function that produces a patch array, plus a place to call it from.

The one real extension is **pointer routing**: draw/erase are continuous-drag strokes (interpolated between move events, `pointerRouter.js`'s existing `drawStroke` state machine). The five new features need two more interaction shapes:
- **Discrete tap** (fill, color-replace, paste): one action per `pointerdown`, ignores subsequent `pointermove` for that gesture. No interpolation — a flood fill or a paste stamp only makes sense at the tapped cell, not smeared across a drag path.
- **Marquee drag** (select, and — for repositioning — the photo trace's "Move Photo" mode): `pointerdown` sets a start cell, `pointermove` updates an end cell and fires a live-update hook, `pointerup` finalizes. No cell mutation happens during this drag at all — it only produces a `{rowStart, rowEnd, colStart, colEnd}` rectangle (or, for the photo, a translate/scale delta).

Copy, Cut, and Mirror need **no pointer routing at all** — they act on whatever `appState.selection` already holds, triggered from ordinary toolbar buttons in `editorView.js`, the same way Clear or the colorway buttons already work.

## The peyote-neighbor subtlety (Fill)

This is the one place Phase 7 needs new grid math, and it's worth getting right up front rather than discovering it mid-implementation, the same way the row/col transpose bug was discovered mid-testing in an earlier phase.

A flood fill needs to know which cells are "adjacent" to a given `(row, col)`. The tempting shortcut — 4-connectivity in index space, `(row±1, col)` and `(row, col±1)` — is what `resizeGrid.js` and `wordChart.js` already use, but those modules only care about index-space structure (remapping keys, reading rows in order), never about which cells physically *touch*. Fill does care: filling a contiguous region should follow actual bead contact, and `peyoteCellOriginMm`'s half-bead row offset (odd rows shifted right by `beadWidthMm / 2`) means `(row, col)`'s physical neighbors in the row above/below are **not** simply `col` — each bead touches two beads in each adjacent row, offset by the stagger direction:

- If `row` is even (offset 0), the two cells in each adjacent row it touches are at columns `col - 1` and `col`.
- If `row` is odd (offset `+beadWidthMm/2`), the two cells in each adjacent row it touches are at columns `col` and `col + 1`.

(Same-row neighbors are always simply `col - 1` and `col + 1` — no offset involved there.) Derived directly from `peyoteCellOriginMm`'s y-range overlap between a cell and its row-adjacent candidates; symmetric for row-above and row-below since the offset relationship only depends on the two rows' relative parity, not which one is "above."

Add this as a pure, exported function in `src/grid/peyote.js` (grid-structure math belongs there, not duplicated into the fill tool):

```js
// The six physically-adjacent cells for peyote's offset-row structure — two in the
// same row, two in the row above, two in the row below. Which two columns in an
// adjacent row depends on this row's parity (see peyoteCellOriginMm's offset rule).
// Does not clamp to grid bounds — callers filter out-of-range results themselves
// (flood fill already needs a bounds check per neighbor to stop the search).
export function peyoteNeighbors(row, col) {
  const [a, b] = row % 2 === 0 ? [col - 1, col] : [col, col + 1];
  return [
    [row, col - 1], [row, col + 1],
    [row - 1, a], [row - 1, b],
    [row + 1, a], [row + 1, b],
  ];
}
```

*Verify* (`node --test`): for a handful of hand-picked `(row, col)` pairs at both parities, assert the returned neighbor set matches a manually-worked-out physical-adjacency diagram (six cells, no duplicates); a round-trip sanity check — if `(r2,c2)` is in `peyoteNeighbors(r1,c1)`, then `(r1,c1)` is in `peyoteNeighbors(r2,c2)` — over a grid of sample cells, confirming adjacency is symmetric.

## The mirror-vertical parity constraint

Mirroring is a content swap within a selection's bounding box — not a recomputed physical reflection. **Mirror Horizontal** reverses column order within each row (`col → colStart + colEnd - col`); this is always exact, because a row's own physical y-offset (`peyoteCellOriginMm`'s parity-based stagger) is fixed by its row index and untouched by reordering *within* that row.

**Mirror Vertical** reverses row order (`row → rowStart + rowEnd - row`) — and this changes which physical offset a row's content sits on whenever the reversal changes a row's parity. Working through it: `row'`'s parity equals `row`'s parity **only when `rowStart + rowEnd` is even**, i.e. only when the selection's height (`rowEnd - rowStart + 1`) is **odd**. For an even-height selection, every row's content would land on a row of the *opposite* stagger offset — a real half-bead-width misalignment, not a rounding error, and not fixable at integer column resolution (there's no such thing as "half a column" to compensate with). This is a structural property of peyote's offset-row construction, the same category of constraint that makes even-count vs. odd-count peyote behave differently in real beadwork — not a bug to work around, but a real limitation to surface honestly rather than silently produce a warped mirror.

**Decision: Mirror Vertical is only enabled for a selection with odd height.** The button is disabled (with a title/tooltip explaining why) when the current selection's height is even; Mirror Horizontal has no such restriction and is enabled for any selection. Documented here so the constraint is understood as intentional if it resurfaces later (e.g. if "mirror & append" is ever built — it would inherit the identical constraint for a vertical append).

## `src/tools/fillTool.js`

```js
import { cellKey, setCell } from '../state/cellStore.js';
import { peyoteNeighbors } from '../grid/peyote.js';

// Flood fill from (startRow, startCol): every physically-connected cell matching
// the seed's state (same colorId, including "absent" as its own matchable state)
// gets set to colorId. Filling into absent cells is a shape change — identical in
// kind to what drawTool.js already does for a single cell, just propagated across
// a region — so it needs no special handling anywhere else in the pipeline (not
// even colorwaySync.js: appState.cells is still just an ordinary Map being mutated).
// Iterative (not recursive) to avoid stack depth issues on a large contiguous region.
export function applyFill(cells, startRow, startCol, colorId, rows, cols) {
  const seed = cells.get(cellKey(startRow, startCol));
  const seedColorId = seed ? seed.colorId : undefined;
  if (seed && seed.colorId === colorId) return [];

  const visited = new Set();
  const queue = [[startRow, startCol]];
  const patch = [];
  while (queue.length > 0) {
    const [row, col] = queue.pop();
    const key = cellKey(row, col);
    if (visited.has(key)) continue;
    visited.add(key);

    const cell = cells.get(key);
    const matchesSeed = cell ? cell.colorId === seedColorId : seedColorId === undefined;
    if (!matchesSeed) continue;

    patch.push({ row, col, before: cell, after: { colorId } });
    setCell(cells, row, col, colorId);

    for (const [nRow, nCol] of peyoteNeighbors(row, col)) {
      if (nRow < 0 || nRow >= rows || nCol < 0 || nCol >= cols) continue;
      if (!visited.has(cellKey(nRow, nCol))) queue.push([nRow, nCol]);
    }
  }
  return patch;
}
```

**Decision: filling into empty space is allowed** (e.g. tapping a blank grid fills the whole background) — this is genuinely useful ("fill the background white") and needs no confirm dialog, the same reasoning that already applies to draw: it's a single undo-able action, not a destructive one that discards history the way Clear/regenerate do. `null` as `colorId` (Phase 6's unassigned marker) is a valid, matchable seed/target exactly like any real color — falls straight through the equality check with no special-casing, the same "null flows through the existing pipeline" property Phase 6 already relied on for drawTool/eraseTool/historyStore.

*Verify* (`node --test`): filling an isolated single cell only changes that cell; filling a same-colored contiguous blob changes exactly the blob and stops at a differently-colored or absent border; filling starting on an absent cell occupies the connected absent region (bounded by `rows`/`cols` and by any occupied cells) and no further; filling with the seed's own color is a no-op (empty patch); a fill across an even/odd row-parity boundary correctly follows the two-cells-per-adjacent-row peyote adjacency (construct a small fixture where 4-connectivity and 6-connectivity would diverge, confirm the 6-connectivity result). Timing check on a 300×200 fully-blank grid (60,000 cells, worst case for one fill) — should be comfortably sub-100ms per Phase 5's precedent for full-grid passes.

## `src/tools/colorReplaceTool.js`

```js
import { cellKey, setCell } from '../state/cellStore.js';

// Replaces every cell in `cells` whose colorId matches sourceColorId with
// targetColorId — global across the whole active colorway, not scoped to a region
// (matches the plain meaning of "replace this color"; a selection-scoped variant
// is a possible later refinement, not needed for v1). Never touches absent cells —
// this is a recolor, not a shape change, unlike fill.
export function applyColorReplace(cells, sourceColorId, targetColorId) {
  if (sourceColorId === targetColorId) return [];
  const patch = [];
  for (const [key, cell] of cells) {
    if (cell.colorId !== sourceColorId) continue;
    const [row, col] = key.split(',').map(Number);
    patch.push({ row, col, before: cell, after: { colorId: targetColorId } });
    setCell(cells, row, col, targetColorId);
  }
  return patch;
}
```

The canvas tap that triggers this only supplies `sourceColorId` (whatever's under the tapped cell — a tap on an absent cell is a no-op, nothing to replace); `targetColorId` is always the currently selected palette color (`appState.selectedColorId`), reusing the existing color-picker UI with no new control needed. `sourceColorId === null` (an unassigned Phase-6 cell) works identically to any real color — "replace every unassigned cell in this colorway with X" is a legitimate, useful case and needs no special-casing.

*Verify* (`node --test`): replacing a color that appears in 3 non-contiguous places changes all 3 and nothing else; replacing a color with itself is a no-op; replacing `null` (unassigned) recolors every unassigned cell; replacing a color that doesn't appear in `cells` at all returns an empty patch.

## `src/tools/cutCopyTool.js`

Copy, Cut, and Paste share one clipboard shape, so they live together per the architecture doc's "one file per tool" convention read as "cut/copy" being one line item (paste is the natural completion of that pair, not a separate tool conceptually).

```js
import { cellKey, setCell, clearCell } from '../state/cellStore.js';

// Reads every occupied cell within `selection`'s bounds into a clipboard object,
// coordinates relative to the selection's top-left corner. Absent cells inside the
// bounds are simply not listed — same sparse convention cellsToEntries already uses.
export function buildClipboard(cells, selection) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  const entries = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const cell = cells.get(cellKey(row, col));
      if (cell) entries.push([row - rowStart, col - colStart, cell.colorId]);
    }
  }
  return { rows: rowEnd - rowStart + 1, cols: colEnd - colStart + 1, cells: entries };
}

// The erase half of Cut — removes every occupied cell within selection's bounds,
// returning the patch so it's undo-able exactly like any other multi-cell action.
export function applyEraseRegion(cells, selection) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  const patch = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const key = cellKey(row, col);
      const before = cells.get(key);
      if (!before) continue;
      patch.push({ row, col, before, after: undefined });
      clearCell(cells, row, col);
    }
  }
  return patch;
}

// Stamps clipboard content anchored with its top-left at (anchorRow, anchorCol).
// Overwrites whatever's already there (paste is destructive over its own footprint,
// the conventional behavior). Entries landing outside [0,rows)x[0,cols) are clipped,
// not shifted — same "drop what doesn't fit" rule resizeGrid.js's remapEntries
// already uses, so a paste stamped near an edge just doesn't fully land there.
export function applyPaste(cells, clipboard, anchorRow, anchorCol, rows, cols) {
  const patch = [];
  for (const [relRow, relCol, colorId] of clipboard.cells) {
    const row = anchorRow + relRow;
    const col = anchorCol + relCol;
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
    const key = cellKey(row, col);
    const before = cells.get(key);
    if (before && before.colorId === colorId) continue; // no-op cell, skip
    patch.push({ row, col, before, after: { colorId } });
    setCell(cells, row, col, colorId);
  }
  return patch;
}
```

**Clipboard persistence: none.** `appState.clipboard` is in-memory only, like `appState.history` — but unlike history, it does *not* need clearing on design switch, colorway switch, or resize: its coordinates are relative offsets, not absolute, so a clipboard copied in one design/colorway/grid size still pastes correctly (as literal `colorId` values, frozen at copy time — not a live reference) anywhere else with the same semantics a real OS clipboard has. The only cost of not persisting it is that it's lost on a page reload — acceptable, and consistent with treating it as transient editing state rather than design content.

**Selection: cleared on resize and regenerate** (coordinates become meaningless after either — same reasoning `clearHistory` already applies at both of those call sites), left alone on colorway switch (same rows/cols, still valid).

*Verify* (`node --test`): `buildClipboard` on a selection with a mix of occupied/absent cells produces the right relative coordinates and omits absent cells; round-trip `buildClipboard` → `applyPaste` at the same anchor reproduces the original region exactly; `applyPaste` clips entries that would land outside grid bounds without shifting the rest; `applyEraseRegion` only touches occupied cells within bounds and its patch's `before` values match a hand-built fixture.

## `src/tools/mirrorTool.js`

```js
import { cellKey, setCell, clearCell } from '../state/cellStore.js';

function flippedCoord(row, col, selection, axis) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  return axis === 'horizontal'
    ? { row, col: colStart + colEnd - col }
    : { row: rowStart + rowEnd - row, col };
}

// axis: 'horizontal' | 'vertical'. Caller must not invoke 'vertical' on an
// even-height selection (see the parity constraint above) — enforced at the UI
// layer by disabling the button, not re-checked here, since this function has no
// way to produce a *correct* result for that case, only a silently wrong one.
export function applyMirror(cells, selection, axis) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  // Read every cell's current value before writing any of them — a swap, not a
  // sequence of independent writes, since two cells can be re-reading each other.
  const before = new Map();
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      before.set(cellKey(row, col), cells.get(cellKey(row, col)));
    }
  }

  const patch = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const key = cellKey(row, col);
      const { row: srcRow, col: srcCol } = flippedCoord(row, col, selection, axis);
      const source = before.get(cellKey(srcRow, srcCol));
      const current = before.get(key);
      if (current === source) continue; // both absent, or (shouldn't happen) identical objects
      if (source && current && source.colorId === current.colorId) continue;
      patch.push({ row, col, before: current, after: source ? { colorId: source.colorId } : undefined });
      if (source) setCell(cells, row, col, source.colorId);
      else clearCell(cells, row, col);
    }
  }
  return patch;
}
```

Each cell in the bbox is visited once and paired with its mirror partner (also inside the bbox, since the flip maps the bbox onto itself) — the patch naturally ends up with two entries per swapped pair, one per direction, which is correct and exactly matches how a "before/after per cell" patch already represents a two-cell swap elsewhere (nothing new here, just worth noting it's not a bug that both sides of a swap appear).

*Verify* (`node --test`): horizontal flip of an asymmetric 1-row selection reverses it exactly; vertical flip of an odd-height selection produces the expected result (hand-verified against a small fixture, including cells that are occupied on one side and absent on the other — confirming the shape change propagates correctly); flipping a selection that's already symmetric about its own axis produces an empty patch (no-op detection working, not just "technically correct but wasteful"); flipping twice (horizontal then horizontal again) returns to the original state.

## Pointer routing changes (`src/interaction/pointerRouter.js`)

Extends the existing tool dispatch. `getTool()` can now return `'draw' | 'erase' | 'fill' | 'replace' | 'select' | 'paste'` (`'move-photo'` covered separately below, in the photo trace section, since it doesn't touch `cells` at all).

```js
const STROKE_TOOLS = new Set(['draw', 'erase']);      // existing: continuous drag, interpolated
const DISCRETE_TOOLS = new Set(['fill', 'replace', 'paste']); // new: one action per pointerdown
```

In `handlePointerDown`'s single-touch/pen and mouse-left-drag branches, where `startDrawStroke(e.pointerId, point)` is currently called unconditionally: branch on `getTool()`. `STROKE_TOOLS` keeps the existing path unchanged. `DISCRETE_TOOLS` calls a new `performDiscreteAction(point)` instead, and does **not** set `drawStroke` — so `handlePointerMove`'s existing `drawStroke && drawStroke.pointerId === e.pointerId` branch simply never matches for these tools, meaning no code changes are needed in the move/end handlers at all for this part. `'select'` gets its own branch (see below) that also skips `drawStroke`.

```js
function performDiscreteAction(point) {
  const worldPoint = screenToWorld(point.x, point.y, viewport);
  const gridParams = getGridParams();
  if (!gridParams) return;
  const hit = peyoteCellAtPoint(worldPoint.xMm, worldPoint.yMm, gridParams.beadWidthMm, gridParams.beadHeightMm, gridParams.rows, gridParams.cols);
  if (!hit) return;
  const cells = getCells();
  const tool = getTool();
  let patch;
  if (tool === 'fill') {
    patch = applyFill(cells, hit.row, hit.col, getColorId(), gridParams.rows, gridParams.cols);
  } else if (tool === 'replace') {
    const source = cells.get(cellKey(hit.row, hit.col));
    if (!source) return; // tapped an empty cell — nothing to replace
    patch = applyColorReplace(cells, source.colorId, getColorId());
  } else if (tool === 'paste') {
    const clipboard = getClipboard();
    if (!clipboard) return; // shouldn't be reachable (paste tool only selectable with a clipboard), belt-and-suspenders
    patch = applyPaste(cells, clipboard, hit.row, hit.col, gridParams.rows, gridParams.cols);
  }
  if (patch && patch.length > 0) {
    onCellsChanged();
    onStrokeCommitted(patch); // same commit path draw/erase strokes already use
  }
}
```

New config getter needed: `getClipboard`. `'select'` gets a small parallel state machine, mirroring `mouseDrag`'s shape (ephemeral, pointerRouter-local):

```js
let selectionDrag = null; // { startRow, startCol } or null

// pointerdown (single touch/pen, or mouse-left, when getTool() === 'select'):
selectionDrag = clampedHit(point); // clamped to grid bounds, not null-on-miss —
                                    // a marquee should still track while the pointer
                                    // is briefly outside the canvas/grid edge
onSelectionChange(normalizeSelection(selectionDrag, selectionDrag));

// pointermove, when selectionDrag is set:
const end = clampedHit(point);
onSelectionChange(normalizeSelection(selectionDrag, end));

// pointerup: no special handling needed — the last onSelectionChange call already
// left appState.selection at its final value; just clear selectionDrag locally.
```

`clampedHit` needs a clamped variant of `peyoteCellAtPoint` that returns a row/col clamped into `[0, rows)`/`[0, cols)` instead of `null` outside those bounds — add `peyoteCellAtPointClamped` to `src/grid/peyote.js` alongside the existing function (same row-then-col resolution, `Math.max(0, Math.min(rows - 1, row))` / same for col instead of the early `return null`). New config getters needed: `onSelectionChange`.

*Verify*: covered under editorView's Playwright pass below (pointerRouter's new branches have no independent DOM-free unit test target, same as the existing draw/erase stroke logic — it's exercised through the canvas).

## `editorView.js` wiring

New toolbar buttons join the existing `#tool-toggle` group: **Fill**, **Replace**, **Select** (draw/erase/fill/replace/select — 5 buttons total in one group, same `aria-pressed` toggle pattern already used for draw/erase). Paste is *not* a persistent toggle button in that group — clicking the new **Paste** button (in a new `#selection-controls` group, disabled until `appState.clipboard` is set) directly sets `appState.tool = 'paste'` and updates the tool-toggle group's pressed state to match, so Paste behaves as a one-click "switch into stamp mode" action rather than requiring two taps (switch tool, then tap canvas). **Decision: pasting does not auto-revert the tool back to draw after one stamp** — staying in paste mode supports the common case of stamping a repeated motif several times; the user switches tools normally (tapping Draw, Erase, etc.) when done, same as any other tool.

New `#selection-controls` group: **Copy**, **Cut**, **Paste**, **Mirror ↔** (horizontal), **Mirror ↕** (vertical). A shared `updateSelectionButtons()` (same pattern as `updateHistoryButtons()`/`updateColorwaySelect()`) runs after every selection or clipboard change:
- Copy/Cut/Mirror ↔: disabled when `appState.selection` is null.
- Mirror ↕: disabled additionally when `appState.selection`'s height is even (title attribute explains why, per the parity constraint above).
- Paste: disabled when `appState.clipboard` is null.

Handlers:
```js
function handleCopy() {
  if (!appState.selection) return;
  appState.clipboard = buildClipboard(appState.cells, appState.selection);
  updateSelectionButtons();
}
function handleCut() {
  if (!appState.selection) return;
  appState.clipboard = buildClipboard(appState.cells, appState.selection);
  const patch = applyEraseRegion(appState.cells, appState.selection);
  if (patch.length > 0 && pushPatch(appState.history, patch)) updateHistoryButtons();
  updateSelectionButtons();
  scheduleRedraw();
  hooks.onCellsChanged();
}
function handleMirror(axis) {
  if (!appState.selection) return;
  const patch = applyMirror(appState.cells, appState.selection, axis);
  if (patch.length > 0 && pushPatch(appState.history, patch)) updateHistoryButtons();
  scheduleRedraw();
  hooks.onCellsChanged();
}
function handlePasteButtonClick() {
  if (!appState.clipboard) return;
  appState.tool = 'paste';
  updateToolButtons();
}
```

`switchColorway`, `regenerateGrid`, and `applyResize` each gain one line clearing `appState.selection = null` at the point they already clear/rebuild history (regenerate and resize; colorway switch does **not** clear selection, per the "Selection" decision above). `renderColorPalette`'s existing selected-tool logic in `updateToolButtons()` extends to the three new tool buttons, same pattern as the existing two.

`render()` draws the selection overlay after the grid, when present — a new small function in a new module (kept separate from `canvasRenderer.js` so that module's existing exported signature and "stays ignorant of what a color library is" scope stay exactly as they are):

```js
// src/render/selectionOverlay.js
import { peyoteCellOriginMm } from '../grid/peyote.js';
import { worldToScreen } from './viewport.js';

const SELECTION_STROKE_STYLE = '#2c7be5';
const SELECTION_FILL_STYLE = 'rgba(44, 123, 229, 0.12)';
const SELECTION_LINE_WIDTH_PX = 2;
const SELECTION_DASH = [6, 4];

export function drawSelectionOverlay(ctx, viewport, gridParams, selection) {
  if (!selection) return;
  const { beadWidthMm, beadHeightMm } = gridParams;
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  const topLeftMm = peyoteCellOriginMm(rowStart, colStart, beadWidthMm, beadHeightMm);
  const bottomRightMm = peyoteCellOriginMm(rowEnd, colEnd, beadWidthMm, beadHeightMm);
  const topLeft = worldToScreen(topLeftMm.xMm, topLeftMm.yMm, viewport);
  // bottomRight uses the *far* corner of the end cell, not its origin — add one full
  // cell's extent so the box encloses the last row/col rather than stopping at its start.
  const bottomRight = worldToScreen(bottomRightMm.xMm + beadHeightMm, bottomRightMm.yMm + beadWidthMm, viewport);

  ctx.save();
  ctx.fillStyle = SELECTION_FILL_STYLE;
  ctx.fillRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.strokeStyle = SELECTION_STROKE_STYLE;
  ctx.lineWidth = SELECTION_LINE_WIDTH_PX;
  ctx.setLineDash(SELECTION_DASH);
  ctx.strokeRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.restore();
}
```

Note this reuses `peyoteCellOriginMm` directly rather than needing a new grid-math helper — the selection box's world-space corners are just two ordinary cell origins plus one cell's extent.

## Photo trace overlay

The most architecturally novel piece of this phase — a new persisted record type, a new render layer with its own paint-order requirement, and a new pointer-interaction mode for positioning/scaling.

### Storage: `src/storage/photoTraceStore.js` + `db.js` bump

**Decision: a photo trace is stored in its own IndexedDB object store, keyed by `designId`, not embedded in the design record.** A design record is rewritten on every debounced autosave while drawing; a photo trace's image `Blob` can be several MB, and the position/opacity fields change far less often than cell data does. Embedding it would mean re-serializing a multi-MB blob on every routine cell-edit autosave tick — pure waste. A separate store, saved only when the photo trace itself changes, avoids that entirely.

```js
// db.js — bump DB_VERSION to 2, add the new store guarded the same way the
// existing two already are (onupgradeneeded only fires when the version
// increases, so this runs exactly once for anyone with an existing v1 database).
if (!db.objectStoreNames.contains('photoTraces')) db.createObjectStore('photoTraces', { keyPath: 'designId' });
```

```js
// photoTraceStore.js
import { get, put, del } from './db.js';
const STORE = 'photoTraces';

export const getPhotoTrace = (db, designId) => get(db, STORE, designId);
export const savePhotoTrace = (db, designId, record) =>
  put(db, STORE, { ...record, designId, updatedAt: Date.now() });
export const deletePhotoTrace = (db, designId) => del(db, STORE, designId);
```

Persisted record shape: `{ designId, blob, opacityPercent, xMm, yMm, widthMm, heightMm, updatedAt }`. Position/size stored in mm (Decision #6 — internal units always mm), so it composes with the viewport's existing `worldToScreen` transform with no separate coordinate system: panning/zooming the canvas moves and scales the photo exactly like it does the grid, for free.

No `node:test` coverage possible here (no IndexedDB in Node, same reasoning as `designStore.js`/Phase 4) — verified in headless Chromium.

### Loading and decoding

A hidden `<input type="file" accept="image/*">`, triggered by a **Load Photo** button. On `change`, the selected `File` (itself a `Blob`) is stored as-is (structured-clone handles `Blob` natively — no base64/data-URL conversion needed) and decoded once via `createImageBitmap(file)` into `appState.photoTrace.image` for repeated fast redraws without re-decoding every frame.

**Default placement on load:** centered over the grid's current bounding box, scaled (uniformly, preserving the image's own aspect ratio) so its larger dimension matches the grid's corresponding bounding-box dimension — a reasonable starting point the user then adjusts, not an attempt at automatic alignment (Decision #10 is explicit that auto-conversion/alignment isn't wanted; this is just "put it somewhere visible and reasonably sized" so the user isn't hunting for a speck).

```js
// src/state/photoTrace.js — pure placement/scale math, no DOM/canvas/IndexedDB
export function defaultPhotoPlacement(imageWidthPx, imageHeightPx, gridBoundingBoxMm) {
  const scale = Math.min(
    gridBoundingBoxMm.widthMm / imageWidthPx,
    gridBoundingBoxMm.heightMm / imageHeightPx
  );
  const widthMm = imageWidthPx * scale;
  const heightMm = imageHeightPx * scale;
  return {
    widthMm,
    heightMm,
    xMm: (gridBoundingBoxMm.widthMm - widthMm) / 2,
    yMm: (gridBoundingBoxMm.heightMm - heightMm) / 2,
  };
}

// Used by the pinch-to-scale "Move Photo" interaction — scales widthMm/heightMm by
// scaleFactor while keeping anchorWorld pinned under screenPoint, mirroring
// pointerRouter.js's existing zoomToAnchor for the main viewport but operating on
// the photo's own xMm/yMm/widthMm/heightMm instead of a shared viewport object.
export function scalePhotoToAnchor(photoTrace, anchorWorld, scaleFactor) {
  const newWidthMm = photoTrace.widthMm * scaleFactor;
  const newHeightMm = photoTrace.heightMm * scaleFactor;
  // Keep the point under the pinch anchor fixed: it's at a fractional position
  // within the photo (relative to its top-left) that must stay the same fraction
  // after scaling.
  const fracX = (anchorWorld.xMm - photoTrace.xMm) / photoTrace.widthMm;
  const fracY = (anchorWorld.yMm - photoTrace.yMm) / photoTrace.heightMm;
  return {
    widthMm: newWidthMm,
    heightMm: newHeightMm,
    xMm: anchorWorld.xMm - fracX * newWidthMm,
    yMm: anchorWorld.yMm - fracY * newHeightMm,
  };
}
```

*Verify* (`node --test`): `defaultPhotoPlacement` centers a wider-than-tall image correctly against both a wider and a taller grid bounding box (confirming the `Math.min` picks the right constraining dimension in both cases); `scalePhotoToAnchor` at `scaleFactor = 1` is a no-op; scaling up/down keeps the anchor point's fractional position within the photo constant (compute the anchor's fractional position before and after, assert equal).

### Rendering: paint order

Reference image must render **behind** the grid (beads drawn on top, so the user can see both the photo and what they've stitched so far). `drawPeyoteGrid` already does its own background fill as the first thing it does — inserting the photo *before* calling it would just get erased. **Decision: `drawPeyoteGrid` gains one new optional trailing parameter, `photoLayer = null`**, drawn immediately after the background fill and before the cell loop — keeping `canvasRenderer.js` as the single place that owns paint order (consistent with its existing role), rather than splitting background-fill-then-photo-then-grid across two modules. `photoLayer`, when present, is `{ image, opacityPercent, xMm, yMm, widthMm, heightMm }` — plain drawable data, no knowledge of "photo trace" as a persisted concept, matching the module's existing "stays ignorant of what a color library is" philosophy.

```js
// canvasRenderer.js — inserted right after the existing background ctx.fillRect call
if (photoLayer) {
  const topLeft = worldToScreen(photoLayer.xMm, photoLayer.yMm, viewport);
  const bottomRight = worldToScreen(photoLayer.xMm + photoLayer.widthMm, photoLayer.yMm + photoLayer.heightMm, viewport);
  ctx.save();
  ctx.globalAlpha = photoLayer.opacityPercent / 100;
  ctx.drawImage(photoLayer.image, topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.restore();
}
```

Existing callers (all of Phases 1–6's tests and every other call site) keep working unchanged since the new parameter defaults to `null`.

### Positioning/scaling interaction: the "Move Photo" tool

A new pointer-router tool value, `'move-photo'`, active only while the photo controls' **Move Photo** toggle button is pressed (a separate small toggle group next to the photo controls, not mixed into the main `#tool-toggle` — moving the photo is a distinct, occasional action, not a drawing tool). While active:
- **Single-pointer drag** (touch/pen/mouse) translates the photo: `photoTrace.xMm/yMm` shift by the same screen-to-world delta `mouseDrag`'s panning branch already computes, applied to the photo instead of the viewport.
- **Two-pointer pinch** scales the photo via `scalePhotoToAnchor`, structurally identical to the existing pinch-zoom branch but targeting `appState.photoTrace` instead of `viewport` and calling a new `onPhotoTraceChange` hook instead of `onViewportChange`.

This tool never touches `appState.cells` — no interaction with `historyStore`/undo at all (repositioning a reference photo isn't drawing content, so it's reasonable that it isn't undo-tracked; if the user moves it somewhere bad they just move it again). `pointerRouter.js`'s existing two-pointer pinch branch already computes `midpoint`/`distance`/`pinchBaseline` generically — reused as-is, just routed to a different target object based on `getTool() === 'move-photo'` at the point `zoomToAnchor(viewport, ...)` is currently called unconditionally.

Once positioned, changes are saved via a **separate debounce** in `main.js` (distinct from the main design autosave, since it targets `photoTraceStore` not `designStore`) — created alongside the existing `debouncedSave` when a design with a photo trace opens, discarded on `backToLibrary()` the same way. `hooks.onPhotoTraceChanged()` is a new `editorView.js` hook, fired from the move-photo drag/pinch handlers and from the opacity slider's `input` event, mirroring `onCellsChanged()`'s existing role.

### UI: `#photo-trace-controls`

New group in `#controls`: **Load Photo** (hidden file input + visible trigger button, always present), an opacity `<input type="range" min="0" max="100">` (visible only once `appState.photoTrace` is set), a **Move Photo** toggle button (same visibility condition), a **Remove Photo** button (same visibility condition, `confirm()`-guarded, calls `deletePhotoTrace` and clears `appState.photoTrace`).

**Flagged risk, matching Phase 6's precedent note about toolbar crowding**: `#controls` is already a fairly full toolbar after Phase 6 added colorway controls; this phase adds `#tool-toggle` entries (Fill/Replace/Select), a new `#selection-controls` group (5 buttons), and now `#photo-trace-controls` (up to 4 controls). Real iPad verification (see build order below) needs to confirm this doesn't wrap into an unusable mess — if it does, the fix is almost certainly a secondary/overflow toolbar or a "Tools" popover rather than a data-model change, so it doesn't block writing this plan, but it's a real risk worth flagging before implementation starts rather than after.

### Loading on design open (`main.js`)

`openDesign()` stays synchronous and mounts the editor immediately with `appState.photoTrace = null`, exactly as today — then kicks off an async `loadPhotoTraceForDesign(design.id)` that fetches the record (if any), decodes its `blob` via `createImageBitmap`, and pushes the result into the already-mounted editor. This keeps opening a design fast even if it has a multi-MB reference photo, rather than blocking the editor's first paint on a decode.

`mountEditorView`'s returned object widens from `{ unmount }` to `{ unmount, setPhotoTrace(photoTrace) }` — `main.js` calls `editorController.setPhotoTrace(...)` once the async load resolves, and `editorView.js`'s `setPhotoTrace` just assigns `appState.photoTrace` and calls `scheduleRedraw()`. (If the user has already navigated back to the library by the time a slow decode resolves, `editorController` will be `null` — the async load's `.then` needs a guard for that, same category of stale-async-result concern any debounced/awaited main.js flow already has to consider.)

## Build order + verification

Grouped so each chunk is independently committable, per the user's preference for one comprehensive plan sequenced in stages rather than split into separate documents.

1. **`peyoteNeighbors` + `peyoteCellAtPointClamped`** (`grid/peyote.js`) — foundational, no dependents yet. *Verify*: node:test cases per the "peyote-neighbor subtlety" section above.
2. **Fill** (`fillTool.js` + pointer routing + `#tool-toggle` button). *Verify* (`node --test` then Playwright): tap-fill an enclosed region on a hand-built pattern, confirm exactly the connected region changes (pixel sampling, same approach every prior phase's Playwright pass has used); tap-fill on blank canvas fills the whole background; fill is one undo step regardless of region size.
3. **Color-replace** (`colorReplaceTool.js` + pointer routing + `#tool-toggle` button). *Verify*: tap a color, confirm every same-colored cell across the whole pattern changes in one action/one undo step, including a case with an unassigned (`null`) source.
4. **Selection tool + overlay** (`select` tool, `selectionOverlay.js`, marquee pointer routing). *Verify*: dragging draws a live rectangle that tracks the pointer; releasing leaves the selection visible and persistent; switching to another tool and back leaves it intact; regenerate/resize clear it, colorway switch doesn't.
5. **Cut/Copy/Paste** (`cutCopyTool.js`, `#selection-controls`' Copy/Cut/Paste buttons, `paste` tool + pointer routing). *Verify*: Copy then Paste elsewhere reproduces the region exactly; Cut removes the original and the clipboard still pastes; pasting near an edge clips instead of shifting; repeated paste taps stamp the same content multiple times without leaving paste mode; clipboard survives a colorway switch and a resize.
6. **Mirror** (`mirrorTool.js`, Mirror ↔/↕ buttons). *Verify*: horizontal flip on an asymmetric selection; vertical flip on an odd-height selection; Mirror ↕ correctly disabled (with explanatory title) on an even-height selection; flipping a selection containing a mix of occupied/absent cells produces the correct shape change on both sides of the swap.
7. **Photo trace: storage + rendering** (`db.js` version bump, `photoTraceStore.js`, `photoTrace.js` placement math, `canvasRenderer.js`'s new `photoLayer` param). *Verify* (`node --test`): placement/scale math per the section above. *Verify* (Playwright): loading an image shows it behind a still-visible grid at the expected default placement/size.
8. **Photo trace: move/scale interaction + opacity + persistence** (`move-photo` tool, opacity slider, separate debounce, `main.js` async load-on-open wiring). *Verify* (Playwright): dragging repositions the photo; pinch rescales it; the opacity slider visibly changes blend and the value persists across a reload; Remove Photo clears it and the record; reopening a design with a saved photo trace shows it at its last saved position/opacity without blocking the editor's initial paint.
9. **Toolbar layout pass** — with all of the above wired in, a dedicated look at `#controls`' total button count and wrapping behavior at a few viewport widths (desktop dev window + the iPad's actual viewport size via Playwright's device emulation before the real device pass), flagged above as a real crowding risk.
10. **Full regression pass** (Playwright) — Phases 1–6's existing verification scenarios (draw/erase/undo/redo/resize/save-reload/print/colorways) run once more end to end, confirming none of Phase 7's pointer-routing or renderer changes regressed anything already working, the same "must not regress" pass every prior phase's build order has ended on.
11. **Real iPad pass** — every new touch interaction needs on-device confirmation, more than usual for this phase specifically: pinch-to-scale-photo vs. pinch-to-zoom-viewport needs to feel unambiguous (only reachable via the dedicated Move Photo tool, so there's no gesture conflict by construction, but worth confirming it *feels* right, not just that it's technically non-conflicting); marquee-select drag vs. draw-stroke drag similarly relies on the tool toggle rather than gesture disambiguation; the toolbar crowding question from step 9; file-picker UX for Load Photo in iPad Safari; whether Fill's flood-fill feels instant on a large region on real hardware, not just in headless Chromium timing.

## Open, low-stakes implementation calls

1. **"Mirror & append"** (flip a selection and place the copy adjacent, for building a symmetric pattern from a hand-drawn half) — likely wanted based on how peyote symmetric patterns are typically designed, but deliberately out of this plan's scope (see "Scope boundary") since it introduces a new question this plan's in-place mirror avoids: what happens when the appended region overlaps existing content outside the selection. Clean fast-follow once in-place mirror ships and its parity constraint is proven out in practice.
2. **Selection-scoped color-replace.** Plan defaults to whole-colorway replace; scoping to `appState.selection` when one exists is a small, backward-compatible addition later if wanted.
3. **Paste ghost preview** (clipboard content following the pointer semi-transparently before the commit tap) — v1 commits immediately on tap with no live preview. A preview is a real usability nicety but adds a redraw-on-every-move cost this plan doesn't need to take on to ship a working paste.
4. **Toolbar layout** (flat button groups vs. an overflow/popover) — flagged in the photo trace section; default assumption is the existing flat-group style continues to work, revisit at step 9/11 if it doesn't.

## Next step after this plan

No code has been written for this phase yet. Build order above; step 1 (`peyoteNeighbors`/`peyoteCellAtPointClamped`) has no dependencies on anything else in this plan and is the natural starting point.

**Housekeeping**: CLAUDE.md's Phase 7 line currently reads "...mirror, photo trace overlay with adjustable transparency (Decision #10), grid/canvas orientation toggle." Per this session's discussion, the orientation-toggle clause should be dropped from that line (and from the Phase 2 status entry that originally logged it as an open backlog question) the next time CLAUDE.md's Phase Status section is updated, since the user considers the underlying issue already resolved by the earlier row/col transpose fix.
