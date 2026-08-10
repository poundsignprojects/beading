# Feature Plan — Draggable, Confirmable Paste Placement + Front/Behind Mode

## Context

Direct user feedback on Phase 7's paste tool: today, selecting Paste and tapping the canvas stamps the clipboard content immediately at the tapped cell (`pointerRouter.js`'s `performDiscreteAction`, one action per `pointerdown`, no way to preview or adjust before it commits). Two asks:

1. Be able to drag the pending paste into position and explicitly confirm placement, instead of it landing wherever first tapped with no chance to adjust.
2. A choice of paste-in-front (pasted beads overwrite whatever's already there — today's only behavior) vs. paste-behind (existing beads are preserved; pasted content only fills cells that are currently empty within its footprint).

This is a standalone feature plan, not a numbered Phase Plan item (Phase 8 was the last scheduled phase).

## Decisions

- **Paste becomes a "position, then confirm" tool, not a one-shot stamp.** Clicking the Paste button no longer immediately arms a tap-to-stamp mode; it opens a **pending paste preview** (`appState.pastePreview = { anchorRow, anchorCol }`) that renders as a translucent ghost of the clipboard content at its current anchor. Dragging on the canvas while the `paste` tool is active repositions the ghost (same drag-tracking shape as the existing marquee-selection and move-photo interactions in `pointerRouter.js`, not a new pattern). A separate **Confirm** action stamps it into `appState.cells` as one undo-able patch; **Cancel** (button or Escape) discards the preview without touching cells.
- **The repeated-stamping workflow from Phase 7 is preserved, not lost.** Today's docstring on the Paste button explicitly calls out that clicking Paste once and tapping several times stamps several copies in a row. The new flow keeps this: Confirm does **not** clear the preview or leave the `paste` tool — the ghost stays at the same anchor, so the user can immediately drag it elsewhere and Confirm again for the next stamp. Only Cancel (or switching to a different tool, or a geometry change) exits paste mode.
- **Default anchor on opening the preview**: if a selection is currently active, anchor at the selection's own top-left (`selection.rowStart/colStart`) — this reproduces today's "paste in place" behavior as the starting position for the common Copy-then-Paste flow, so nothing gets worse for that case, only more adjustable. If there's no active selection (e.g. it was deselected after copying), default to the grid cell nearest the current viewport's center instead of `(0,0)`, so a first-time paste doesn't need to be dragged from a corner.
- **Drag-to-position uses direct hit-testing**, not a relative pixel-delta drag: on every `pointermove` while dragging, the anchor snaps to whichever cell is currently under the pointer (same `peyoteCellAtPointClamped` helper the marquee-selection drag already uses), treating that cell as the clipboard footprint's top-left corner. Simpler to implement and reason about than accumulating a relative offset, and consistent with how `fill`/`replace` already hit-test directly rather than tracking relative motion. Flagged as an open call below in case direct top-left snapping feels awkward on-device compared to, say, treating the pointer as the footprint's center.
- **Front/behind is a paste-time merge strategy, not a persisted per-design setting.** `appState.pasteMode: 'front' | 'behind'`, defaulting to `'front'` (today's only behavior, so nothing changes for a user who never touches the new control) — session-only state like `appState.tool`, not saved with the design.
- **Only `cutCopyTool.js`'s `applyPaste` changes** to support the merge strategy; `buildClipboard`/`applyEraseRegion` are untouched. `applyPaste` already only ever writes cells that were occupied *in the clipboard* (a sparse paste, never blanking gaps within its own bounding box) — front/behind only changes what happens when a clipboard cell's target is **also already occupied** in the live grid:
  - `front` (current, default): pasted content always overwrites whatever's there — exactly today's behavior, byte-for-byte.
  - `behind`: if the target cell is already occupied, skip it — the existing bead wins and stays untouched; the paste still fills any genuinely empty cells within its footprint.

## `src/tools/cutCopyTool.js`

```js
// mode: 'front' (default, current behavior) overwrites whatever's already at each
// target cell; 'behind' leaves an already-occupied target cell untouched (existing
// bead wins) and only fills cells that are currently empty within the pasted
// footprint. Either way, a clipboard cell that was itself absent at copy time was
// never in clipboard.cells to begin with, so gaps *within* the footprint that the
// clipboard also had gaps at are never touched — unchanged from Phase 7.
export function applyPaste(cells, clipboard, anchorRow, anchorCol, rows, cols, mode = 'front') {
  const patch = [];
  for (const [relRow, relCol, colorId] of clipboard.cells) {
    const row = anchorRow + relRow;
    const col = anchorCol + relCol;
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
    const key = cellKey(row, col);
    const before = cells.get(key);
    if (mode === 'behind' && before) continue; // existing bead wins, pasted cell skipped
    if (before && before.colorId === colorId) continue; // no-op cell, skip
    patch.push({ row, col, before, after: { colorId } });
    setCell(cells, row, col, colorId);
  }
  return patch;
}
```

The trailing default-valued parameter keeps every existing call site (and every existing `cutCopyTool.test.js` case) passing unchanged — same convention `drawPeyoteGrid`'s trailing `photoLayer` parameter already established in this codebase.

New tests: `mode: 'behind'` over a footprint with one pre-occupied cell and one empty cell confirms the occupied cell's color is untouched (not even patched — the resulting patch array shouldn't mention it at all, so an undo of a `behind` paste can't accidentally restore-then-immediately-look-unchanged on a cell it never touched) and the empty cell is filled; `mode: 'front'` (explicit and default/omitted) both reproduce the existing overwrite-everything fixture unchanged.

## `src/render/pastePreviewOverlay.js` (new)

Mirrors `selectionOverlay.js`'s structure closely — reuses `peyoteCellOriginMm` directly, no new grid math.

```js
import { peyoteCellOriginMm } from '../grid/peyote.js';
import { worldToScreen } from './viewport.js';

const PASTE_PREVIEW_ALPHA = 0.55;
const PASTE_PREVIEW_BORDER_STYLE = '#2c7be5';
const PASTE_PREVIEW_BORDER_WIDTH_PX = 2;
const PASTE_PREVIEW_DASH = [4, 3];

// Ghost-renders the clipboard's content at the pending paste anchor, translucent so
// whatever it would cover (paste-in-front) or be covered by (paste-behind) stays
// visible underneath for comparison before Confirm. Bounding-box outline uses the
// same corner math selectionOverlay.js already uses for a selection rectangle.
export function drawPastePreviewOverlay(ctx, viewport, gridParams, clipboard, pastePreview, resolveColor) {
  if (!clipboard || !pastePreview) return;
  const { beadWidthMm, beadHeightMm } = gridParams;
  const { anchorRow, anchorCol } = pastePreview;

  ctx.save();
  ctx.globalAlpha = PASTE_PREVIEW_ALPHA;
  for (const [relRow, relCol, colorId] of clipboard.cells) {
    const originMm = peyoteCellOriginMm(anchorRow + relRow, anchorCol + relCol, beadWidthMm, beadHeightMm);
    const topLeft = worldToScreen(originMm.xMm, originMm.yMm, viewport);
    const bottomRight = worldToScreen(originMm.xMm + beadHeightMm, originMm.yMm + beadWidthMm, viewport);
    ctx.fillStyle = resolveColor(colorId);
    ctx.fillRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  }
  ctx.restore();

  const topLeftMm = peyoteCellOriginMm(anchorRow, anchorCol, beadWidthMm, beadHeightMm);
  const bottomRightMm = peyoteCellOriginMm(anchorRow + clipboard.rows - 1, anchorCol + clipboard.cols - 1, beadWidthMm, beadHeightMm);
  const topLeft = worldToScreen(topLeftMm.xMm, topLeftMm.yMm, viewport);
  const bottomRight = worldToScreen(bottomRightMm.xMm + beadHeightMm, bottomRightMm.yMm + beadWidthMm, viewport);
  ctx.save();
  ctx.strokeStyle = PASTE_PREVIEW_BORDER_STYLE;
  ctx.lineWidth = PASTE_PREVIEW_BORDER_WIDTH_PX;
  ctx.setLineDash(PASTE_PREVIEW_DASH);
  ctx.strokeRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.restore();
}
```

No `node:test` coverage (canvas-dependent, same as `selectionOverlay.js`/`canvasRenderer.js`'s existing precedent) — verified in headless Chromium instead.

## `src/state/appState.js`

```js
pasteMode: 'front', // 'front' | 'behind' — which side wins where a pending paste
                     // overlaps existing beads; session-only, not persisted per design
pastePreview: null,  // { anchorRow, anchorCol } while positioning a pending paste, or null
```

## `src/interaction/pointerRouter.js`

- Remove `'paste'` from `DISCRETE_TOOLS` (becomes `new Set(['fill', 'replace'])`) — paste no longer stamps on a bare tap. Remove the now-unused `applyPaste` import and `performDiscreteAction`'s `'paste'` branch entirely.
- New hooks: `getPastePreview`, `onPastePreviewChange` (same shape as `getPhotoTrace`/`onPhotoTraceChange` and `onSelectionChange`).
- New drag-tracking state: `let pasteDrag = null; // { pointerId } or null`.
- New functions, structurally identical to `startSelectionDrag`/`continueSelectionDrag`:
  ```js
  function startPastePreviewDrag(pointerId, point) {
    if (!getClipboard()) return;
    const hit = clampedHit(point);
    if (!hit) return;
    pasteDrag = { pointerId };
    onPastePreviewChange({ anchorRow: hit.row, anchorCol: hit.col });
  }

  function continuePastePreviewDrag(point) {
    const hit = clampedHit(point);
    if (!hit) return;
    onPastePreviewChange({ anchorRow: hit.row, anchorCol: hit.col });
  }
  ```
- `handleSingleInteractionStart`: add `else if (tool === 'paste') { startPastePreviewDrag(pointerId, point); }`.
- `handlePointerMove`: add an `else if (pasteDrag && pasteDrag.pointerId === e.pointerId) { continuePastePreviewDrag(point); }` branch alongside the existing `selectionDrag`/`photoDrag` branches.
- `handlePointerEnd`: add `if (pasteDrag && pasteDrag.pointerId === e.pointerId) { pasteDrag = null; }` — clears only the drag-tracking state; the preview itself (`appState.pastePreview`) persists until Confirm/Cancel, exactly like `selectionDrag` ending doesn't clear `appState.selection`.
- Second-finger-mid-gesture abort branch (`handlePointerDown`, `touchCount >= 2`): add `pasteDrag = null;` alongside the existing `selectionDrag = null; photoDrag = null;` resets.

## `src/ui/editorView.js`

New DOM refs:
```js
const pasteControlsEl = document.getElementById('paste-controls');
const pasteModeFrontButton = document.getElementById('paste-mode-front');
const pasteModeBehindButton = document.getElementById('paste-mode-behind');
const pasteCancelButton = document.getElementById('paste-cancel');
const pasteConfirmButton = document.getElementById('paste-confirm');
```

New imports: `applyPaste` moves here from being pointerRouter-only usage (still exported from `cutCopyTool.js`, just called from a new place); `drawPastePreviewOverlay`; `peyoteCellAtPointClamped` (added to the existing `../grid/peyote.js` import line); `screenToWorld` (added to the existing `../render/viewport.js`... actually not currently imported in editorView.js — add it).

- `render()`: append `drawPastePreviewOverlay(ctx, appState.viewport, appState.gridParams, appState.clipboard, appState.pastePreview, resolveColor);` after the existing `drawSelectionOverlay` call.
- `setTool(tool)`: after the existing `updateToolButtons()` call, add `updatePasteControls();` — tool changes are the one place paste-controls visibility needs to react (only visible while `tool === 'paste'`).
- `updateToolButtons()`: add `selectionPasteButton.setAttribute('aria-pressed', String(appState.tool === 'paste'));` — Paste becomes a real persistent tool state like Select/Move Photo, not a fire-and-forget action button.
- New `updatePasteControls()`:
  ```js
  function updatePasteControls() {
    const active = appState.tool === 'paste';
    pasteControlsEl.hidden = !active;
    pasteModeFrontButton.setAttribute('aria-pressed', String(appState.pasteMode === 'front'));
    pasteModeBehindButton.setAttribute('aria-pressed', String(appState.pasteMode === 'behind'));
    pasteConfirmButton.disabled = !appState.pastePreview;
  }
  ```
- New `defaultPasteAnchor()`:
  ```js
  function defaultPasteAnchor() {
    if (appState.selection) {
      return { anchorRow: appState.selection.rowStart, anchorCol: appState.selection.colStart };
    }
    const centerWorld = screenToWorld(lastCssSize.cssWidth / 2, lastCssSize.cssHeight / 2, appState.viewport);
    const hit = peyoteCellAtPointClamped(
      centerWorld.xMm, centerWorld.yMm,
      appState.gridParams.beadWidthMm, appState.gridParams.beadHeightMm,
      appState.gridParams.rows, appState.gridParams.cols
    );
    return { anchorRow: hit.row, anchorCol: hit.col };
  }
  ```
- `handlePasteButtonClick` (replaces today's version, which just called `setTool('paste')`):
  ```js
  function handlePasteButtonClick() {
    if (!appState.clipboard) return;
    appState.pastePreview = defaultPasteAnchor();
    setTool('paste');
    scheduleRedraw();
  }
  ```
- New `handlePasteConfirm()`:
  ```js
  function handlePasteConfirm() {
    if (!appState.pastePreview || !appState.clipboard) return;
    const { anchorRow, anchorCol } = appState.pastePreview;
    const patch = applyPaste(
      appState.cells, appState.clipboard, anchorRow, anchorCol,
      appState.gridParams.rows, appState.gridParams.cols, appState.pasteMode
    );
    if (patch.length > 0 && pushPatch(appState.history, patch)) updateHistoryButtons();
    scheduleRedraw();
    if (patch.length > 0) hooks.onCellsChanged();
  }
  ```
  Deliberately does not clear `appState.pastePreview` or change `appState.tool` — see "repeated-stamping workflow" decision above.
- New `handlePasteCancel()`:
  ```js
  function handlePasteCancel() {
    appState.pastePreview = null;
    setTool('draw');
    scheduleRedraw();
  }
  ```
- New `handlePasteModeChange(mode)`: `appState.pasteMode = mode; updatePasteControls();`
- `handleKeyDown`'s Escape branch: paste-cancel takes precedence over deselect when both could apply (matches "the more specific in-progress action gets cancelled first" — same reasoning a text-field's own undo already takes precedence over the app's undo shortcut):
  ```js
  if (e.key === 'Escape') {
    if (appState.pastePreview) handlePasteCancel();
    else handleDeselect();
    return;
  }
  ```
- `regenerateGrid()` and `applyResize()`: alongside the existing `appState.selection = null;` line, add:
  ```js
  appState.pastePreview = null; // coordinates meaningless against the new geometry
  if (appState.tool === 'paste') setTool('draw');
  ```
- `attachPointerRouter(...)` call: add
  ```js
  getPastePreview: () => appState.pastePreview,
  onPastePreviewChange: (preview) => {
    appState.pastePreview = preview;
    updatePasteControls();
    scheduleRedraw();
  },
  ```
- Mount: add the five new listeners (`pasteModeFrontButton`/`pasteModeBehindButton`/`pasteCancelButton`/`pasteConfirmButton` clicks, plus `selectionPasteButton`'s existing listener now calling the new `handlePasteButtonClick`). Unmount: remove the same five.
- Not touched: `switchColorway` (a colorway switch doesn't change grid geometry, so an in-progress paste preview's coordinates stay valid — same reasoning `appState.selection` already isn't cleared there); `handleClear` (clearing cells doesn't invalidate a preview's coordinates either, only what's underneath it).

## `index.html`

New group inside `#tool-rail`, immediately after `#selection-controls`:

```html
<div id="paste-controls" role="group" aria-label="Paste placement" hidden>
  <button id="paste-mode-front" type="button" aria-pressed="true">In Front</button>
  <button id="paste-mode-behind" type="button" aria-pressed="false">Behind</button>
  <button id="paste-cancel" type="button">Cancel</button>
  <button id="paste-confirm" type="button" disabled>Confirm</button>
</div>
```

`selection-paste` in `#selection-controls` is unchanged markup-wise (still the button that opens the preview) — only its click handler and its new `aria-pressed` reflection change.

## `style.css`

`#paste-controls` styled consistent with `#selection-controls`'s existing compact grouped-button convention; `#paste-mode-front`/`#paste-mode-behind` use the same `aria-pressed` visual treatment `#tool-toggle`'s buttons already use.

## Build order + verification

1. `cutCopyTool.js` — `mode` param on `applyPaste`, pure and independently testable; run existing + new `cutCopyTool.test.js` cases first, before touching anything interactive.
2. `appState.js` — `pasteMode`/`pastePreview` fields.
3. `src/render/pastePreviewOverlay.js` — new, no dependents yet.
4. `pointerRouter.js` — remove `'paste'` from `DISCRETE_TOOLS`, add the paste-drag interaction + hooks.
5. `editorView.js` — all the wiring above.
6. `index.html`/`style.css` — `#paste-controls` markup + styling.
7. `main.js` — no change needed here (pastePreview isn't persisted; `openDesign()` already resets `appState.selection = null` — add `appState.pastePreview = null;` next to it for the same reason: a previous design's preview coordinates don't apply to a newly-opened design).
8. Verification pass (Playwright, same approach as prior phases):
   - Draw a small pattern, marquee-select part of it, Copy. Click Paste: confirm the ghost preview appears immediately at the selection's own position (dashed border + translucent beads, pixel-sampled at reduced alpha against the background) and Confirm is enabled.
   - Drag the preview to a new position: confirm the ghost visibly follows the drag (pixel-sample the old and new positions before/after).
   - With `Behind` selected, drag the preview over an area with some pre-existing beads and some empty cells, then Confirm: pixel-verify a pre-existing bead's color is untouched and a previously-empty cell within the footprint is now filled with clipboard content.
   - Switch to `In Front`, drag over a different overlapping area, Confirm: pixel-verify the pre-existing bead there **is** overwritten by the pasted color.
   - Cancel (button, then separately Escape) clears the preview, reverts to Draw tool, and leaves `appState.cells` completely unchanged from immediately before Cancel was pressed.
   - Escape with no active paste preview still deselects an active marquee selection (regression check against Phase 7's existing Escape-to-deselect behavior).
   - Each Confirm is its own undo step: Undo immediately after a confirmed paste restores the pre-paste canvas state exactly (full-canvas pixel snapshot compared, same technique Phase 3's stroke-undo verification used).
   - Repeated-stamp workflow: after one Confirm, drag to a new spot without clicking Paste again, Confirm a second time — both stamps land, tool never left `paste` in between.
   - Regenerate/Resize while a paste preview is active clears it and reverts to Draw tool with no error.

## Open, low-stakes implementation calls

- **Direct top-left snapping vs. a relative-offset drag or center-anchored drag** (see Decisions) — cheap to swap later if it doesn't feel right on a real iPad; doesn't touch the data model or `applyPaste`'s signature.
- **No keyboard shortcut for Confirm** (e.g. Enter) — Escape-to-cancel is included since it matches the existing deselect precedent, but a Confirm shortcut wasn't asked for; easy to add later as `e.key === 'Enter'` alongside the existing Escape branch if wanted.
- **Paste preview isn't tinted differently per-cell to show which specific cells will be skipped in `behind` mode** — the ghost shows what's being pasted, not a cell-by-cell conflict/no-conflict breakdown. A future refinement could sample `appState.cells` while building the preview and render conflicting cells with a distinct (e.g. hatched or red-bordered) treatment; deferred as a nice-to-have, not needed for the core ask.

## Next step after this plan

Not scheduled into the numbered Phase Plan (Phase 8 was the last scheduled phase) — this and the library thumbnail gallery plan are both standalone feature plans, implemented independently of each other.
