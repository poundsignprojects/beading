# Feature Plan — Tap-to-Add-Points Polygon Select

## Context

The only way to select today is the existing marquee (`tool === 'select'`, `pointerRouter.js`'s `startSelectionDrag`/`continueSelectionDrag`), which is a rectangular drag and always produces `appState.selection = { rowStart, rowEnd, colStart, colEnd }`. The user asked for a lasso-style select where tapping the canvas adds a vertex to a polygon boundary — explicitly **not** a freeform continuous-drag lasso (no need to trace a smooth outline with a finger/Pencil) — so the selected region can be an arbitrary straight-edged shape (an L, a triangle, a diamond) rather than always an axis-aligned box.

This is a standalone feature plan, not a numbered Phase Plan item (Phase 8 was the last scheduled phase). No code has been written yet — planning only, per explicit instruction.

## Why this is bigger than "add a new tool"

`appState.selection`'s rectangle shape is read directly by four consumers, all of which assume every cell in `[rowStart,rowEnd] x [colStart,colEnd]` is genuinely part of the selection:

- `cutCopyTool.js`'s `buildClipboard` / `applyEraseRegion` (Copy/Cut)
- `mirrorTool.js`'s `applyMirror` (Mirror H/V)
- `rotateGrid.js`'s `rotateSelection180` (in-place 180° rotate)
- `selectionOverlay.js`'s `drawSelectionOverlay` (the visual box)

A polygon whose bounding box is a rectangle but whose actual interior isn't (an L-shape's bounding box includes the missing corner) needs every one of these to know which cells inside the box are actually included. Building the tap-to-add-vertex interaction alone is the smaller half of this feature; making Copy/Cut/Mirror/Rotate respect the polygon's true shape instead of silently falling back to its bounding box is the larger half, and is what makes this meaningfully different from the existing marquee tool.

## Decisions

- **`appState.selection` gains an optional `mask` field**: `{ rowStart, rowEnd, colStart, colEnd, mask: Set<string> | null }`. `mask` is `null` for an ordinary marquee selection (fully backward compatible — every existing consumer that doesn't know about `mask` keeps working exactly as today, since a plain rectangle IS "every cell in bounds is included"). A lasso selection populates `mask` with the cell keys (`"row,col"`, matching `cellKey()`) actually inside the closed polygon, plus the bounding box of just those cells (for the paste-anchor/rotation-90 machinery that already works in terms of a bounding rectangle).
- **A new, separate tool: `'lasso-select'`.** Not a mode of the existing `'select'` tool — keeps the well-tested rectangular marquee drag completely untouched, and lets the polygon-building interaction (discrete taps, no drag) live on its own without adding branching to `startSelectionDrag`/`continueSelectionDrag`. Once a polygon is closed, the tool switches to `'select'` automatically so the existing `#selection-controls` (Copy/Cut/Mirror/Rotate/Deselect) apply unchanged — `'lasso-select'` only ever exists to *construct* a `selection`, never to hold it.
- **Closing is an explicit Done button, not a "tap near the first point" gesture.** Hit-testing "close enough to the first vertex" is finicky at bead scale on touch and adds a whole sub-problem (what radius counts as "close," what happens if two vertices are naturally near each other). A small `#lasso-controls` group (Undo Point / Cancel / Done) mirrors the existing `#paste-controls` pattern exactly. Done is disabled until at least 3 points are placed (a polygon needs 3+ vertices); Cancel/Escape discards the in-progress polygon and reverts to Draw, matching `handlePasteCancel`'s existing convention.
- **Vertices are plain world-mm points (`{ xMm, yMm }`), not snapped to any cell grid.** The existing overlay/hit-testing code already treats world-mm space as ordinary Cartesian coordinates (see `selectionOverlay.js`'s use of `worldToScreen` directly on `engine.cellOrigin` output) — a polygon in that same space needs no new coordinate concept. Cell membership is resolved once, at Done, via a point-in-polygon test against each candidate cell's center — not by snapping tapped points to grid lines. This keeps vertex placement simple (just `screenToWorld` the tap, like every other discrete tool already does) at the cost of the polygon edges not visually aligning to bead boundaries while being drawn; flagged below as an open, low-stakes call.
- **No live "rubber-band" line to the current pointer position while building the polygon.** Touch has no hover state, so a rubber-band segment would only ever animate for a mouse, making the two input methods behave differently. The overlay instead redraws the polygon-so-far (placed vertices connected in order, plus a faint dashed closing segment from the last point back to the first once ≥3 points exist) after every tap — good enough to see the shape forming without needing a continuous pointer-position feed the touch path can't provide.
- **Mirror and in-place 180° rotate are disabled on a masked selection in v1** (button `disabled` + explanatory `title`, same convention as the existing even-width Mirror-Horizontal guard). Reasoning: both operate by reading a cell and its geometrically-opposite cell and swapping them; if one of the pair falls outside an irregular mask and the other doesn't, there's no single obviously-correct behavior (skip the write? clear the masked one? leave both untouched?) and no version of this was requested. Scoping this out avoids inventing behavior nobody asked for. Copy/Cut/Paste and 90°/270° rotate (which already goes through a copy→rotate→paste round trip, not an in-place swap) are unaffected — see below, they work correctly with no extra masking logic of their own once `buildClipboard` itself is mask-aware.
- **90°/270° selection rotate needs no dedicated mask-handling code.** `handleSelectionRotate90` already builds a clipboard via `buildClipboard`, rotates it via `rotateClipboard`, and hands it to the existing paste-preview flow. Once `buildClipboard` skips non-masked cells (see below), the clipboard it produces already only contains the polygon's actual content — nothing downstream needs to know a mask was ever involved. This is a case where making the *lower-level* function correct made a *higher-level* feature correct for free.
- **Perf**: resolving a polygon into a cell mask means one pass over every `(row, col)` in `[0,rows) x [0,cols)`, evaluating a point-in-polygon test per cell — the same asymptotic cost as `fillTool.js`'s flood fill or `colorReplaceTool.js`'s global replace, both already accepted at this codebase's typical pattern sizes (hundreds by hundreds). No new perf concern.

## `src/state/polygonSelection.js` (new, pure)

```js
// pointInPolygon: standard even-odd ray-casting test. polygon is an array of
// { xMm, yMm } vertices in order (not required to repeat the first point at
// the end). A point exactly on an edge is treated as a implementation detail
// of the ray-cast (may go either way) — acceptable since cell *centers*, not
// arbitrary points, are what this module tests against, and a cell center
// landing exactly on a drawn polygon edge is a rare, low-stakes coin flip.
export function pointInPolygon(point, polygon) { ... }

// Resolves a closed polygon (world-mm vertices) into the set of cell keys
// whose *center* falls inside it, plus the bounding box of just those cells.
// gridParams is the same shape every render/interaction call site already
// has in hand (rows/cols/stitchType/beadWidthMm/beadHeightMm/staggerFlipped).
// Returns null if no cell's center falls inside the polygon (e.g. a polygon
// drawn entirely within the gap between two cell centers) — the caller shows
// a plain alert for this, same "nothing to do" convention as Crop to
// Design's own empty-selection guard.
export function resolveLassoSelection(points, gridParams) {
  const engine = resolveGridEngine(gridParams.stitchType);
  const mask = new Set();
  let rowStart = Infinity, rowEnd = -Infinity, colStart = Infinity, colEnd = -Infinity;
  for (let row = 0; row < gridParams.rows; row++) {
    for (let col = 0; col < gridParams.cols; col++) {
      const origin = engine.cellOrigin(row, col, gridParams);
      const center = {
        xMm: origin.xMm + gridParams.beadHeightMm / 2,
        yMm: origin.yMm + gridParams.beadWidthMm / 2,
      };
      if (!pointInPolygon(center, points)) continue;
      mask.add(cellKey(row, col));
      rowStart = Math.min(rowStart, row); rowEnd = Math.max(rowEnd, row);
      colStart = Math.min(colStart, col); colEnd = Math.max(colEnd, col);
    }
  }
  return mask.size === 0 ? null : { rowStart, rowEnd, colStart, colEnd, mask };
}
```

The `xMm`/`yMm` half-extent pairing mirrors `square.js`'s own comment on reusing peyote's (col→height, row→width) field pairing — worth double-checking against `engine.cellOrigin`'s actual per-engine extents at implementation time rather than assuming, since this is exactly the kind of axis pairing that's bitten this codebase before (see CLAUDE.md's row/col axis history).

New `src/test/state/polygonSelection.test.js`: `pointInPolygon` against a hand-built square, a concave "L" polygon (a point in the notch reads as outside), and a triangle; `resolveLassoSelection` against a small `generatePeyoteGrid`-shaped fixture, hand-verifying the exact mask for a triangle and an L-shape, confirming the bounding box matches the mask's true min/max (not the polygon's own min/max, which can be looser), and the empty-mask `null` case.

## `src/state/appState.js`

```js
tool: 'draw', // ... existing comment, extended: 'lasso-select' is a construction-only
              // mode — see lassoPoints below — never held long-term the way 'select' is.
...
selection: null, // { rowStart, rowEnd, colStart, colEnd, mask? } (inclusive bounds) or null.
                  // mask is a Set<cellKey> when this selection came from the lasso tool
                  // (only those cells are "in" the selection); absent/null for an ordinary
                  // rectangular marquee selection, where every cell in bounds is included.
...
// Polygon under construction while `tool === 'lasso-select'` — an array of
// { xMm, yMm } world-space vertices in tap order, or empty. Session-only,
// never persisted, cleared on Done/Cancel/geometry change exactly like
// pastePreview.
lassoPoints: [],
```

## `src/interaction/pointerRouter.js`

- New hook param: `onLassoPointAdded` (alongside `onColorPicked` — same "fires once per tap, never sets up drag state" shape as the eyedropper).
- New branch in `handleSingleInteractionStart`, parallel to the existing `'eyedropper'` branch:
  ```js
  } else if (tool === 'lasso-select') {
    const worldPoint = screenToWorld(point.x, point.y, viewport);
    onLassoPointAdded(worldPoint);
  }
  ```
  No new drag-tracking variable, no `continue*` function — a lasso vertex is a one-shot action per tap, same category as fill/replace/eyedropper, and goes through the existing `TOUCH_DRAW_DISAMBIGUATION_MS` deferral for touch input automatically (it's dispatched through `handleSingleInteractionStart`, same as everything else) so a pinch's first finger landing on the canvas while the lasso tool is active still can't spuriously add a vertex.
- No changes to two-finger pinch/zoom handling — panning/zooming while placing polygon points continues to work exactly as it does for every other tool today.

## `src/render/lassoOverlay.js` (new)

Structurally the smallest new render module in the app — draws only the in-progress polygon (finalized lasso selections render through `selectionOverlay.js`, see below, since once Done fires the result IS a `selection` like any other).

```js
import { worldToScreen } from './viewport.js';

const LASSO_STROKE_STYLE = '#2c7be5';
const LASSO_CLOSE_DASH = [4, 3];
const LASSO_VERTEX_RADIUS_PX = 4;

// Draws the polygon-under-construction: solid segments between placed
// vertices in tap order, small filled dots at each vertex, and — once there
// are enough points to close — a faint dashed segment back to the first
// vertex previewing where Done would close the shape.
export function drawLassoOverlay(ctx, viewport, points) {
  if (points.length === 0) return;
  const screenPoints = points.map((p) => worldToScreen(p.xMm, p.yMm, viewport));
  ctx.save();
  ctx.strokeStyle = LASSO_STROKE_STYLE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  screenPoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.xPx, p.yPx) : ctx.lineTo(p.xPx, p.yPx)));
  ctx.stroke();
  if (screenPoints.length >= 3) {
    ctx.setLineDash(LASSO_CLOSE_DASH);
    ctx.beginPath();
    ctx.moveTo(screenPoints[screenPoints.length - 1].xPx, screenPoints[screenPoints.length - 1].yPx);
    ctx.lineTo(screenPoints[0].xPx, screenPoints[0].yPx);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = LASSO_STROKE_STYLE;
  for (const p of screenPoints) {
    ctx.beginPath();
    ctx.arc(p.xPx, p.yPx, LASSO_VERTEX_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
```

No `node:test` coverage (canvas-dependent, same precedent as `selectionOverlay.js`/`pastePreviewOverlay.js`).

## `src/render/selectionOverlay.js`

`drawSelectionOverlay` gains a mask-aware branch: a masked selection is rendered as a per-cell tint (loop `selection.mask`, fill+outline each cell individually via `engine.cellOrigin`) instead of one bounding rectangle — a plain rectangle over an L-shaped mask would visually claim the missing corner is selected when it isn't, defeating the point of a non-rectangular selection. An unmasked (ordinary marquee) selection keeps today's single-rect fast path completely unchanged — this is a pure addition, not a rewrite:

```js
export function drawSelectionOverlay(ctx, viewport, gridParams, selection) {
  if (!selection) return;
  if (selection.mask) {
    drawMaskedSelectionOverlay(ctx, viewport, gridParams, selection.mask);
    return;
  }
  // ...existing rectangle-only code, untouched...
}
```

New `drawMaskedSelectionOverlay` iterates `selection.mask`'s keys, parses each back to `{row, col}`, and fills/strokes that one cell's rect via `engine.cellOrigin` + `worldToScreen` — the same per-cell rect math `canvasRenderer.js`'s own cell-drawing loop already uses, just reused here instead of invented fresh.

## `src/tools/cutCopyTool.js`

`buildClipboard` and `applyEraseRegion` both gain a one-line mask guard at the top of their inner loop:

```js
export function buildClipboard(cells, selection) {
  const { rowStart, rowEnd, colStart, colEnd, mask } = selection;
  const entries = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const key = cellKey(row, col);
      if (mask && !mask.has(key)) continue; // outside the lasso's actual shape
      const cell = cells.get(key);
      if (cell) entries.push([row - rowStart, col - colStart, cell.colorId]);
    }
  }
  return { rows: rowEnd - rowStart + 1, cols: colEnd - colStart + 1, cells: entries };
}
```

Same pattern in `applyEraseRegion`. `rotateClipboard` needs no change at all — it only ever operates on whatever `buildClipboard` already handed it, so it's automatically shape-correct once its input is.

New `cutCopyTool.test.js` cases: `buildClipboard`/`applyEraseRegion` with a `mask` provided, confirming a cell inside the bounding box but outside the mask is excluded even though an equivalent unmasked call would include it (an L-shape fixture: the "notch" cell must be absent from the resulting clipboard/patch).

## `src/ui/editorView.js`

- New DOM refs: `#tool-lasso-select`, `#lasso-controls`, `#lasso-undo-point`, `#lasso-cancel`, `#lasso-done`.
- New imports: `resolveLassoSelection` from `polygonSelection.js`, `drawLassoOverlay`.
- `render()`: append `drawLassoOverlay(ctx, appState.viewport, appState.lassoPoints);` after the existing `drawSelectionOverlay`/`drawPastePreviewOverlay` calls.
- `setTool(tool)`: call a new `updateLassoControls()` alongside the existing `updatePasteControls()` — visibility is tool-driven the same way.
- New `updateLassoControls()`:
  ```js
  function updateLassoControls() {
    const active = appState.tool === 'lasso-select';
    lassoControlsEl.hidden = !active;
    lassoUndoButton.disabled = appState.lassoPoints.length === 0;
    lassoDoneButton.disabled = appState.lassoPoints.length < 3;
  }
  ```
- New `handleLassoPointAdded(worldPoint)` (passed as `onLassoPointAdded` to `attachPointerRouter`): `appState.lassoPoints.push(worldPoint); updateLassoControls(); scheduleRedraw();`
- New `handleLassoUndoPoint()`: pops the last point, updates controls, redraws.
- New `handleLassoCancel()`: `appState.lassoPoints = []; setTool('draw'); scheduleRedraw();` — mirrors `handlePasteCancel` exactly.
- New `handleLassoDone()`:
  ```js
  function handleLassoDone() {
    if (appState.lassoPoints.length < 3) return;
    const resolved = resolveLassoSelection(appState.lassoPoints, appState.gridParams);
    appState.lassoPoints = [];
    if (!resolved) {
      window.alert('No cells fall inside that shape — try a larger area.');
      setTool('draw');
      return;
    }
    appState.selection = resolved;
    setTool('select');
    updateSelectionButtons();
    scheduleRedraw();
  }
  ```
- New `#tool-lasso-select` click handler alongside the existing tool buttons: `setTool('lasso-select')`.
- `updateSelectionButtons()`: Mirror H/V and Rotate 180° gain an additional disable condition when `appState.selection?.mask` is set (per the Decisions section above), with a title along the lines of `"Not available for a lasso-shaped selection"`. Copy/Cut/Rotate-90/Deselect/Paste-arming are unaffected — they already work correctly on a masked selection via the `cutCopyTool.js` change above.
- `regenerateGrid()` / `applyResize()`: alongside the existing `appState.selection = null; appState.pastePreview = null;` lines, add `appState.lassoPoints = [];` and, if `appState.tool === 'lasso-select'`, revert to `'draw'` — an in-progress polygon's coordinates are meaningless against new grid geometry, same reasoning as `pastePreview`.
- `switchColorway()`: **not** touched — a colorway switch doesn't change grid geometry, so an in-progress polygon (or a resolved masked selection) stays valid, same reasoning `appState.selection`/`appState.pastePreview` already aren't cleared there.
- `handleKeyDown`'s Escape branch: add a `lassoPoints.length > 0` check ahead of the existing paste-then-deselect precedence chain — an in-progress polygon is the most "currently in progress" action of the three, so Escape should cancel it first: `if (appState.lassoPoints.length > 0) handleLassoCancel(); else if (appState.pastePreview) handlePasteCancel(); else handleDeselect();`
- Mount/unmount: add/remove the three new button listeners, same as every other control group in this file.

## `index.html`

New tool button in `#tool-toggle`, after `#tool-select`:

```html
<button id="tool-lasso-select" type="button" class="icon-btn icon-btn-lg" data-icon="pen-tool" aria-pressed="false" title="Lasso Select (tap to add points)" aria-label="Lasso Select"></button>
```

New group after `#selection-controls` (structurally identical to `#paste-controls`):

```html
<div id="lasso-controls" role="group" aria-label="Lasso selection" hidden>
  <button id="lasso-undo-point" type="button" class="icon-btn icon-btn-lg" data-icon="undo-2" disabled title="Remove Last Point" aria-label="Remove Last Point"></button>
  <button id="lasso-cancel" type="button" class="icon-btn icon-btn-lg" data-icon="x" title="Cancel Lasso" aria-label="Cancel Lasso"></button>
  <button id="lasso-done" type="button" class="icon-btn icon-btn-lg" data-icon="check" disabled title="Close Selection" aria-label="Close Selection"></button>
</div>
```

New icon needed: **`pen-tool`** (Lucide's anchor-point/path-tool glyph — a good semantic fit for "tap to place points," and distinct from `lasso-select`, which the existing rectangular marquee tool's button already uses). Verify it still exists in Lucide's current set via the same HEAD-check-before-fetch convention every prior icon batch in this project used before vendoring it into `/vendor/icons/` and registering it in `icons.js`'s `ICON_NAMES`; `undo-2`/`x`/`check` are already vendored (used by Undo/Redo and Cancel/Confirm elsewhere) and need no new fetch.

## `style.css`

`#lasso-controls` styled identically to `#paste-controls`/`#selection-controls`'s existing compact grouped-`.icon-btn-lg` convention — no new CSS pattern needed, just another instance of the existing one.

## `main.js`

`openDesign()`: alongside the existing `appState.selection = null; appState.pastePreview = null;` lines, add `appState.lassoPoints = [];` — a previous design's in-progress polygon (if the app somehow closed mid-construction, which shouldn't normally happen but costs nothing to guard) doesn't apply to a newly-opened design.

## Build order + verification

1. `src/state/polygonSelection.js` — pure, no dependents yet; write its `node:test` cases first and get them passing in isolation before touching anything interactive.
2. `appState.js` — `lassoPoints` field, `selection`'s `mask` addition (a comment/shape change only, no behavior yet).
3. `cutCopyTool.js` — mask-aware `buildClipboard`/`applyEraseRegion`; run existing + new `cutCopyTool.test.js` cases (existing unmasked cases must still pass byte-for-byte, since `mask` is optional).
4. `selectionOverlay.js` — masked-selection rendering branch.
5. `lassoOverlay.js` — new, in-progress polygon rendering.
6. `pointerRouter.js` — `onLassoPointAdded` hook + `'lasso-select'` branch.
7. `editorView.js` — all the wiring above, including the `updateSelectionButtons()` Mirror/Rotate-180 guard.
8. `index.html`/`style.css` — markup + styling; fetch/vendor the `pen-tool` icon (HEAD-check first).
9. `main.js` — the one-line `openDesign()` addition.
10. Verification pass (Playwright, same approach as every prior phase — exact cell/world coordinates computed by reimplementing or dynamically `import()`-ing the app's own `gridEngine.js`/`viewport.js` math in the driver script):
    - Tap out an L-shaped polygon (5+ vertices) over a hand-painted multi-color area that deliberately straddles a rectangular region containing a differently-colored "notch" cell that should be excluded. Confirm Undo Point removes the last-placed vertex only; Cancel clears everything and reverts to Draw with no selection left behind; Done with fewer than 3 points is a no-op (button stays disabled).
    - After Done: confirm `appState.tool === 'select'`, the overlay renders per-cell (not one bounding rectangle — check a pixel inside the excluded notch is NOT tinted while a pixel inside an included cell IS), and `#selection-controls` is visible with Mirror H/V and Rotate 180° specifically disabled while Copy/Cut/Rotate-90/Deselect remain enabled.
    - Copy the masked selection, Paste elsewhere, and pixel-verify the pasted result reproduces only the polygon's true interior (the notch position stays empty/unaffected in the paste), not the full bounding rectangle.
    - Cut the masked selection and confirm only the masked cells were erased — a cell inside the bounding box but outside the mask (the notch, if it happened to be occupied) survives untouched.
    - Rotate 90° CW on the masked selection: confirm the resulting paste-preview ghost reflects only the polygon's true content, rotated — not a rotated rectangle with stray content where the notch was.
    - Regression: build and manipulate an ordinary rectangular marquee selection (Copy/Cut/Mirror H/V/Rotate 180°/90°) exactly as today, confirming zero behavior change for the unmasked path — every existing Phase 7/rotation-feature Playwright check should still pass unchanged.
    - Resize/regenerate/design-switch while a polygon is mid-construction clears it with no error and reverts to Draw.
    - Escape cancels an in-progress polygon in preference to an existing paste-preview or marquee selection, per the precedence chain above.

## Open, low-stakes implementation calls

- **Vertex snapping.** Vertices are plain continuous world-mm taps (see Decisions) rather than snapped to cell corners/centers. If the polygon's edges look too "loose" relative to the grid once actually used on a real pattern, snapping each tap to the nearest cell corner before adding it is a small, isolated change confined to the new `handleLassoPointAdded` — it wouldn't touch `resolveLassoSelection`'s point-in-polygon math at all.
- **`pen-tool` icon name** is a best guess at a Lucide glyph that reads as "tap to place points," not confirmed against Lucide's current set yet — verify via the existing HEAD-check convention at implementation time; a fallback like `spline` or `shapes` is easy to substitute if `pen-tool` doesn't exist or doesn't read well at `.icon-btn-lg` size.
- **No maximum vertex count.** A user could in principle tap dozens of points; nothing in this design needs a cap, since `resolveLassoSelection`'s cost is dominated by the grid pass (`rows × cols`), not the vertex count, and `pointInPolygon` is O(vertices) per cell — still cheap at any realistic polygon complexity a manual tapping gesture would produce.
- **Self-intersecting polygons** (a user taps a shape that crosses itself) aren't specially detected or blocked — the even-odd ray-casting rule in `pointInPolygon` still produces a well-defined (if visually surprising) result for a self-intersecting shape, same as it would in any standard vector-graphics tool. Not worth guarding against unless it turns out to be a common accidental gesture in practice.

## Next step after this plan

Not scheduled into the numbered Phase Plan (Phase 8 was the last scheduled phase) — implement whenever picked up, following the build order above. No code has been written for this feature yet.
