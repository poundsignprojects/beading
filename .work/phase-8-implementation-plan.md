# Phase 8 Implementation Plan — Side Panel Layout + Custom Color Palettes

## Context

Two related asks from the same session (2026-08-09), bundled into one phase since the second depends structurally on the first:

1. **Custom color palettes.** Rather than trying to source/approximate the full Miyuki Delica/Rocaille catalogs (900+ SKUs each, no machine-readable hex data — see CLAUDE.md's Bead Specs gap), the user will build their own palette by hand: pick a color with a native color picker, name it, starting with the beads they actually own. This was already added to CLAUDE.md's Later/optional backlog this session; this plan schedules and designs it.
2. **Side panel layout.** The user shared a screenshot of the prior app's editor and asked for the same structural pattern: a slim top bar, a narrow left icon rail for tools, and a wide right-side panel for the color palette (with its own search/filter), canvas filling the remaining center. Currently every control lives in one wrapping `#controls` bar above the canvas, which Phase 7's status notes already flagged as consuming 15–20% of viewport height on iPad.

**Explicitly structural inspiration only** — this plan adapts the *pattern* (rail + panel + slim top bar), not the prior app's specific icons, visual styling, or color-numbering scheme. Per CLAUDE.md, this app is "built from scratch — not a clone, not reverse-engineered." This app's control set differs from what's in the screenshot (colorway switching, photo trace, resize dialog have no the prior app equivalent shown), so the mapping below is adapted to what this app actually has, not copied wholesale.

Doing the layout restructuring first, then building the new custom-color UI directly into the new panel, avoids building that UI once in the cramped top bar and again after reflowing — see Build order.

## Scope boundary

Not in this phase:
- **A real icon set for the tool rail.** The rail reuses the existing text-labeled buttons, just reflowed into a vertical column — sourcing or drawing ~14 icons (draw/erase/fill/replace/select/copy/cut/paste/mirror×2/deselect/undo/redo/move-photo) is a real, separate design task. Flagged under "Open, low-stakes implementation calls" as a natural follow-up once the structural layout is proven out.
- **Search/filter for the color palette.** the prior app's panel has both because its catalog runs into the hundreds. A hand-built palette of the beads one person owns will likely stay in the tens — premature to build search/filter for a list that size. Revisit if it grows.
- **Real Miyuki catalog data.** This phase is the workaround for not having it, not a resolution of the underlying gap.
- The other three backlog items added to CLAUDE.md this session (thumbnail grid library view, tagging/folders, the prior app export import) — not part of this ask.

## Part A: Side panel layout restructuring

### Current structure

`#editor-view` is a column flexbox: `#controls` (one wrapping flex bar holding every button/select/group — bead type, rows/cols/resize, units, reset-view, tool-toggle, clear, history-controls, selection-controls, colorway-controls, photo-trace-controls, print-export), then `#color-palette` (a second wrapping flex bar of swatch buttons), then `#pattern-canvas` filling the rest.

### New structure

`#editor-view` becomes a two-axis layout: a slim top bar spanning the full width, and below it a row of three regions — a narrow left rail, the canvas, and a wide right panel.

```html
<div id="editor-view" hidden>
  <div id="top-bar">
    <button id="back-to-library">&larr; Library</button>
    <select id="bead-type">...</select>
    <label>Rows <input id="rows" type="number" ...></label>
    <label>Cols <input id="cols" type="number" ...></label>
    <button id="generate">Resize</button>
    <button id="unit-toggle">mm / in</button>
    <span id="size-readout"></span>
    <button id="reset-view">Reset View</button>
    <div id="history-controls" role="group" aria-label="History">
      <button id="undo-button" disabled>Undo</button>
      <button id="redo-button" disabled>Redo</button>
    </div>
    <button id="print-export">Print / Export</button>
    <button id="panel-toggle" aria-pressed="true">Panel</button>
  </div>
  <div id="editor-body">
    <div id="tool-rail" role="group" aria-label="Tools">
      <div id="tool-toggle" role="group" aria-label="Tool">
        <button id="tool-draw" aria-pressed="true">Draw</button>
        <button id="tool-erase" aria-pressed="false">Erase</button>
        <button id="tool-fill" aria-pressed="false">Fill</button>
        <button id="tool-replace" aria-pressed="false">Replace</button>
        <button id="tool-select" aria-pressed="false">Select</button>
      </div>
      <div id="selection-controls" role="group" aria-label="Selection">
        <button id="selection-copy" disabled>Copy</button>
        <button id="selection-cut" disabled>Cut</button>
        <button id="selection-paste" disabled>Paste</button>
        <button id="selection-mirror-h" disabled>Mirror &harr;</button>
        <button id="selection-mirror-v" disabled>Mirror &updownarrow;</button>
        <button id="selection-deselect" disabled title="Deselect (Esc)">Deselect</button>
      </div>
      <button id="clear-pattern">Clear</button>
    </div>
    <canvas id="pattern-canvas"></canvas>
    <div id="side-panel">
      <section id="palette-section" aria-label="Color palette">
        <div id="color-palette"></div>
        <!-- new Part B controls land here -->
      </section>
      <section id="colorway-section" aria-label="Colorway">
        <div id="colorway-controls">...</div>
      </section>
      <section id="photo-trace-section" aria-label="Photo trace">
        <div id="photo-trace-controls">...</div>
      </section>
    </div>
  </div>
</div>
```

Every existing element **id** is preserved (`#tool-draw`, `#colorway-select`, etc.) — only the surrounding containers change, so `editorView.js`'s `document.getElementById` calls need zero changes. The only JS additions are the new `#panel-toggle` button and its handler.

### CSS

```css
#editor-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

#editor-body {
  flex: 1;
  display: flex;
  min-height: 0; /* let canvas/panel scroll internally instead of pushing page height */
}

#tool-rail {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 6rem;
  overflow-y: auto;
  padding: 0.5rem;
  padding-left: calc(0.5rem + env(safe-area-inset-left));
  background: #f2f2f2;
  border-right: 1px solid #ccc;
}

#tool-rail #tool-toggle,
#tool-rail #selection-controls {
  flex-direction: column;
}

#clear-pattern {
  margin-top: auto; /* pinned to the rail's bottom, visually separated as destructive */
}

#pattern-canvas {
  flex: 1;
  min-width: 0;
}

#side-panel {
  width: 18rem;
  overflow-y: auto;
  padding: 0.5rem;
  padding-right: calc(0.5rem + env(safe-area-inset-right));
  background: #f8f8f8;
  border-left: 1px solid #ccc;
}

#side-panel[hidden] {
  /* covered by the existing global [hidden] { display: none !important } rule */
}
```

Reuses the `[hidden]` global rule already established (and already fixed a real display-cascade bug in Phase 7) rather than inventing a new `.collapsed` class — `#panel-toggle` just toggles the `hidden` attribute on `#side-panel`, the same mechanism `#library-view`/`#editor-view`/`#print-view` already use.

### Panel-toggle behavior

```js
function handlePanelToggle() {
  const collapsed = !sidePanel.hidden;
  sidePanel.hidden = collapsed;
  panelToggleButton.setAttribute('aria-pressed', String(!collapsed));
  scheduleRedraw(); // canvas width just changed; resizeCanvasForDisplay must re-run
  hooks.onPreferencesChanged({ panelCollapsed: collapsed });
}
```

**Decision: panel-collapsed state is a persisted global preference** (`preferencesStore`'s existing `units`/`defaultBeadTypeKey`/`defaultRows`/`defaultCols` shape gains `panelCollapsed: false`), not per-session UI state. This directly matches the prior app pain point #1 ("preferences don't persist across designs") — the same reasoning that already governs every other preference in this app. `mountEditorView` reads `appState.preferences.panelCollapsed` on mount and sets `sidePanel.hidden` accordingly, alongside setting `beadTypeSelect.value`/`rowsInput.value`/etc.

Toggling the panel doesn't fire a `window.resize` event (it's a CSS layout change from an attribute, not a viewport resize), so `scheduleRedraw()` must be called explicitly — `render()` already calls `resizeCanvasForDisplay(canvas, ctx)` on every redraw, so this is a one-line addition, not new mechanism.

*Verify* (Playwright): collapsing the panel visibly widens the canvas element's bounding rect and the grid re-fits/redraws at the new size (pixel-sample a beforeafter to confirm cell positions actually shifted, not just that the DOM resized); the collapsed state survives switching designs and a page reload (reads back from `preferencesStore`).

## Part B: Custom color palettes

### Data model

New IndexedDB store, `customColors`, one record per user-added color:

```js
{ id, beadTypeKey, name, hex, order, createdAt, updatedAt }
```

Colors are scoped **per bead type** (`delica11` vs. `rocaille11` get independent lists), not shared globally — a physical Delica and a physical Rocaille aren't interchangeable even if painted to look the same, and this mirrors how `COLOR_LIBRARIES` was already keyed. This is also the point where those two keys stop being an accidental alias for the same array (CLAUDE.md's Bead-type-conversion backlog note already flags this as pending) — worth noting, not resolving, since bead-type conversion itself is still unscheduled.

`db.js` — bump `DB_VERSION` to 3, add the store the same guarded way the existing three already are:

```js
if (!db.objectStoreNames.contains('customColors')) db.createObjectStore('customColors', { keyPath: 'id' });
```

`src/storage/customColorStore.js` (new), mirroring `designStore.js`'s CRUD shape exactly:

```js
import { getAll, put, del } from './db.js';
import { generateId } from './id.js';

const STORE = 'customColors';

export async function listCustomColorsSorted(db, beadTypeKey) {
  const all = await getAll(db, STORE);
  return all.filter((c) => c.beadTypeKey === beadTypeKey).sort((a, b) => a.order - b.order);
}

export async function createCustomColor(db, { beadTypeKey, name, hex }) {
  const existing = (await getAll(db, STORE)).filter((c) => c.beadTypeKey === beadTypeKey);
  const maxOrder = existing.reduce((max, c) => Math.max(max, c.order), -Infinity);
  const now = Date.now();
  const color = {
    id: generateId(),
    beadTypeKey,
    name,
    hex,
    order: existing.length === 0 ? 0 : maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await put(db, STORE, color);
  return color;
}

export async function saveCustomColor(db, color) {
  const updated = { ...color, updatedAt: Date.now() };
  await put(db, STORE, updated);
  return updated;
}

export async function deleteCustomColor(db, id) {
  await del(db, STORE, id);
}
```

Reorder reuses `src/state/designOrder.js`'s existing `orderForInsertAt` directly — it's already axis-agnostic (works on any `{order}`-bearing sorted list), so no new fractional-order math is needed, just a second caller.

No `node:test` coverage for the store itself (no IndexedDB in Node, same reasoning as `designStore.js`) — verified in headless Chromium.

### Retiring the placeholder library

`src/palette/colorLibrary.js` loses `PLACEHOLDER_SWATCHES` and `COLOR_LIBRARIES` entirely — they were explicitly documented as "NOT a verified Miyuki catalog... swapping in real Miyuki DB/RR color numbers later is a data-only change," and this *is* that swap, just to user-entered data instead of catalog data. `UNASSIGNED_SWATCH` is untouched (it's an independent concept — an occupied-but-uncolored cell in a colorway — not catalog data).

**Consequence, accepted deliberately:** any cell drawn during testing with a placeholder `colorId` (`'red'`, `'blue'`, etc.) becomes an orphaned reference once the placeholder array is gone. `editorView.js`'s `resolveColor` already has a fallback for exactly this (`?? '#ff00ff'`) — an orphaned cell renders as glaring magenta rather than crashing or silently vanishing, which is the right non-destructive behavior and needs no new code. Since this project has no real designs yet (still in testing per every phase's status notes), recoloring test patterns by hand after this change is the honest tradeoff, not a nearest-hex remap system built for data that was never meant to be permanent.

### `appState` changes

```js
customColors: [],     // in-memory list for the *currently open* beadTypeKey — same
                       // role appState.designs/colorways already play; refreshed on
                       // design open and on bead-type change
selectedColorId: null, // was COLOR_LIBRARIES.delica11[0].id — now resolved once
                        // customColors loads, since there's no static default to point to
```

### Loading and refreshing

`main.js`'s `openDesign()` awaits the current bead type's list before mounting (small/fast rows, unlike a multi-MB photo blob — no need for the async-after-mount pattern Phase 7 used for photo traces):

```js
appState.customColors = await listCustomColorsSorted(appState.db, design.beadTypeKey);
```

Bead-type change (`editorView.js`'s `handleBeadTypeChange`, currently synchronous) needs the new list *before* `regenerateGrid()` calls `renderColorPalette()`, so it becomes:

```js
async function handleBeadTypeChange() {
  appState.beadTypeKey = beadTypeSelect.value;
  await hooks.onBeadTypeChanged(appState.beadTypeKey);
  regenerateGrid();
}
```

`main.js`'s implementation mutates `appState.customColors` in place (same pattern `onPreferencesChanged` already uses for `appState.preferences`):

```js
onBeadTypeChanged: async (beadTypeKey) => {
  appState.customColors = await listCustomColorsSorted(appState.db, beadTypeKey);
},
```

### Palette panel UI

`resolveColor`/`renderColorPalette` in `editorView.js` read `appState.customColors` instead of `COLOR_LIBRARIES[appState.beadTypeKey]` — otherwise unchanged (swatch buttons, `aria-pressed`, click-to-select-and-switch-to-draw behavior all carry over as-is).

**Empty state**: a brand-new bead type with zero custom colors shows a short message ("No colors yet — tap + to add one") instead of an empty swatch row. `selectedColorId` stays `null` in that case — drawing with `colorId: null` is already fully defined behavior (Phase 6's "unassigned" cell), so nothing breaks, it just means "not yet colored," which is an honest description of a design with no palette entries yet.

**Add Color**: a `+` tile appended to the swatch grid (same `.color-swatch` sizing, dashed border, `+` glyph instead of a fill color). Click triggers a hidden `<input type="color">` (the OS/browser system color picker — works in iPad Safari) via `.click()`; on `change`, `window.prompt('Name this color')` (same UX convention as `handleColorwayRename`) — cancelling or leaving the name blank aborts without creating anything:

```js
function handleColorPickerChange() {
  const hex = colorPickerInput.value;
  const name = window.prompt('Name this color');
  if (!name || !name.trim()) return;
  hooks.onCustomColorAdded({ name: name.trim(), hex }).then(() => renderColorPalette());
}
```

`main.js`'s `onCustomColorAdded` hook does the write and pushes the new record onto `appState.customColors` (visible to `editorView.js` immediately after the awaited call resolves, same object reference):

```js
onCustomColorAdded: async ({ name, hex }) => {
  const created = await createCustomColor(appState.db, { beadTypeKey: appState.beadTypeKey, name, hex });
  appState.customColors.push(created);
},
```

**Manage Colors** (rename/delete/reorder): a small list reusing the exact pattern `libraryView.js` already built and proved out — drag handle (with the same pointer-capture-on-the-list-container fix Phase 4 discovered, not on the row itself, since Chromium releases capture when the captured element is reparented mid-drag), name, rename via `prompt()`, delete via `confirm()`. Toggled into view by a **Manage** button next to the swatch grid, replacing it temporarily (not two views open at once — same screen real estate). Given this is structurally identical to `libraryView.js`'s row list, the natural implementation is a new `src/ui/customColorList.js` exporting a `mount`/`renderList` pair with the same shape as `mountLibraryView`, scoped to one bead type's colors instead of the design library — left as an open, low-stakes call whether it's worth its own module or folds directly into `editorView.js` (see below).

*Verify* (`node --test` where pure, Playwright for the rest): `customColorStore`'s order computation (max+1, first-color-gets-0) — same shape as `designStore.js`'s already-tested equivalent, verified the same way if extracted as a pure helper, otherwise Chromium-only; adding a color via the picker+prompt flow shows it in the swatch grid and painting with it produces the chosen hex on canvas; renaming updates the swatch's `title` and the Manage list; deleting a color that's in use leaves existing cells rendering as the magenta orphan fallback rather than erasing or crashing; reordering persists across a reload; switching bead type swaps the visible palette to that type's own list and back again without cross-contamination (add a color to Delica, switch to Rocaille, confirm it's absent, switch back, confirm it's still there).

## `appState`/hooks summary

| Field/hook | Type | Notes |
|---|---|---|
| `appState.customColors` | `Array<{id,name,hex,order,...}>` | current bead type's list only |
| `appState.selectedColorId` | `string \| null` | `null` now a real "nothing picked yet" state, not just Phase 6's "unassigned cell" |
| `appState.preferences.panelCollapsed` | `boolean` | new global preference, Part A |
| `hooks.onBeadTypeChanged(beadTypeKey)` | `Promise<void>` | refreshes `appState.customColors`, awaited before `regenerateGrid()` |
| `hooks.onCustomColorAdded({name, hex})` | `Promise<void>` | creates + pushes onto `appState.customColors` |
| `hooks.onCustomColorRenamed(id, name)` | `Promise<void>` | Manage list rename |
| `hooks.onCustomColorDeleted(id)` | `Promise<void>` | Manage list delete |
| `hooks.onCustomColorReordered(id, newOrder)` | `Promise<void>` | Manage list drag-reorder |

## Build order + verification

1. **Layout restructuring (Part A)** first — pure HTML/CSS reflow plus one new button/handler/preference field, zero data-model risk, and establishes the panel container Part B's new UI lands in (building the color-add/manage UI once, not twice). *Verify*: every existing Phase 1–7 toolbar interaction still works after the reflow (tool selection, resize, colorway switch, photo trace controls, undo/redo, print) — a full regression pass through prior phases' Playwright scenarios, since this step touches every control's container without touching the controls themselves. Panel collapse/expand resizes the canvas and persists.
2. **Data layer (Part B)**: `db.js` version bump, `customColorStore.js`. *Verify*: Chromium-only CRUD smoke test (create, list-by-bead-type, rename, delete, reorder) mirroring `designStore.js`'s existing verification approach.
3. **`colorLibrary.js`/`appState.js` changes**: drop `COLOR_LIBRARIES`/`PLACEHOLDER_SWATCHES`, add `customColors`/adjust `selectedColorId`. *Verify*: app boots with no console errors on a bead type with zero custom colors (empty-state message shows, no crash from the removed static lookup).
4. **Palette panel UI**: swatch grid reading `appState.customColors`, `+` add-color control, Manage Colors list. *Verify*: add/rename/delete/reorder flows per Part B's verify list above.
5. **`main.js` wiring**: `onBeadTypeChanged`/`onCustomColorAdded`/`onCustomColorRenamed`/`onCustomColorDeleted`/`onCustomColorReordered`, awaited load in `openDesign()`. *Verify*: switching bead type mid-session swaps the palette correctly (the cross-contamination check above); reload preserves everything.
6. **Full regression pass** — every prior phase's Playwright scenarios (draw/erase/undo/redo/resize/save-reload/print/colorways/fill/replace/selection/mirror/photo-trace) run once more end to end, since this phase touches shared containers (`editorView.js`'s DOM wiring, `appState` shape) even where it doesn't touch the underlying tool logic.
7. **Real iPad pass**: rail button touch-target size and column width at the two flagged iPad sizes (Pro 11" and mini, both orientations — same matrix Phase 7's toolbar-layout check used); side panel width/usability in portrait (the tightest case, per Phase 7's note that mini portrait left the least headroom); the native `<input type="color">` picker's actual on-device feel (unverified so far — should be the system color picker, but confirm before relying on it); panel-toggle discoverability without an icon (text label only, for now).

## Open, low-stakes implementation calls

1. **Icon rail vs. text-labeled rail.** This plan keeps text labels (zero new asset work); a full icon set is a real but separable follow-up once the structural layout is proven out on-device.
2. **`customColorList.js` as its own module vs. folded into `editorView.js`.** Structurally identical to `libraryView.js`'s row list either way; deferred to whichever reads cleaner once written, doesn't affect behavior.
3. **Search/filter for the palette.** Deferred until the list is actually large enough to need it.
4. **Panel width** (`18rem` above) is a starting guess, not measured against real content — likely needs adjusting once the Manage Colors list and colorway/photo-trace sections are actually laid out side by side in it.

## Housekeeping

Once implemented, CLAUDE.md needs: a new "8. **Phase 8 — Side panel layout + custom color palettes.**" line in the Phase Plan (with the Later/optional section's current "8." renumbered to "9."); "ability to create custom color palettes using a color picker" removed from the Later/optional bullet list (now scheduled here, superseding it) — the other three items added this session (thumbnail grid view, tagging/folders, the prior app import) stay in Later/optional, untouched.

## Next step

No code written yet. Build order above — step 1 (layout restructuring) has no dependency on Part B and is the natural starting point.
