# Phase 1 Implementation Plan — Peyote Grid Engine

## Context

The repo currently contains only docs (CLAUDE.md, project-brief.md, README.md) — no code has been written yet. Phase 1, per CLAUDE.md's phase plan, is grid math + canvas rendering + pan/zoom for the peyote stitch type: "Grid math only: given bead width/height ratio, generate correct offset-row peyote layout, render on canvas, support pinch-zoom/pan. No drawing yet. mm-based internally, inches toggle for size readout built in from the start."

This document is the concrete implementation plan for that phase. No Phase 1 code is written yet — that begins in a later, separate step, following the build order below.

Decisions confirmed for this plan:
- Add a new `/src/interaction` folder for gesture *event handling*, separate from `/render/viewport.js`'s pure transform math (deviates slightly from CLAUDE.md's original sketch, which lumped pan/zoom into `/render`).
- Touch gesture convention: **two-finger** pan and pinch-zoom; single-finger touch and Apple Pencil stay inert in Phase 1, reserved for Phase 2's tap/drag draw tool.
- Add Node's built-in `node:test` + `node:assert` for the pure functions (grid math, unit conversion, viewport transforms) — zero dependencies, no bundler, consistent with the no-build-step constraint.
- Bead height dimensions remain the provisional estimates already in CLAUDE.md (Delica ~1.6×1.3mm, Rocaille ~2.0×1.4mm), stored as named constants, not blocking on caliper verification.

## File-by-file breakdown

```
index.html               — minimal test harness page (see UI section)
style.css                 — layout + touch-action/overscroll rules for gesture handling
main.js                   — app shell: central appState, wires UI controls to grid/render modules

/src
  /palette
    beadSpecs.js           — named constants: DELICA_11_0, ROCAILLE_11_0 { diameterMm, heightMm, holeMm },
                             each commented as verified vs provisional

  /units
    convert.js             — MM_PER_INCH, mmToInches(), inchesToMm(), formatLength(mm, unit) —
                             pure, display-layer only

  /grid
    peyote.js               — pure functions: peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm),
                             generatePeyoteGrid({ rows, cols, beadWidthMm, beadHeightMm })

  /render
    viewport.js             — viewport state shape { originXmm, originYmm, scalePxPerMm } and
                             worldToScreen()/screenToWorld() pure transform functions
    canvasRenderer.js       — takes a canvas 2D context + grid params + viewport, does the actual
                             draw calls (clear, cull to visible range, stroke cell outlines),
                             handles devicePixelRatio scaling

  /interaction
    panZoom.js              — pointer event handling (pointerdown/move/up/cancel), pinch-distance/
                             midpoint math, wheel fallback for Mac trackpad/mouse; translates raw
                             gesture events into viewport state updates

  /test                     — node:test files mirroring the pure-function modules above
    grid/peyote.test.js
    units/convert.test.js
    render/viewport.test.js
```

`main.js` also holds the central `appState` object (bead type, rows, cols, units, viewport) per CLAUDE.md's "one central app-state object" principle — small enough to stay inline for Phase 1; can be extracted to `/src/state` later if it grows once Phase 2 adds tool state.

## Peyote grid math

Grid described by `{ rows, cols, beadWidthMm, beadHeightMm }`. Deliberately does **not** pre-build a full `cells[]` array — `generatePeyoteGrid` returns parameters + bounding box only, and the renderer computes only visible cells on demand via `peyoteCellOriginMm`, so cost scales with visible cells, not total pattern size (important once patterns hit thousands of beads, per CLAUDE.md's rationale for canvas over DOM).

```js
// src/grid/peyote.js

// Rows are staggered by half a bead-width from their neighbors — that stagger is peyote's
// defining structural feature. Row-to-row vertical spacing uses bead *height* (the thread-axis
// dimension), not width/diameter, since that's what governs how tightly rows pack.
export function peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm) {
  const rowOffsetMm = (row % 2 === 1) ? beadWidthMm / 2 : 0;
  return {
    xMm: col * beadWidthMm + rowOffsetMm,
    yMm: row * beadHeightMm,
  };
}

export function generatePeyoteGrid({ rows, cols, beadWidthMm, beadHeightMm }) {
  const widthMm = cols * beadWidthMm + beadWidthMm / 2; // offset rows overhang by half a bead
  const heightMm = rows * beadHeightMm;
  return { rows, cols, beadWidthMm, beadHeightMm, boundingBoxMm: { widthMm, heightMm } };
}
```

`beadWidthMm`/`beadHeightMm` come from `/palette/beadSpecs.js` based on selected bead type — grid math never hardcodes a bead dimension, so correcting the provisional height constants later touches zero grid-math code.

**Verification checkpoint**: before building interaction on top of the renderer, visually compare the rendered offset-row grid against a real peyote swatch photo or a the prior app screenshot to confirm the offset axis is modeled correctly — cheap to check now, expensive to discover wrong later.

## Canvas rendering

Viewport state: `{ originXmm, originYmm, scalePxPerMm }`. `origin` = the mm-space world coordinate at the canvas's top-left CSS-pixel corner; `scalePxPerMm` = zoom expressed directly in pixels-per-millimeter.

```js
export function worldToScreen(xMm, yMm, viewport) {
  return {
    xPx: (xMm - viewport.originXmm) * viewport.scalePxPerMm,
    yPx: (yMm - viewport.originYmm) * viewport.scalePxPerMm,
  };
}
export function screenToWorld(xPx, yPx, viewport) {
  return {
    xMm: xPx / viewport.scalePxPerMm + viewport.originXmm,
    yMm: yPx / viewport.scalePxPerMm + viewport.originYmm,
  };
}
```

Pan/zoom transforms are applied by manual multiplication in these functions, **not** via `ctx.translate/ctx.scale` compounded with gesture state — keeps stroke line widths zoom-independent (a constant that would otherwise scale invisibly thin/absurdly thick with `ctx.scale`), and keeps `screenToWorld` trivially reusable for pinch-anchor math and Phase 2's tap/drag hit-testing. `ctx.scale` is reserved solely for one-time devicePixelRatio setup (Retina iPad), orthogonal to pan/zoom.

Draw function (`canvasRenderer.js`): clear canvas → compute visible mm-space bounds from canvas size + viewport → derive visible row/col range with 1-cell padding → loop range, `peyoteCellOriginMm` → `worldToScreen` → `ctx.strokeRect(...)`. Outlines only, no fill (no bead color data exists yet).

Redraw scheduling: coalescing `requestAnimationFrame`, not a continuous render loop — every gesture handler and UI control calls `scheduleRedraw()` rather than drawing synchronously, so rapid pointermove events coalesce into one draw per frame.

## Pan/zoom interaction

Pointer Events API (`pointerdown`/`pointermove`/`pointerup`/`pointercancel`) unifies touch, Apple Pencil, and mouse under one model with `pointerType` and `pointerId`, well supported in iPad Safari.

- `pointerdown`: `canvas.setPointerCapture(e.pointerId)`, store `{x, y}` per pointerId in a `Map`.
- **Two-finger drag = pan, two-finger pinch = zoom**; single-finger/Pencil inert in Phase 1 (reserved for Phase 2 drawing).
- Pinch zoom: track distance between two active pointers each `pointermove`; `scaleFactor = newDistance / previousDistance` multiplies `scalePxPerMm`. Convert pinch midpoint to world mm *before* changing scale, then recompute origin after so the same world point stays under the midpoint (zoom-to-anchor).
- Two-finger pan: track midpoint movement frame-to-frame, convert delta px to delta mm via current scale, subtract from origin.
- Clamp `scalePxPerMm` to a sane min/max (tune once visible — don't let a bead render under ~4px or exceed filling most of the viewport).
- Reset the pinch baseline (previous distance/midpoint) whenever pointer count changes, so the next gesture doesn't jump.
- Critical CSS: `touch-action: none` on the canvas (and container), `overscroll-behavior: none` on `html, body`, `-webkit-user-select: none` — without these, Safari's native scroll/pinch-zoom/double-tap-zoom/selection callout fights the custom gesture handling.

Mac dev fallback: mouse fires pointer events with `pointerType: 'mouse'` for free, reusing the pan code path for single-button drag. Zoom needs one addition: a `wheel` listener (trackpad pinch surfaces as `wheel` with `ctrlKey: true` in Safari/Chrome), same zoom-to-anchor math using cursor position as anchor.

## Units toggle

Isolated to `/units/convert.js` and one UI readout — never touches grid/state internals:

```js
export const MM_PER_INCH = 25.4;
export function mmToInches(mm) { return mm / MM_PER_INCH; }
export function inchesToMm(inches) { return inches * MM_PER_INCH; }
export function formatLength(mm, unit, precision = 2) {
  const value = unit === 'in' ? mmToInches(mm) : mm;
  return `${value.toFixed(precision)} ${unit}`;
}
```

`appState.units` holds `'mm' | 'in'`. A finished-size readout reads `gridParams.boundingBoxMm` and calls `formatLength()` for width/height, re-rendered on unit-toggle or grid regeneration. This readout never triggers a canvas redraw — confirms mm/inch conversion stays purely display-layer, per CLAUDE.md's Decision #6.

## Minimal initial UI

```html
<div id="controls">
  <select id="bead-type">
    <option value="delica11">Delica 11/0</option>
    <option value="rocaille11">Rocaille 11/0</option>
  </select>
  <label>Rows <input id="rows" type="number" value="20" min="1"></label>
  <label>Cols <input id="cols" type="number" value="20" min="1"></label>
  <button id="generate">Generate</button>
  <button id="unit-toggle">mm / in</button>
  <span id="size-readout"></span>
  <button id="reset-view">Reset View</button>
</div>
<canvas id="pattern-canvas"></canvas>
```

No app chrome, toolbar iconography, or library/save UI — a single test harness for Phase 1. `Reset View` (recenter origin, fit-to-canvas scale) is included even though not explicitly requested — cheap, and useful for not getting lost mid-testing.

`style.css`: flex layout (controls strip + canvas filling remaining height), canvas `touch-action: none`, `html, body { overscroll-behavior: none; -webkit-user-select: none; }`. `index.html` needs `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` plus `env(safe-area-inset-*)` padding consideration on the controls strip for home-screen standalone mode.

**Dev server note**: ES module `<script type="module">` imports are blocked under `file://` in Safari/Chrome. A trivial static server (e.g. `python3 -m http.server`) is required from day one — not a build step, just a server. For iPad testing, load `http://<mac-lan-ip>:<port>` from iPad Safari; Mac browsers cannot simulate real multi-touch pinch, so genuine gesture testing needs the physical iPad early rather than deferred to the end.

## Build order + verification

1. **Scaffold**: `index.html` + `style.css` + `main.js` stub — get a 2D context, fill solid color, devicePixelRatio-aware sizing, resize listener. *Verify*: serve via local static server, open on Mac and iPad Safari, confirm canvas fills correctly and renders crisp (not blurry) on Retina.
2. **`beadSpecs.js`**. *Verify*: temporary log of both constants, confirm import resolves and values match CLAUDE.md's table.
3. **`convert.js`** + its `node:test` file. *Verify*: `node --test` passes (e.g. 25.4mm → 1.00in).
4. **`peyote.js`** + its test file. *Verify*: tests cover a 4×4 grid — first cell, an odd-row cell (confirms half-width offset), bounding box math.
5. **`viewport.js`** + its test file. *Verify*: tests cover world↔screen round-trips at known coordinates/scale.
6. **`canvasRenderer.js`** — first real visual milestone: render a 20×30 Delica grid. *Verify visually*: rows staggered (not a plain grid), Delica cells wider than tall, switching to Rocaille changes proportions. **Compare against a real peyote swatch or the prior app screenshot** to confirm the offset axis before building interaction on top.
7. **Wire minimal UI + `appState`** in `main.js`: bead type select, rows/cols inputs, Generate button. *Verify*: switching bead type/dimensions and regenerating updates the render correctly.
8. **Mouse/trackpad pan+zoom** (build/verify on Mac first). *Verify*: drag pans smoothly with no jitter, wheel-zoom zooms toward the cursor, clamps behave at extremes.
9. **Touch pointer events**: two-finger pinch-zoom + pan, single-finger/Pencil inert. *Verify on physical iPad* — pinch feels anchored under fingers, no page-scroll/bounce fighting the gesture, home-screen standalone mode doesn't break canvas sizing.
10. **Units toggle wiring**. *Verify*: toggle mm/in on the size readout, hand-check one conversion.
11. **Edge cases**: large grid (e.g. 200×300) confirms viewport culling keeps redraws fast; 1×1 grid; zoom clamping; iPad rotation/resize handling.
