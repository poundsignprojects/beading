# Phase 2 Implementation Plan — Draw + Erase

## Context

Phase 1 shipped a peyote grid engine: pure grid math (`peyote.js`), mm↔px viewport transforms (`viewport.js`), a culled canvas renderer (`canvasRenderer.js`), and two-finger pan/pinch-zoom + mouse-drag-pan/wheel-zoom (`panZoom.js`), with single-finger touch and Apple Pencil deliberately left inert, reserved for this phase. No cell data exists yet — the grid only renders outlines.

Per CLAUDE.md's phase plan, Phase 2 is: "Tap placement, drag-to-draw (Decision #9), erase, Delica/Rocaille color palettes wired in." No save/library yet (Phase 3) — this plan's test harness keeps pattern data in memory only, lost on reload, same as Phase 1.

This document is the concrete plan for that work. No Phase 2 code is written yet.

## Decisions confirmed for this plan

- **Cells store a `colorId`, not a raw hex value.** A cell is `{ colorId }` referencing an entry in the active bead type's color library. Phase 5 colorways are "same grid, different color-to-cell mapping" (Decision #8) — if cells stored raw hex today, colorways would need to rewrite every cell's value; storing an id means a colorway later just swaps which id→hex table is active. Cheap to do now, painful to retrofit.
- **Regenerating the grid (Generate button, bead-type change, rows/cols change) clears all cells.** Changing bead type or dimensions changes the grid geometry underneath existing cell coordinates, so preserving partial data across a geometry change is a real feature (partial pattern migration) that's out of scope here. If any cells are set, a `confirm()` guards against accidental loss — cheap, and consistent with the project's core motivation (the prior app pain point #4: never lose state silently).
- **Pointer routing is centralized, not split across two listener sets.** Phase 1's `panZoom.js` already owns the canvas's pointer events and tracks every active pointer in one `Map`. Rather than attach a second, independent listener set for draw/erase (which would race with panZoom's pointer bookkeeping on the same events), this phase expands that single router to dispatch by pointer count/type: two touch/pen pointers → pan/zoom (unchanged math), exactly one touch/pen pointer → draw/erase, mouse → draw/erase on left-drag by default. Tool *logic* (what a tool does to cell data) stays in its own pure file per CLAUDE.md's `/tools` convention; only *routing* (which gesture is this) is centralized. `panZoom.js` is renamed `pointerRouter.js` to reflect the expanded scope.
- **Mouse interaction changes now that single-pointer input means "draw."** Left-drag now drives the active tool (mirrors single-finger touch) instead of panning. Trackpad/mouse panning moves to: plain `wheel` (no `ctrlKey`) = pan using `deltaX`/`deltaY` directly (standard two-finger-scroll-to-pan convention, e.g. Figma), `wheel` with `ctrlKey: true` = zoom-to-cursor (unchanged, just gated so it no longer fires on every scroll). For a bare USB mouse with no trackpad gesture, holding **Space** while left-dragging pans — a dev-only fallback; irrelevant on iPad.
- **A single in-progress draw/erase stroke is cancelled if a second touch pointer lands.** If the user is mid-stroke and puts a second finger down (intending to pan/zoom instead), the router stops applying the tool and hands off to pan/zoom cleanly rather than placing a bead under the second finger.
- **Color data is a placeholder palette, not a verified Miyuki catalog.** I don't have real Miyuki DB/RR color numbers loaded (e.g. actual "DB010" hex values) — building the palette *mechanism* doesn't require them, but you'll want your actual bead colors eventually. See "Open question" below before we implement.

## File-by-file breakdown

```
/src
  /palette
    beadSpecs.js            — unchanged
    colorLibrary.js          — NEW: placeholder color swatches per bead type key,
                               COLOR_LIBRARIES.delica11 / .rocaille11 = [{ id, name, hex }, ...],
                               structured so swapping in real Miyuki color numbers later
                               touches no other code (same pattern as beadSpecs.js's
                               provisional-constant approach)

  /grid
    peyote.js                — ADD: peyoteCellAtPoint(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) —
                               inverse of peyoteCellOriginMm; returns { row, col } or null if outside
                               grid bounds

  /state
    cellStore.js             — NEW: pure functions over a cells Map<string, { colorId }>:
                               cellKey(row, col), setCell(cells, row, col, colorId),
                               clearCell(cells, row, col), getCell(cells, row, col)

  /tools
    drawTool.js               — NEW: applyDrawAtCell(cells, row, col, colorId) — pure, mutates the
                               given Map in place, returns whether it changed anything
    eraseTool.js              — NEW: applyEraseAtCell(cells, row, col) — same shape, clears instead

  /interaction
    pointerRouter.js          — RENAMED from panZoom.js: owns all canvas pointer/wheel listeners,
                               keeps existing pan/zoom math, adds single-pointer draw/erase dispatch
                               and Space-drag-pans-on-mouse fallback
    dragTrace.js              — NEW: interpolatedWorldPoints(fromWorld, toWorld, stepMm) — pure;
                               fills in intermediate world-mm points between two pointermove samples
                               so a fast drag doesn't skip cells (see "Draw/erase interaction" below)

  /render
    canvasRenderer.js         — MODIFY: drawPeyoteGrid gains a cells param + a resolveColor(colorId)
                               lookup fn; fills occupied cells with their resolved color before
                               stroking the (unchanged) outline

  /test                       — mirrors new pure-function modules
    grid/peyote.test.js        — ADD cases for peyoteCellAtPoint (incl. round-trip vs peyoteCellOriginMm)
    state/cellStore.test.js    — NEW
    tools/drawTool.test.js     — NEW
    tools/eraseTool.test.js    — NEW
    interaction/dragTrace.test.js — NEW

main.js                      — extend appState with tool, selectedColorId, cells; wire new UI controls
index.html                   — add tool toggle, color swatch strip, Clear button
style.css                    — swatch layout, selected-state styling
```

## Cell data model

```js
// appState.cells: Map<string, { colorId: string }>
// key = `${row},${col}` via cellStore.cellKey — string keys are simplest for a plain
// Map and avoid any row/col-encoding collision risk.

// src/state/cellStore.js
export function cellKey(row, col) { return `${row},${col}`; }
export function setCell(cells, row, col, colorId) { cells.set(cellKey(row, col), { colorId }); }
export function clearCell(cells, row, col) { cells.delete(cellKey(row, col)); }
export function getCell(cells, row, col) { return cells.get(cellKey(row, col)); }
```

Sparse by construction — an empty pattern costs nothing, and rendering only ever queries cells inside the already-culled visible row/col range (canvasRenderer already computes that range for outlines; the fill lookup rides along for free).

## Grid hit-testing

```js
// src/grid/peyote.js — new export, inverse of peyoteCellOriginMm
export function peyoteCellAtPoint(xMm, yMm, beadWidthMm, beadHeightMm, rows, cols) {
  const row = Math.floor(yMm / beadHeightMm);
  if (row < 0 || row >= rows) return null;
  const rowOffsetMm = (row % 2 === 1) ? beadWidthMm / 2 : 0;
  const col = Math.floor((xMm - rowOffsetMm) / beadWidthMm);
  if (col < 0 || col >= cols) return null;
  return { row, col };
}
```

Test as a round-trip against `peyoteCellOriginMm`: for every (row, col) in a sample grid, take the cell's origin, nudge it toward the cell's center, and confirm `peyoteCellAtPoint` returns the same (row, col) — this is the check that actually matters, more so than arbitrary point cases.

## Draw/erase tool logic

```js
// src/tools/drawTool.js
export function applyDrawAtCell(cells, row, col, colorId) {
  const existing = cells.get(`${row},${col}`);
  if (existing && existing.colorId === colorId) return false;
  setCell(cells, row, col, colorId);
  return true;
}

// src/tools/eraseTool.js
export function applyEraseAtCell(cells, row, col) {
  if (!cells.has(`${row},${col}`)) return false;
  clearCell(cells, row, col);
  return true;
}
```

Both return a boolean so the router only schedules a redraw when something actually changed (a drag that re-enters an already-painted cell is a no-op, not a wasted draw call).

## Draw/erase interaction (pointer routing)

Tap and drag-line (Decision #9) are handled by **one** code path, not two — a tap is just a drag that never moved:

- `pointerdown` (single touch/pen, or mouse-left without Space held): hit-test the point immediately via `peyoteCellAtPoint`, apply the active tool. This alone satisfies tap-to-place. Record the point as the stroke's "last world point."
- `pointermove` (same pointer, stroke active): rather than hit-testing only the raw move samples — which can skip over cells entirely during a fast drag, since `pointermove` frequency is capped and a bead can be a couple of screen pixels at low zoom — call `dragTrace.interpolatedWorldPoints(lastWorldPoint, currentWorldPoint, stepMm)` and hit-test + apply the tool at every interpolated point. `stepMm` = half the smaller of the current bead's width/height, so no cell along the path is skipped regardless of zoom level or drag speed.
- `pointerup`/`pointercancel`: end the stroke (clear "last world point" for that pointer).
- If a second touch/pen pointer lands while a single-pointer stroke is active: abort the stroke (per the decision above) and let the existing two-pointer pan/zoom path take over on the next move.

```js
// src/interaction/dragTrace.js
export function interpolatedWorldPoints(fromWorld, toWorld, stepMm) {
  const dx = toWorld.xMm - fromWorld.xMm;
  const dy = toWorld.yMm - fromWorld.yMm;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / stepMm));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({ xMm: fromWorld.xMm + dx * t, yMm: fromWorld.yMm + dy * t });
  }
  return points;
}
```

`pointerRouter.js` keeps its existing `pointers` Map and two-pointer pan/zoom math untouched; it adds a `drawStroke` variable (`{ pointerId, lastWorld }` or `null`) and the dispatch above. `Space` key state is tracked via two `window` keydown/keyup listeners toggling a boolean the mouse-drag branch checks.

## Rendering: filled cells

`drawPeyoteGrid` already computes the visible row/col range for outline culling. Extend it to look up each visible cell in `cells` and, if occupied, fill before stroking:

```js
const cell = cells.get(`${row},${col}`);
if (cell) {
  ctx.fillStyle = resolveColor(cell.colorId); // e.g. colorId -> hex from the active library
  ctx.fillRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
}
ctx.strokeRect(/* unchanged */);
```

`resolveColor` is passed in from `main.js` (a small `(colorId) => hex` closure over the current library) — `canvasRenderer.js` stays ignorant of what a "color library" is, it just resolves ids to paintable colors.

## Color palette + UI

`colorLibrary.js` exports one array of `{ id, name, hex }` per bead type key, mirroring `BEAD_TYPES`'s shape so `main.js` can look up `COLOR_LIBRARIES[appState.beadTypeKey]` the same way it already looks up `BEAD_TYPES[appState.beadTypeKey]`.

UI additions to `index.html`:
- `#tool-draw` / `#tool-erase` buttons (active one visually indicated) → `appState.tool`.
- `#color-palette` — a swatch button per library entry, rendered into the DOM whenever the bead type changes; selected swatch gets a visible ring; click sets `appState.selectedColorId`.
- `#clear-pattern` button — wipes `appState.cells` after a `confirm()` (same guard as regenerate). Not in the original ask, but a near-free testing affordance in the same spirit as Phase 1's "Reset View."

`style.css`: swatch strip as a `flex-wrap` row of small square buttons, `aria-pressed`/selected state via a border/box-shadow (no library, plain CSS).

## Build order + verification

1. **`colorLibrary.js`** (data only). *Verify*: log both libraries, confirm shape and that `delica11`/`rocaille11` keys match `BEAD_TYPES`.
2. **`cellStore.js`** + test file. *Verify*: `node --test` — set/get/clear round-trip, key collisions impossible for reasonable row/col ranges.
3. **`peyoteCellAtPoint`** + test additions. *Verify*: round-trip test against `peyoteCellOriginMm` passes for both even and odd rows (confirms the offset is inverted correctly, not just the non-offset case).
4. **`drawTool.js` / `eraseTool.js`** + test files. *Verify*: apply-when-empty, apply-when-already-set-to-same-color (no-op), apply-when-set-to-different-color, erase-when-empty (no-op).
5. **`canvasRenderer.js` fill support** — wire a hardcoded test `cells` Map + `resolveColor` in a scratch script first. *Verify visually*: a handful of manually-set cells render as filled colored cells with outlines still visible, under both bead types.
6. **`dragTrace.js`** + test file. *Verify*: interpolated point count scales with distance/stepMm, endpoints match input exactly (no drift at very small or very large distances).
7. **`pointerRouter.js`** rewrite: fold in draw/erase dispatch, Space-pan fallback, wheel ctrlKey gating, stroke-cancel-on-second-pointer. *Verify on Mac first*: left-drag paints a line of cells with no gaps at both low and high zoom, tapping (click, no drag) paints one cell, Space+left-drag pans, plain wheel pans, ctrl+wheel zooms.
8. **Wire `appState.tool` / `selectedColorId` / `cells` + new UI controls** in `main.js`. *Verify*: switching tool/color changes what subsequent strokes do; Clear button empties the pattern; regenerating or switching bead type clears cells (with confirm guard when non-empty).
9. **Touch + Apple Pencil on physical iPad**: single-finger/Pencil draws/erases, two-finger still pans/zooms, starting a second finger mid-stroke hands off to pan/zoom without leaving a stray bead. *Verify*: this is the gesture-disambiguation logic that Mac testing cannot fully substitute for — budget real iPad time here specifically, not just at the end.
10. **Edge cases**: draw stroke that exits and re-enters the grid bounds (interpolated points outside range should just no-op, not throw); rapid tool-switch mid-stroke; large grid (reuse Phase 1's 200×300 case) with a dense scribbled pattern — confirm redraw stays fast since fill lookups only touch the already-culled visible range.

## Open question before implementation

`colorLibrary.js` above is a **placeholder** swatch set (a handful of generic named colors), not real Miyuki Delica/Rocaille color numbers — I don't have your actual catalog data. Two ways to proceed, same as the bead-height gap in Phase 1:

- Build Phase 2 now against a small placeholder palette (~12–16 generic swatches), clearly marked provisional, structured so swapping in real Miyuki color numbers later is a data-only change.
- You provide (or point me to) the actual Delica/Rocaille color numbers and hex values you want available before I write `colorLibrary.js`, so the palette is correct from the start instead of provisional twice.

Recommendation: proceed with the placeholder now — the mechanism (palette UI, colorId-based cells, fill rendering) is identical either way, and provisional color data is a much cheaper thing to correct later than provisional grid math would have been.
