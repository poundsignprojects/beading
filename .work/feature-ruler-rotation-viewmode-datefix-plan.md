# Plan: Ruler, Rotation, Actual-Size View Toggle, Modified-Date Fix

Four independent, unrelated asks bundled into one planning pass since they came in
together. Each is scoped as its own section below with its own build order; they
can be implemented and shipped in any order, or split across sessions, without
touching each other's files (the one shared touch point is `index.html`'s top
bar, noted where relevant).

Decisions already confirmed with the user before this plan was written (via
`AskUserQuestion`):
- Rotation is a **real content transform** — rotated beads land on a genuinely
  valid, stitchable grid at the new orientation, not just a display-only rotation.
- Whole-canvas rotation and selection rotation share **the same underlying
  rotation math**, applied at different scope.

Everything else below is this session's own design work grounded in the current
codebase (not re-confirmed with the user yet) — flagged inline wherever it's a
judgment call rather than a fact, so it's easy to redirect before implementation.

---

## 1. Ruler + moving the units toggle into Pattern Settings

### What exists today
- `#unit-toggle` (top bar, `ruler` icon) currently flips `appState.units` between
  `'mm'`/`'in'` — `src/ui/editorView.js`'s `handleUnitToggle`.
- `#settings-dialog` (`index.html`) already holds Bead type / Stitch type /
  Rows / Cols / Resize / Crop to Design — the established place for "per-design
  setup, not worth permanent top-bar space" controls (iPad UX pass, per
  CLAUDE.md's Phase Status).
- The canvas is a single `<canvas id="pattern-canvas">` sized via
  `resizeCanvasForDisplay` (`canvas.clientWidth/clientHeight`), drawn every frame
  by `render()` in `editorView.js` using `appState.viewport` (`{originXmm,
  originYmm, scalePxPerMm}`) and `src/render/viewport.js`'s `worldToScreen`.

### Design
- **Repurpose `#unit-toggle` into the ruler on/off toggle.** Rename the element
  id to `#ruler-toggle` (keeps the `ruler` icon — it now literally means what the
  icon shows), `title="Toggle Ruler"`, `aria-pressed` reflecting on/off. New
  `appState.showRuler` (session field, preference-backed like
  `showBeadOutlines`) and a new `preferences.showRuler` default. **Recommended
  default: `false`** — it's added screen real estate a new feature shouldn't
  impose on top of an already fairly full top bar/canvas until the user opts in;
  easy to flip if you'd rather it default on.
- **Move mm/in switching into `#settings-dialog`.** A new labeled toggle button
  (`#settings-unit-toggle`, same button-based flip `handleUnitToggle` already
  does — no need for a `<select>`) added to `#settings-dialog-body`, styled like
  the existing Bead type/Stitch type rows. `handleUnitToggle`'s logic is
  unchanged, just re-wired to the new element and no longer touches the ruler.
- **New `src/render/rulerRenderer.js`** (pure-ish, canvas-drawing — same
  precedent as `canvasRenderer.js`/`selectionOverlay.js` having no `node:test`
  coverage for the drawing itself, but the tick-interval math below is pure and
  gets real coverage):
  - `chooseNiceTickIntervalMm(scalePxPerMm, unit)` — pure function, no DOM.
    Picks a "nice" tick spacing (1/2/5/10/25/50/100mm, or a matching set of
    inch-friendly fractions when `unit === 'in'`: 1/16, 1/8, 1/4, 1/2, 1, 2, 5,
    10in) such that ticks land at least ~40 CSS px apart on screen at the
    current zoom — the standard "nice numbers" ruler algorithm (compute the raw
    interval needed for 40px spacing, then snap up to the next value in a fixed
    table). This is the one piece of genuinely testable logic in this feature —
    covered by `node:test` across a spread of zoom levels for both units.
  - `drawRulerTop(ctx, cssWidth, cssHeight, viewport, units)` /
    `drawRulerLeft(ctx, cssWidth, cssHeight, viewport, units)` — for each tick
    position (computed in mm via the chosen interval, converted to screen px via
    `worldToScreen`), draws a tick line + a text label (using
    `src/units/convert.js`'s `formatLength`-style conversion, but unit-suffix-free
    since the ruler's own edge already implies the unit — just the number).
    **0 is anchored at the pattern's own top-left corner** (world mm `(0,0)`),
    per the request — not at the viewport's origin, so panning/zooming slides
    the ruler exactly the way the beads slide, and the number under a given bead
    column always reads that column's true distance from the pattern's own edge.
- **Layout**: `#editor-body`'s `#pattern-canvas` gets wrapped in a new
  `#canvas-area` (CSS grid: a corner cell + top ruler row + left ruler column +
  the canvas cell — spreadsheet-style), with two new sibling
  `<canvas id="ruler-top">`/`<canvas id="ruler-left">` and a small
  `<div id="ruler-corner">`. `showRuler === false` collapses the ruler
  row/column's grid track to `0` (a CSS class toggle on `#canvas-area`, not
  removing the elements) so the canvas silently reclaims the space — no
  `resizeCanvasForDisplay` special-casing needed since `#pattern-canvas`'s own
  `clientWidth/clientHeight` already reflect whatever the grid track leaves it.
  Each ruler `<canvas>` gets its own `resizeCanvasForDisplay`-style DPR handling
  (reuse the existing function — it's already generic over any canvas/ctx).
- **Redraw hook**: `editorView.js`'s existing `render()` (already the single
  place `appState.viewport`/`gridParams` changes get drawn) gains two more calls
  — `drawRulerTop(...)`/`drawRulerLeft(...)` — right after the main grid draw,
  gated on `appState.showRuler`. No new redraw scheduling needed; rulers piggyback
  on the existing `scheduleRedraw()`/rAF loop.
- **Known caveat, flagged directly**: ruler tick spacing is computed from
  `viewport.scalePxPerMm` against the CSS-pixel grid, which assumes the browser's
  CSS pixel matches its own spec definition (96px = 1 inch) — real screens vary,
  so the ruler (like "actual size" in section 3) is accurate relative to the
  *pattern's own bead dimensions*, not guaranteed to be a physically exact ruler
  against a tape measure on every device.

### Files touched
`index.html` (rename `#unit-toggle`→`#ruler-toggle`, new `#settings-unit-toggle`
in the settings dialog, new `#canvas-area`/`#ruler-top`/`#ruler-left`/
`#ruler-corner` markup), `style.css` (grid layout + ruler-hidden collapse +
ruler canvas styling), `src/render/rulerRenderer.js` (new),
`src/storage/preferencesStore.js` (`showRuler: false` default),
`src/state/appState.js` (`showRuler` field), `src/ui/editorView.js`
(`handleRulerToggle`, relocate unit-toggle wiring, `render()` calls into the new
renderer).

### Verification
- `node:test`: `chooseNiceTickIntervalMm` across a spread of `scalePxPerMm`
  values and both units — confirms picked intervals produce on-screen tick
  spacing within a sane band (not so dense labels overlap, not so sparse the
  ruler is useless), and that switching units doesn't change which *world*
  position ticks are computed against, only their spacing/labels.
- Playwright: ruler hidden by default; toggling `#ruler-toggle` shows it and the
  canvas visibly narrows/shortens (bounding-rect check, same technique used for
  the Phase 8 panel-toggle); a tick's on-screen X position matches
  `worldToScreen` computed independently in the driver script for a known mm
  value; panning/zooming the canvas moves the ruler's 0-tick correspondingly;
  switching mm↔in via the *new* settings-dialog control updates the ruler's
  labels; confirm the old `#unit-toggle` id is gone and nothing else references
  it (grep after the fact, same convention prior sessions used).
- Real iPad pass flagged as usual — ruler legibility/tick density at actual
  touch-zoom levels is a "look at it on the real device" concern more than a
  computable one.

---

## 2. Rotation (selection and whole canvas)

### The core geometric fact this whole feature rests on
Peyote's offset-row stagger (`isRaised` in `src/grid/peyote.js`) is **cosmetic
only** — the file's own comment states this directly: *"it has no effect on
which cell holds which color, only on the on-screen zigzag silhouette."* That
means a 90°/180°/270° rotation of a peyote (or square-stitch) pattern's cell
*data* is a pure row/col index transform, identical in kind to the
transpose/flip `mirrorTool.js`/`resizeGrid.js` already do — it does not need to
solve any "is this physically stitchable in the new orientation" problem, because
per this app's own model, stagger placement never encodes anything about which
cell holds which color. After a rotation, `staggerFlipped` is simply reset to a
sensible default (`false`) — there is nothing to preserve or compensate for the
way `resizeGrid.js`'s `compensatedStaggerFlipped` has to for a *shift* (a
rotation isn't a shift; it's a wholesale new set of coordinates, so there's no
prior stagger registration to keep continuous with).

**Real, unavoidable consequence, worth stating plainly**: because
`beadWidthMm ≠ beadHeightMm` for basically every real bead, a 90°/270° rotation
changes the pattern's physical mm dimensions (what was `cols × beadHeightMm`
wide becomes `oldRows × beadHeightMm` wide, using the *same* bead-height
constant against a different count) — the rotated design will look
stretched/squished differently proportioned than a naive "rotate the picture"
mental model suggests. This is inherent to modeling a real anisotropic bead as a
grid unit, not a bug to fix. 180° has no such issue (dimensions are unchanged).

### New pure module: `src/state/rotateGrid.js`
Mirrors `resizeGrid.js`'s shape and spirit — no stitch-type awareness needed at
all (rotation is pure index math, independent of peyote vs. square geometry):

```js
// direction: 'cw' | 'ccw' | '180'
export function rotatedDimensions(rows, cols, direction) {
  return direction === '180' ? { rows, cols } : { rows: cols, cols: rows };
}

function rotatedCoord(row, col, rows, cols, direction) {
  if (direction === 'cw')  return { row: col, col: rows - 1 - row };
  if (direction === 'ccw') return { row: cols - 1 - col, col: row };
  return { row: rows - 1 - row, col: cols - 1 - col }; // '180'
}

export function rotateKeyList(keys, rows, cols, direction) { /* same remap shape as resizeKeyList */ }
export function rotateColorEntries(colorEntries, rows, cols, direction) { /* same shape as resizeColorEntries */ }
export function rotateCells(cells, rows, cols, direction) { /* same shape as resizeCells, for the clipboard-rotation path below */ }
```

Round-trip identities to lock down with `node:test` (these are the cheap,
high-value correctness checks for this whole feature): rotating `cw` four times
returns to the original; `ccw` four times returns to the original; `180` twice
returns to the original; `cw` then `ccw` cancels; a known 2×3 fixture's specific
cell lands at the hand-derived new coordinate for each of the three directions.

### Whole-canvas rotation
Reuses the **exact same undo/redo machinery `applyResize`/`applyCrop` already
established** (`captureGeometrySnapshot`/`commitGeometrySnapshot`/
`pushGeometryChange` in `editorView.js`/`historyStore.js`) — a rotation is a
geometry change of the same *kind* as a resize/crop (rows, cols, staggerFlipped,
every colorway's colors all move together), so it slots into that pattern with
no new undo infrastructure:

```js
function applyRotate(direction) {
  const before = captureGeometrySnapshot();
  const { rows: newRows, cols: newCols } = rotatedDimensions(appState.rows, appState.cols, direction);
  const newCells = rotateCells(appState.cells, appState.rows, appState.cols, direction);
  const newColorways = appState.colorways.map((cw) => ({
    ...cw,
    colorEntries: rotateColorEntries(cw.colorEntries, appState.rows, appState.cols, direction),
  }));
  const after = {
    rows: newRows, cols: newCols,
    staggerFlipped: false, // cosmetic-only reset — see above, nothing to compensate
    cellEntries: [...newCells.entries()],
    colorways: newColorways.map((cw) => ({ ...cw, colorEntries: [...cw.colorEntries] })),
  };
  commitGeometrySnapshot(after);
  pushGeometryChange(appState.history, before, after, commitGeometrySnapshot);
  updateHistoryButtons();
}
```

No confirm dialog (like Crop, unlike Resize-that-loses-beads) — rotation never
drops a cell, it only relocates every one of them. `commitGeometrySnapshot`
already clears `selection`/`pastePreview` and fires `hooks.onImmediateSave()`
(see section 4 below for why this correctly bumps the modified date).

**UI**: three new buttons in the top bar (near `#reset-view`, or inside
`#settings-dialog` next to Resize — **recommended: top bar**, since rotation is
a one-tap action a user reaches for mid-session, not per-design setup the way
Resize/Bead-type are): "Rotate 90° CW", "Rotate 90° CCW", "Rotate 180°". Icons:
Lucide `rotate-cw` / `rotate-ccw` / a repeated `rotate-cw` pair or a dedicated
180 glyph — pick at implementation time, matching this project's existing
vendor-icon-fetch convention.

### Selection rotation — the one real design fork
A rectangular selection's bounding box is `W×H`. Rotating it 180° keeps `W×H` —
same non-issue as whole-canvas 180°, so **Mirror-style in-place rotation is
straightforward for 180°** (read the whole selection, write back the
180°-rotated content into the *same* footprint, exactly like `applyMirror`).

90°/270° is the fork: the rotated content is `H×W`, which does not fit back into
a `W×H` footprint unless `W === H`. Three ways to handle this were considered:

| Option | How it behaves | Tradeoff |
|---|---|---|
| **A — restrict 90°/270° to square selections** (like Mirror Vertical's even-height restriction) | Buttons disabled unless `W === H`; 180° always available | Simple, but blocks the common case (a non-square motif) entirely for 90°/270° |
| **B — copy → rotate → paste-preview** (recommended) | Rotating a selection performs an implicit Copy, rotates the clipboard's data via `rotateCells`, and enters the *existing* paste-preview flow (drag-to-position ghost, Front/Behind, Confirm/Cancel) — the user places the now-`H×W` rotated content wherever they want, the same way a Paste already works | Reuses nearly all of Phase 7's paste infrastructure with zero new collision-handling code; one extra click (Confirm) vs. instant, but avoids ever silently overwriting content the selection's own footprint didn't contain |
| **C — auto-place with collision handling** | Rotate in place, growing/shrinking the footprint from a fixed anchor, overwriting whatever's there | New collision semantics no existing tool has; most surprising of the three |

**Recommendation: Option B for 90°/270°, in-place Mirror-style for 180°.** This
keeps "same rotation logic" (the underlying `rotateCells` math is identical
across all three angles and both scopes, per the confirmed decision) while
routing the *placement* of a shape-changing rotation through the one mechanism
this app already has for "here's some content, tell me where it goes" — no new
UI paradigm, no new collision rules to design/test. Concretely: `handleSelectionRotate90(direction)` calls
`buildClipboard(appState.cells, appState.selection)`, then
`rotateCells`-equivalent-for-clipboards (new `rotateClipboard(clipboard,
direction)` in `src/tools/cutCopyTool.js`, same relative-coordinate remap logic
as `rotateGrid.js` but over a clipboard's `{rows, cols, cells}` shape rather than
a full design), assigns the result to `appState.clipboard`, and calls the
*existing* `handlePasteButtonClick()`-equivalent to enter paste-preview mode —
the original selected beads are **not** erased automatically (matching how Copy
never erases); a user who wants the rotated copy to *replace* the original
selects Cut first, or erases manually afterward. If this reads as one click too
many in practice, tightening it (e.g. an explicit "Rotate & Cut" variant) is a
cheap follow-up once it's been used for real.

**UI**: two new buttons in `#selection-controls` next to the existing Mirror
H/V pair — "Rotate 180°" (enabled whenever a selection exists, in-place,
immediate) and "Rotate 90°" (a single button that starts the copy→rotate→paste
flow; CW vs. CCW distinction can be a second click inside the paste-preview
controls, or two separate buttons — **flagged as a small open UI call, low
stakes, pick at implementation time**).

### Files touched
`src/state/rotateGrid.js` (new), `src/tools/cutCopyTool.js` (add
`rotateClipboard`), `src/ui/editorView.js` (`applyRotate` for whole-canvas,
`handleSelectionRotate180`/`handleSelectionRotate90` wiring into the existing
paste-preview machinery), `index.html` (new top-bar rotate buttons, new
selection-controls rotate buttons), `style.css` (icon-button styling, reusing
existing `.icon-btn`/`.icon-btn-lg` classes — no new CSS system needed),
`src/ui/icons.js` + `/vendor/icons/` (new rotate icon(s), same fetch-and-license
convention as every prior icon batch).

### Verification
- `node:test`: `rotateGrid.js`'s round-trip identities above, a hand-derived
  small-fixture check per direction, `rotateColorEntries`/`rotateKeyList`
  mirroring `resizeGrid.test.js`'s existing coverage shape; `rotateClipboard`'s
  equivalent cases against a clipboard fixture.
- Playwright: draw an asymmetric marker pattern (e.g. an L-shape with 3 distinct
  colors so orientation is unambiguous from a screenshot/pixel-sample alone),
  rotate the whole canvas 90° CW, confirm the new rows/cols and every marked
  cell's new position matches the hand-derived expected coordinates via pixel
  sampling (not just trusting the same math that produced the code); confirm
  four CW rotations return pixel-identical to the original; confirm Undo/Redo
  correctly step through a rotation on the same history stack as an interleaved
  draw (same style of check the Crop-to-Design session used); selection
  rotation: 180° in place on an odd-selection, confirmed swapped; 90° opens a
  paste-preview ghost with the correct `H×W` dimensions and rotated content,
  draggable, and Confirm stamps it while leaving the original selection's
  content untouched (Copy semantics, not Cut).
- Real iPad pass flagged as usual for the new buttons' touch targets and the
  copy→rotate→paste flow's on-device feel.

---

## 3. Reset View toggle: Fit vs. Actual Size

### Design
- New `appState.viewMode` (session-only, like `appState.tool` — **not**
  persisted per design; every design open starts in `'fit'`, matching current
  behavior exactly). `'fit' | 'actual'`.
- `editorView.js`'s `handleResetView()` (currently always calls
  `fitViewportToGrid()`) becomes a toggle:
  ```js
  function handleResetView() {
    appState.viewMode = appState.viewMode === 'fit' ? 'actual' : 'fit';
    if (appState.viewMode === 'fit') fitViewportToGrid();
    else setViewportToActualSize();
    resetViewButton.setAttribute('aria-pressed', String(appState.viewMode === 'actual'));
    scheduleRedraw();
  }
  ```
- New `setViewportToActualSize()`, same centering logic `fitViewportToGrid()`
  already uses but with a **fixed** scale instead of a fit-computed one:
  ```js
  const CSS_PX_PER_MM = 96 / 25.4; // CSS spec's fixed 96px/inch reference pixel
  function setViewportToActualSize() {
    const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
    const paddingXmm = (lastCssSize.cssWidth / CSS_PX_PER_MM - widthMm) / 2;
    const paddingYmm = (lastCssSize.cssHeight / CSS_PX_PER_MM - heightMm) / 2;
    Object.assign(appState.viewport, { scalePxPerMm: CSS_PX_PER_MM, originXmm: -paddingXmm, originYmm: -paddingYmm });
  }
  ```
  If the pattern is larger than the viewport at actual size, the existing
  pan/pinch interaction already lets the user scroll around it — no new
  interaction needed.
- **Caveat, same as the ruler's — and exactly why calibration matters**:
  "actual size" is only as physically accurate as the browser's own 96px/inch
  CSS assumption vs. the real screen's DPI — standard web-app practice (this is
  genuinely the only way to do it without a native API for physical screen
  size, which browsers don't expose), but it won't be laser-precise on every
  display out of the box. The calibration feature below exists specifically to
  correct for that gap, once, per device.
- Icon/label: keep `#reset-view`'s current `crosshair` icon and `aria-pressed`
  it like the other toggle buttons (`#outline-toggle`, `#panel-toggle`), or swap
  the icon based on state (crosshair for "currently fit, tap for actual" vs. a
  "1:1"-style glyph for "currently actual, tap to fit") — **recommended: swap
  the icon/title text to reflect the *next* state the click will produce**,
  matching how a play/pause button works, rather than reflecting current state
  via `aria-pressed` alone (a plain toggle here is less discoverable than an
  icon that visibly says what tapping it does next).

### Calibration (user-requested addition)
The 96px/inch assumption above is a starting point, not a guarantee — actual
CSS-pixel density varies by device/browser/OS zoom setting. Rather than trust
it blindly, add a one-time (or redo-whenever-you-want) calibration step: hold a
real, already-stitched piece up against the screen while in Actual Size mode,
nudge a live adjustment until the on-screen pattern visually matches the real
beadwork's spacing, and save that correction as a **global multiplier** applied
to every design's Actual Size view from then on (not just the one currently
open) — matching CLAUDE.md pain point #1's "preferences persist globally, not
per-file" principle directly.

- **New global preference**: `preferences.actualSizeCalibration` (a plain
  number, default `1` — meaning "trust the raw 96px/inch assumption
  completely"). Lives in `preferencesStore.js`'s `DEFAULT_PREFERENCES` next to
  `units`/`showBeadOutlines`, persisted via the existing
  `onPreferencesChanged`/`savePreferences` path — no new storage plumbing
  needed at all, this is the same mechanism every other global toggle already
  uses.
- **`setViewportToActualSize(factorOverride)`** takes an optional override (used
  only while live-calibrating, see below); normally reads
  `appState.preferences.actualSizeCalibration ?? 1` and multiplies it into the
  scale:
  ```js
  function setViewportToActualSize(factorOverride) {
    const factor = factorOverride ?? appState.preferences.actualSizeCalibration ?? 1;
    const scale = CSS_PX_PER_MM * factor;
    const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
    const paddingXmm = (lastCssSize.cssWidth / scale - widthMm) / 2;
    const paddingYmm = (lastCssSize.cssHeight / scale - heightMm) / 2;
    Object.assign(appState.viewport, { scalePxPerMm: scale, originXmm: -paddingXmm, originYmm: -paddingYmm });
  }
  ```
- **Calibration UI**: a new `#calibrate-actual-size` button, visible/enabled
  only while `appState.viewMode === 'actual'` (calibrating only makes sense
  against a live actual-size reference) — placed next to `#reset-view` in the
  top bar. Clicking it reveals a small contextual control group (same
  show/hide-by-state convention as `#selection-controls`/`#paste-controls`),
  **not a modal `<dialog>`** — a dialog's `::backdrop` would dim the very canvas
  the user is trying to visually compare against their real beadwork, which
  defeats the point:
  - A synced range slider + number input (mirroring `#photo-trace-opacity`'s
    existing slider-with-label pattern), labeled as a percentage — e.g. "100%",
    range roughly 50%–200%, fine-grained step (~0.5%) — live-adjusts a working
    `calibrationFactor` and calls `setViewportToActualSize(calibrationFactor)`
    on every `input` event, so the canvas visibly resizes in real time as the
    user drags it against their held-up beadwork.
  - **Save** — `hooks.onPreferencesChanged({ actualSizeCalibration:
    calibrationFactor })`, exits calibration mode. Applies immediately and
    globally: the next time *any* design (this one or another) enters Actual
    Size mode, it uses the new factor.
  - **Reset to Default** — sets the working factor back to `1` and re-renders
    live (lets the user compare against the uncalibrated assumption without
    losing their in-progress adjustment unless they choose to), separate from
    Save so resetting doesn't have to be immediately committed.
  - **Cancel** — exits calibration mode and calls
    `setViewportToActualSize()` with no override, reverting the live view to
    whatever's actually saved (discards the in-progress slider position).
- Entering calibration mode does **not** touch `preferences` until Save is
  explicitly clicked — dragging the slider only mutates `appState.viewport`
  for live visual feedback, exactly like panning/zooming already does.

### Files touched
`src/storage/preferencesStore.js` (`actualSizeCalibration: 1` default),
`src/state/appState.js` (`viewMode: 'fit'` field — calibration itself doesn't
need its own appState field beyond a local closure variable in `editorView.js`,
same as `manageMode`/`colorDrag` today), `src/ui/editorView.js`
(`handleResetView` rewrite, `setViewportToActualSize` with the calibration
multiplier, new calibration-mode handlers, icon/title swap logic), `index.html`
(new `#calibrate-actual-size` button + `#actual-size-calibration-controls`
group with its slider/number input/Save/Reset/Cancel), `style.css` (styling for
the new control group, reusing existing patterns).

### Verification
- No new pure logic beyond arithmetic already covered by `fitViewportToGrid`'s
  own existing shape — `node:test` coverage isn't a strong fit here (DOM/
  canvas-dependent, same precedent as `fitViewportToGrid` itself having none).
- Playwright: toggling Reset View flips `appState.viewMode`/`aria-pressed`/icon;
  at actual size with no calibration saved, `viewport.scalePxPerMm` equals
  `96/25.4` exactly; a bead's on-screen pixel footprint at actual size matches
  `beadWidthMm/heightMm * 96/25.4` (computed independently in the driver
  script); toggling back to fit restores the exact prior fit-scale/centering;
  opening a *different* design resets to `'fit'` regardless of what the
  previous design was left at. For calibration specifically: dragging the
  slider changes `viewport.scalePxPerMm` live without writing to
  `preferences`/IndexedDB; Cancel reverts the live view and leaves
  `preferences.actualSizeCalibration` untouched; Save persists the new factor
  and a **second, different design** opened afterward and switched to Actual
  Size also reflects the new factor (proving it's genuinely global, not
  per-design); Reset to Default live-previews `1` without saving until Save is
  clicked; a reload confirms the saved factor survives and is applied
  automatically the next time Actual Size is entered, with no need to
  recalibrate.

---

## 4. Modified-date fix (only real content edits bump `updatedAt`; reordering never does)

### Root cause, confirmed by reading the actual code
- `src/storage/designStore.js`'s `saveDesign(db, design)` **unconditionally**
  sets `updatedAt: Date.now()` on every call.
- `main.js`'s `backToLibrary()` calls `persistCurrentDesign()` (which calls
  `saveDesign`) **every time a design is closed, regardless of whether anything
  was actually edited** — this is exactly bug report #1 ("changes any time the
  pattern has been opened, even if no changes were made").
- `main.js`'s `handleReorder()` calls `saveDesign(db, { ...design, order:
  newOrder })` to persist a library drag-reorder — which, via the same
  unconditional bump, also touches `updatedAt` — exactly bug report #2.

### Design: an explicit `designDirty` flag, set only at genuine content-mutation
call sites already identified by reading `editorView.js`'s full hook call graph
(not inferred — every call site below was checked directly):

- `saveDesign(db, design, { bumpUpdatedAt = true } = {})` — new optional third
  param. `bumpUpdatedAt: false` preserves `design.updatedAt` verbatim instead of
  stamping `Date.now()`.
- `appState.designDirty = false`, reset in `openDesign()` (a freshly opened
  design starts clean) and after every successful save in
  `persistCurrentDesign()`.
- `persistCurrentDesign()` passes `{ bumpUpdatedAt: appState.designDirty }` to
  `saveDesign` — so a `backToLibrary()`/debounce-flush call that fires with
  nothing actually changed writes the record (harmless — same decompose/
  thumbnail/colorway-fold bookkeeping as always, kept simple by not special-
  casing "skip the write entirely") but leaves `updatedAt` untouched.
- **New hook, `hooks.onDesignContentChanged()`** — a synchronous marker,
  implemented in `main.js` as `() => { appState.designDirty = true; }`. Called
  explicitly, inline, at exactly these `editorView.js` sites (every one
  double-checked against the current file, not assumed):
  - `regenerateGrid()` (bead-type/rows/cols regenerate, and the empty-design
    direct stitch-type switch in `handleStitchTypeChange`)
  - `commitGeometrySnapshot()` — covers `applyResize`/`applyCrop`'s own apply
    **and** undo/redo replaying either one (it's the one shared function both
    paths already funnel through), and will cover the new `applyRotate()` from
    section 2 above for free
  - `handleClear()`
  - `handleColorwayRename()`, `handleColorwayDelete()`, and inside
    `handleColorwayNew()` (right after the new colorway is pushed onto
    `appState.colorways`, before it calls `switchColorway()`)
  - `main.js`'s own `onCellsChanged` hook implementation gets simplified to
    `() => { appState.designDirty = true; debouncedSave(); }` directly — every
    existing caller of `hooks.onCellsChanged()` (draw/erase/fill/replace/paste
    stroke commits, undo/redo of a cell patch, cut, mirror) is *already*
    unconditionally a real content edit, confirmed by reading every call site,
    so no per-call-site marking is needed on that side at all.
- **Deliberately NOT marked dirty**: `switchColorway()`'s own body (it's called
  both from a plain colorway-dropdown switch — no content changed, just which
  colorway is active — and from `handleColorwayNew()`, which by the point it
  calls `switchColorway()` has *already* set the flag itself). This is the one
  place the fix requires care: `switchColorway()` keeps calling
  `hooks.onImmediateSave()` exactly as it does today (so `activeColorwayId` and
  the folded-back colors of whichever colorway is being left still get
  persisted correctly), it just no longer implies "this bumps the modified
  date" by itself.
- `main.js`'s `handleReorder()`: pass `{ bumpUpdatedAt: false }` explicitly —
  this alone fixes bug report #2.
- `main.js`'s `handleRename()`: **left bumping `updatedAt` (unchanged,
  default `true`)** — a deliberate assumption, not explicitly requested by
  either bug report. Renaming is a direct, intentional edit action the user
  chose to take, distinct from passively reordering or reopening — but it's
  genuinely a judgment call since the two bug reports only mention beads/
  resize/colors. **Flagged here for you to confirm or override before/while
  implementing** — trivial to flip (`{ bumpUpdatedAt: false }`) if you'd rather
  renaming not count either.

### Files touched
`src/storage/designStore.js` (`saveDesign`'s new param), `main.js`
(`persistCurrentDesign`'s conditional bump + flag reset, new
`onDesignContentChanged` hook implementation, `onCellsChanged` inlined flag set,
`handleReorder`'s `bumpUpdatedAt: false`), `src/state/appState.js`
(`designDirty: false` field), `src/ui/editorView.js` (the explicit
`hooks.onDesignContentChanged()` calls at the sites listed above — six call
sites, each a one-line addition next to an existing `hooks.onImmediateSave()`
call).

### Verification
- `node:test`: `designStore.js` has no existing coverage (no IndexedDB in Node,
  same precedent as every other storage module) — `saveDesign`'s new parameter
  is simple enough to trust from the Playwright pass below plus a direct code
  read, consistent with how this module has always been verified.
- Playwright (this is the load-bearing verification for this whole fix):
  1. Open a design, wait past the autosave debounce, note `updatedAt`; go back
     to the library with **zero edits** made; reopen the record from
     IndexedDB directly — `updatedAt` is unchanged. (The literal bug report.)
  2. Draw a bead, go back to the library; `updatedAt` **did** advance.
  3. Resize/crop/regenerate/rotate (once section 2 exists) with no other
     edits; `updatedAt` advances.
  4. From the library, drag-reorder two designs with no design ever opened in
     between; both designs' `updatedAt` are unchanged, only their `order`
     fields differ. (The second literal bug report.)
  5. Open a design, switch to a second colorway and back with no drawing;
     `updatedAt` unchanged (confirms the `switchColorway` non-bump case
     specifically, the trickiest part of this fix to get right).
  6. Open a design, create a new colorway (a real content change bundled with
     a colorway-switch); `updatedAt` **did** advance.
  7. Undo a resize back to the pre-resize state, close with no further edits;
     `updatedAt` advanced (undo/redo of a geometry change is itself a change
     relative to what's on disk).
  8. Pan/zoom and toggle units/outlines/ruler with no bead edits; `updatedAt`
     unchanged (confirms view-state/display-preference changes never touch it
     — matches "not view changes... not unit display" from the report
     directly).

---

## Suggested build order

These four are independent — pick any order. If doing them in one pass, this
order minimizes rework:

1. **Modified-date fix (§4)** — smallest, most surgical, no UI at all, and the
   `hooks.onDesignContentChanged()` call added to `commitGeometrySnapshot()`
   here is exactly what whole-canvas rotation (§2) will rely on for free later.
2. **Actual-size view toggle (§3)** — small, self-contained, no dependency on
   the others.
3. **Ruler (§1)** — larger (new layout, new renderer), but no dependency on
   rotation.
4. **Rotation (§2)** — largest and most architecturally involved (new pure
   module, reuses the geometry-snapshot undo pattern, and has the one real
   product-design fork around 90°/270° selection rotation) — do this last so
   any layout/plumbing lessons from §1/§3 are already settled.
