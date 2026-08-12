# Feature Plan — Block In-Use Color Deletion + Missing-Color "X" Marker

## Context

Two related backlog items from `.work/feature-requests-and-bugs.md`:

1. **Line 10**: "If a color is in use in any pattern, do not allow it to be deleted (list patterns where it is in use)." Today `handleColorDelete` in `src/ui/editorView.js` only asks `window.confirm('Delete this color? Beads already using it will show as an unmatched placeholder color.')` — it warns, but always lets the delete through, and never says *which* patterns would be affected.
2. **Line 8**: "Missing bead color with an X." Today a cell whose `colorId` doesn't match any entry in `appState.customColors` renders filled with a hardcoded magenta fallback (`'#ff00ff'` in `src/palette/colorLibrary.js`'s `resolveSwatchHex`) — this is the "current pink bead" referenced in the ask.

These are complementary, not sequential: item 1 stops *new* dangling references from being created via the Manage Colors UI; item 2 is the fallback rendering for whatever dangling references already exist — from data saved before this feature ships, or from any future path that isn't this one delete button (e.g. a hand-edited IndexedDB record, or a bug). Both are worth doing together since they're two sides of the same "a cell points at a color that no longer exists" problem, and item 2's fixture data (a cell with an orphaned `colorId`) is also exactly what's needed to test item 1's guard.

## How colors and usage are modeled today (background, not new)

- Custom colors live in the `customColors` IndexedDB store, scoped by `beadTypeKey` (`src/storage/customColorStore.js`). `appState.customColors` mirrors only the currently-open bead type's list.
- A design record (`src/storage/designStore.js`) has `shapeEntries` (every occupied cell key, shared across colorways) and `colorways: [{id, name, colorEntries: [[cellKey, colorId], ...]}]` (Phase 6's shared-shape model, `src/state/colorwaySync.js`). A `colorId` referenced anywhere in any colorway's `colorEntries` is "in use."
- `appState.designs` is the full in-memory library list, loaded at boot and kept in sync on every save — **except** the currently-open design, whose active colorway's live edits only exist in `appState.cells` until the 800ms autosave debounce fires (`persistCurrentDesign()` in `main.js`). A usage check run naively against `appState.designs` alone would miss colors just painted with in the still-open design.

## Decisions

- **The usage check is a pure function, not a new hook/IndexedDB query.** `editorView.js` already receives the full `appState` (`mountEditorView(appState, hooks)`), including `appState.designs`, `appState.colorways`, `appState.activeColorwayId`, and `appState.cells` — everything needed is already in memory. No new main.js hook, no forced flush of the autosave debounce before checking.
- **The currently-open design is special-cased to read live state, not its last-saved snapshot.** The new helper takes an optional `liveState` (`{currentDesignId, colorways, activeColorwayId, cells}`) and, for whichever design in the list matches `currentDesignId`, substitutes the active colorway's `colorEntries` with a fresh decompose of `appState.cells` (reusing `decomposeCellsForSave` from `colorwaySync.js` — the exact same derivation `persistCurrentDesign()` uses when it *does* save). Every other design in the list is trusted as-is, since only one design is ever being live-edited at a time.
- **Guard on click, not a preemptively-disabled button.** Considered greying out each Manage-Colors delete button up front (matching the existing disabled-button convention for "delete last remaining colorway" and "Mirror Vertical on an even-height selection") — rejected because usage here is a function of pattern *content*, which can change without the Manage Colors list re-rendering (the list and the canvas are both visible/interactive at once; nothing currently re-renders `renderColorManageList()` on a draw/erase). A click-time check is always correct; a render-time disabled state can go stale the moment the user paints one more bead with that color while the list is open. Simpler, and consistent with how `handleColorDelete` already gates on a click-time `window.confirm`.
- **Blocked-deletion message uses `window.alert`**, matching the codebase's existing all-native-dialogs convention (`window.confirm` for destructive confirats, `window.prompt` for rename/add-color naming) rather than introducing a new modal component for this one case.
- **Missing-color rendering: `resolveSwatchHex` starts returning `null`** (instead of the `'#ff00ff'` fallback) when `colorId` is non-null but has no matching entry in `customColors` — distinct from `colorId === null` (genuinely unassigned, which still resolves to `UNASSIGNED_SWATCH.hex`, unchanged). This makes "missing" a distinguishable signal instead of just another hex string, which every caller needs so it can decide how to depict it. `resolveSwatchHex` has no `node:test` coverage today, so this is a safe signature-tightening with nothing to update there.
- **Only the main canvas gets a real "X" glyph.** That's the only place beads are large enough for an X to read as anything other than noise. The other three `resolveSwatchHex`/inline-fallback call sites (`thumbnailRenderer.js`, `pastePreviewOverlay.js`, `printView.js`'s materials-table swatch) currently duplicate the same `'#ff00ff'` magenta as their own fallback — those are swapped for one shared constant (a muted red, matching the X's stroke color) purely for visual consistency ("missing" should look the same everywhere), not given their own X-drawing logic. Flagged below as a small, easily-droppable line item if minimal diff is preferred.

## `src/palette/colorLibrary.js` — resolveSwatchHex + new shared constant

```js
export const MISSING_COLOR_FALLBACK_HEX = '#c0392b'; // matches canvasRenderer.js's X stroke color

// Shared by editorView.js/printView.js/thumbnailRenderer's caller — colorId === null
// means "occupied, no color assigned in this colorway" (see UNASSIGNED_SWATCH above,
// unchanged); colorId set but not found in customColors means a dangling reference
// (the color it pointed to was deleted, or predates this app's data model) — returns
// null so callers can render that state distinctly instead of guessing a color.
export function resolveSwatchHex(customColors, colorId) {
  if (colorId === null) return UNASSIGNED_SWATCH.hex;
  return customColors.find((swatch) => swatch.id === colorId)?.hex ?? null;
}
```

## `src/render/canvasRenderer.js` — draw an X for a missing color

New constants alongside the existing bead-outline ones:

```js
const MISSING_COLOR_FILL_STYLE = '#fff';
const MISSING_COLOR_X_STYLE = '#c0392b';
const MISSING_COLOR_X_LINE_WIDTH_FRACTION = 0.12;
const MISSING_COLOR_X_LINE_WIDTH_MIN_PX = 0.75;
const MISSING_COLOR_X_INSET_FRACTION = 0.22; // keeps the X inside the bead outline
```

In `drawPeyoteGrid`'s occupied-cell branch, `resolveColor(cell.colorId)` can now come back `null`. The existing fill+stroke of the bead's rect/roundRect shape is unchanged either way (a missing color still occupies its cell and gets the normal outline — it's not invisible); only the fill color and an extra X differ:

```js
const hex = resolveColor(cell.colorId);
...
ctx.beginPath();
if (beadShape === 'round') { ctx.roundRect(...); } else { ctx.rect(...); }
ctx.fillStyle = hex ?? MISSING_COLOR_FILL_STYLE;
ctx.fill();
ctx.stroke(); // existing outline stroke, unchanged

if (hex === null) {
  const inset = Math.min(beadWidthPx, beadHeightPx) * MISSING_COLOR_X_INSET_FRACTION;
  ctx.strokeStyle = MISSING_COLOR_X_STYLE;
  ctx.lineWidth = Math.max(MISSING_COLOR_X_LINE_WIDTH_MIN_PX, Math.min(beadWidthPx, beadHeightPx) * MISSING_COLOR_X_LINE_WIDTH_FRACTION);
  ctx.beginPath();
  ctx.moveTo(beadX + inset, beadY + inset);
  ctx.lineTo(beadX + beadWidthPx - inset, beadY + beadHeightPx - inset);
  ctx.moveTo(beadX + beadWidthPx - inset, beadY + inset);
  ctx.lineTo(beadX + inset, beadY + beadHeightPx - inset);
  ctx.stroke();
  ctx.strokeStyle = CELL_STROKE_STYLE; // restore — reused unset across the loop's outline strokes
}
```
The trailing restore matters: `ctx.strokeStyle` is set once before the loop and never reassigned per-iteration today, so leaving it on the X color would bleed into every subsequent cell's outline for the rest of the frame.

No new parameters on `drawPeyoteGrid` — `resolveColor` already flows through untouched; only its contract (can return `null`) changes.

## `src/render/thumbnailRenderer.js` / `src/render/pastePreviewOverlay.js` / `src/ui/printView.js` — fallback consistency (small, optional)

Each currently either relies on `resolveSwatchHex`'s old magenta default or hardcodes `'#ff00ff'` locally (`printView.js`'s materials-table swatch). Swap all three to the shared constant:

- `thumbnailRenderer.js`: `ctx.fillStyle = resolveColor(cell.colorId) ?? MISSING_COLOR_FALLBACK_HEX;`
- `pastePreviewOverlay.js`: same pattern at its `ctx.fillStyle = resolveColor(colorId)` line.
- `printView.js`: `swatchEl.style.background = swatch?.hex ?? MISSING_COLOR_FALLBACK_HEX;`, importing the constant instead of the inline literal.

None of these draw an X (too small to read at thumbnail/legend-swatch scale) — just a color swap so "missing" doesn't look like an arbitrary bright pink in three different places while looking like a deliberate warning color on the main canvas. This part is easy to drop from the build if a smaller diff is preferred; nothing else in this plan depends on it.

## `src/palette/colorUsage.js` (new) — the deletion guard's pure core

```js
import { decomposeCellsForSave } from '../state/colorwaySync.js';

// Finds every design that references colorId in any of its colorways, so the
// Manage Colors list can block deletion and say exactly where a color is used.
// Pure over plain data — `liveState` (optional) lets the currently-open design's
// still-unsaved edits count, instead of only the last-autosaved snapshot in
// `designs` (see this plan's "How colors and usage are modeled today" section).
export function findPatternsUsingColor(designs, colorId, liveState = null) {
  const results = [];
  for (const design of designs) {
    const colorways = colorwaysFor(design, liveState);
    const colorwayNames = colorways
      .filter((cw) => cw.colorEntries.some(([, cid]) => cid === colorId))
      .map((cw) => cw.name);
    if (colorwayNames.length > 0) {
      results.push({ designId: design.id, designName: design.name, colorwayNames });
    }
  }
  return results;
}

function colorwaysFor(design, liveState) {
  if (!liveState || design.id !== liveState.currentDesignId) return design.colorways;
  const { colorEntries } = decomposeCellsForSave(liveState.cells);
  return liveState.colorways.map((cw) =>
    cw.id === liveState.activeColorwayId ? { ...cw, colorEntries } : cw
  );
}
```

## `src/ui/editorView.js` — wire the guard into the existing delete handler

```js
import { findPatternsUsingColor } from '../palette/colorUsage.js';
...
function handleColorDelete(id) {
  const usage = findPatternsUsingColor(appState.designs, id, {
    currentDesignId: appState.currentDesignId,
    colorways: appState.colorways,
    activeColorwayId: appState.activeColorwayId,
    cells: appState.cells,
  });
  if (usage.length > 0) {
    const lines = usage.map((u) =>
      u.colorwayNames.length > 1 ? `${u.designName} (${u.colorwayNames.join(', ')})` : u.designName
    );
    window.alert(
      `This color is used in ${usage.length} pattern${usage.length === 1 ? '' : 's'} and can't be deleted:\n\n${lines.join('\n')}`
    );
    return;
  }
  if (!window.confirm('Delete this color?')) return;
  hooks.onCustomColorDeleted(id).then(() => {
    renderColorPalette();
    renderColorManageList();
    scheduleRedraw();
  });
}
```
The old confirm copy ("Beads already using it will show as an unmatched placeholder color") is dropped — it's no longer possible to reach that state through this button, so the warning is dead text once the guard is in place. `(ColorwayA, ColorwayB)` only appears when a design actually has more than one colorway referencing the color, keeping the common single-colorway case's line clean (just the design name).

No changes needed to `main.js`'s `handleCustomColorDeleted` — it's simply never called when usage is found, since the guard sits above the `hooks.onCustomColorDeleted(id)` call, not inside it.

## Test coverage

New `src/test/palette/colorUsage.test.js` (mirrors `colorwaySync.test.js`'s style/fixtures):
- A color referenced in one design's one colorway → one result with that design's name.
- A color referenced in two of one design's colorways → one result, both colorway names.
- A color referenced across two different designs → two results.
- A color referenced nowhere → `[]`.
- `liveState` override: a design whose stale `designs` entry has no reference to the color, but whose `liveState.cells` (the currently-open, not-yet-autosaved design) does → still found. And the inverse — stale `designs` entry *does* reference it, but the live cells no longer do (user erased it since the last autosave) → not found, since live state wins for the open design.
- A `liveState` present but for a *different* `currentDesignId` than any design being checked → every design falls back to its own `colorways` field untouched (confirms the substitution is correctly scoped to just the one open design).

Existing suites needing small additions:
- `src/test/palette/colorLibrary.test.js` (new — this file has no coverage today): `resolveSwatchHex` returns `UNASSIGNED_SWATCH.hex` for `null`, a real swatch's hex for a matching id, and `null` (not a magenta string) for a non-matching id.
- No changes needed to `canvasRenderer.js`'s tests — it has none today (canvas/DOM-dependent, same as every other render module per CLAUDE.md's existing precedent) — covered by the Playwright pass below instead.

## Verification (headless Chromium, same approach as every prior phase)

1. **Deletion guard.** Paint a bead with a custom color, open Manage Colors, attempt to delete that color → alert lists the current design's name, color remains in `appState.customColors` (and in IndexedDB, confirmed via re-fetch) after dismissing the alert. Create a second colorway on the same design, use the same color there too, delete-attempt → alert lists both colorway names for the one design. Erase the bead (color no longer used anywhere) → delete now succeeds with the plain confirm, color is actually removed. Separately: paint with a color *without* triggering an autosave first (well inside the 800ms debounce window), attempt delete immediately → still correctly blocked, confirming the live-state substitution (not a stale `appState.designs` read) is what's actually being checked, not an artifact of the debounce having already fired.
2. **Missing-color rendering.** Since the guard above should make this state unreachable through the app's own UI, seed it directly: paint a bead, then delete its underlying record straight from `customColors` in IndexedDB (bypassing the guarded button, simulating "pre-existing dangling reference" data), reload the design → the cell renders as a white cell with a red X rather than the old magenta fill, pixel-sampled at the X's diagonal to confirm it's actually drawn (not just a color swap) and at a corner to confirm the cell's normal outline is still intact. A normally-colored cell elsewhere in the same design is pixel-unaffected. Confirm the thumbnail/print-materials/paste-ghost fallback swap (if built) shows the shared red instead of magenta in at least one of those three contexts.
3. Full `node:test` suite run to confirm no regressions in `wordChart.test.js`/`printView`-adjacent fixtures or anything else touching `resolveSwatchHex`'s old return contract (expected: none, since it currently has zero test coverage).

## Open questions (low-stakes, resolved with a default below — flag if you want it differently)

- **Alert wording/format** — plain `window.alert` with one pattern name per line (shown above) vs. a richer inline UI (e.g., an expandable list in the Manage Colors row itself). Default: the plain alert, matching every other destructive-action prompt in this app.
- **Whether to include the thumbnail/paste-ghost/print-legend fallback-color consistency pass** — it's decoupled from the two core asks and can be cut for a smaller diff without weakening either feature. Default: include it, since it's a few one-line swaps once `MISSING_COLOR_FALLBACK_HEX` exists.
