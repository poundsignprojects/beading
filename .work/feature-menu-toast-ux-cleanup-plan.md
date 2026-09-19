# Selection-tool cleanup: long-press menus, row overflow menus, toast — implementation plan

## Context

From a UX review (2026-09-18): `#selection-controls` (`index.html`) stacks 9 icon-only buttons in the 4.75rem-wide `#tool-rail` whenever the Select tool is active — Copy, Cut, Paste, Mirror Horizontal, Mirror Vertical, Rotate 180°, Rotate 90° CCW, Rotate 90° CW, Deselect — on top of the 7 tool buttons already there. Three of those nine (the rotate variants) are one concept ("rotate") split into three near-identical icons distinguishable only by a long-press tooltip. The same "too many small icon actions per row" problem shows up in `buildColorManageRow` (`src/ui/editorView.js`) — 4 actions (Edit/Copy to.../Rename/Delete) plus a drag handle, already forced onto two lines (`.color-manage-main`'s `flex-basis: 100%` wrap hack in `style.css`) because it no longer fits one line in the 18rem side panel at the current touch-target size.

User confirmed doing the first 3 of 4 proposed concepts (skipping the floating-contextual-toolbar idea as out of scope for now):
1. Long-press → real action menu, extending `src/ui/longPressTooltip.js` (which today only shows a read-only label) instead of just consolidating icons with no way to reach the hidden options.
2. A shared row overflow-menu component, reused across every list-row type that has this problem.
3. A toast/snackbar for the purely-informational `window.alert()` calls, leaving `window.confirm()`/`window.prompt()` as-is (those need a real yes/no decision or text entry, where a blocking native dialog is arguably correct).

Also fixed as a quick separate item: `#scale-readout`/`#size-readout` didn't have a fixed width, so `#outline-toggle` and everything after it in `#top-bar-left` shifted position whenever the zoom-mode text changed length (e.g. `"34% (Fit)"` → `"100% (Actual Size)"`). Fixed with `min-width` on both spans, verified in headless Chromium across the full range of text those two readouts can produce (15 combinations, `#outline-toggle`'s position never moved). **Done, ahead of the rest of this plan.**

## Approach

All three items share one need: a small popup anchored to a trigger element, dismissible by tapping outside/Escape/selecting an item, and — since several of these triggers live inside an open native `<dialog>` (Bead Catalog, Manage Colors is not a dialog but Bead Catalog rows are) — aware of the dialog top-layer problem `longPressTooltip.js` already solved once (a plain `document.body` child renders behind an open `<dialog>`'s own `::backdrop`).

### 0. Shared: `src/ui/topLayerContainer.js` (new)

Extracts `longPressTooltip.js`'s existing `currentTooltipContainer()` (picks the topmost open `<dialog>`, else `document.body`) into its own module as `currentTopLayerContainer()`. Pure refactor, no behavior change — `longPressTooltip.js` imports it instead of defining it locally. `actionMenu.js` and `toast.js` (below) both need the identical logic, so this avoids a third copy.

### 1. `src/ui/actionMenu.js` (new)

`openActionMenu(anchorEl, items, { onClose } = {})` — `items: [{ label, icon?, disabled?, destructive?, onSelect }]`. Renders a small `<div role="menu">` positioned near `anchorEl` (same clamp-into-viewport/flip-if-no-room-above logic `longPressTooltip.js`'s `showTooltip` already has, reused rather than reinvented), one `<button role="menuitem">` per item with `createIcon()` (from `src/ui/icons.js`) + label text — real text labels this time, not just an icon, which is itself a discoverability improvement over a bare icon button. `destructive: true` items get red text (same visual language `#resize-confirm.destructive` already uses). A disabled item renders but doesn't fire `onSelect`. Selecting any item, tapping outside, or Escape closes the menu. Singleton — opening a second menu closes the first, same convention as the tooltip's one-`tooltipEl` model. The outside-dismiss listener is bound via `setTimeout(fn, 0)` **after** opening, not synchronously, so the same tap/click that opened the menu can't also immediately close it — sidesteps needing any coordination with `longPressTooltip.js`'s own click-suppression logic.

### 2. `src/ui/toast.js` (new)

`showToast(message)` — single-slot (a second call replaces whatever's showing, same singleton convention as the tooltip/reconnect-banner), rendered into `currentTopLayerContainer()`. Has its own close (×) button *and* a generous auto-hide backstop (8s — longer than the tooltip's 4s, since these messages are denser, e.g. a list of pattern names), matching the tooltip's existing "explicit hide + timeout backstop" pattern rather than inventing a new one. No stacking/queueing — deliberately simple, matches this codebase's existing single-overlay precedent (`driveReconnectBanner.js`).

Applied to the 6 purely-informational `window.alert()` call sites (confirmed via grep — every other `alert()`/`confirm()`/`prompt()` in the codebase either needs a yes/no decision or text entry and is explicitly left alone):
- `beadCatalogDialog.js:141` — bead type in use, delete blocked (names patterns)
- `beadCatalogDialog.js:147` — "at least one bead type must remain"
- `editorView.js:1070` — "no beads placed yet — nothing to crop to"
- `editorView.js:1074` — "already cropped tightly to the design"
- `editorView.js:1813` — "no other bead types to copy to yet"
- `editorView.js:1834` — color in use, delete blocked (names patterns/colorways)

### 3. Selection-controls consolidation (`index.html`, `editorView.js`, `style.css`)

`#selection-mirror-h`/`#selection-mirror-v` → one `#selection-mirror` button (keeps the `flip-horizontal-2` icon, since Mirror Horizontal stays the default tap action). `#selection-rotate-180`/`#selection-rotate-90-ccw`/`#selection-rotate-90-cw` → one `#selection-rotate` button (keeps `rotate-cw`, matching the top-bar's own single whole-canvas rotate button's default). Both get `data-has-menu="true"` for a small corner-dot CSS affordance (`::after`, ~6px) signaling "long-press for more" — nothing in the app currently marks a button as menu-capable, so this is a new but reusable visual convention.

`registerLongPressMenu(el, getItems)` (new export on `longPressTooltip.js`) lets `editorView.js` register each button's variant list once at mount; `getItems` is called fresh at long-press time (not cached), so it always reflects current state (e.g. `blocksMirror`) with no separate "refresh the menu" call needed anywhere. On a registered element, a long-press opens `actionMenu.js` instead of the plain tooltip — the existing `suppressClickOn` mechanism (already there for tooltips) stops the trailing click from also firing the button's own default-tap handler.

Default-tap handlers: `handleMirrorDefaultTap` performs Mirror Horizontal, or — if `blocksMirror` (odd-width-vs-drop-count restriction, unchanged logic) — calls `showToast(...)` with the same explanatory text currently sitting in `selectionMirrorHButton.title`, instead of silently doing nothing. `handleRotateDefaultTap` always performs Rotate 90° CW (rotation has no blocking condition at all, per the existing code comment). `updateSelectionButtons()` shrinks to setting 2 buttons' `disabled` (both `!hasSelection`) instead of 5.

Net: `#selection-controls` goes from 9 buttons to 6 (Copy, Cut, Paste, Mirror, Rotate, Deselect). While touching this markup, two thin dividers (reusing `#top-bar-divider`'s existing visual style, generalized to a shared `.toolbar-divider` class) split it into [clipboard] · [transform] · [Deselect] — the "just group them visually" idea from the review, essentially free once this markup is already being edited.

### 4. Row overflow menus (`editorView.js`, `beadCatalogDialog.js`, `style.css`)

`buildColorManageRow`, `buildLayerRow`, `buildColorwayRow` (all in `editorView.js`), and `beadCatalogDialog.js`'s `buildRow` each replace their 2–4 individual action buttons with one `⋯`-icon overflow button wired directly to `openActionMenu` on click (not long-press — an overflow button is self-evidently "more actions" by icon alone, so it doesn't need the long-press affordance the tool-rail buttons do). Menu items call the exact same existing handlers (`handleColorEditClick`, `handleColorCopyToClick`, `handleColorRename`, `handleColorDelete`, etc.) unchanged — only how they're triggered changes, so `confirm()`-guarded deletes and usage-guard logic are untouched.

Applying this to all four row types (not just `buildColorManageRow`, the one that's actually broken today) is a deliberate consistency call — layer/colorway/bead-catalog rows currently fit fine at 2 actions each, but having every row type in the app use the same "⋯ = more actions" convention is worth the small extra edit once the component exists. Flagging this so it can be scaled back to just `buildColorManageRow` if you'd rather leave the already-fine rows alone.

`.color-manage-row`'s two-line wrap hack (`.color-manage-main`'s `flex-basis: 100%`) is removed — swatch + name + one overflow button fits one line again, which was the actual crowding bug from project history.

Library rows (`libraryView.js` — rename/duplicate/delete, 3 buttons) are explicitly **left alone**: they don't currently break, and weren't part of the original review's "side panel" scope. Same component would make it a cheap follow-up later if wanted.

## Files touched

- New: `src/ui/topLayerContainer.js`, `src/ui/actionMenu.js`, `src/ui/toast.js`
- `src/ui/longPressTooltip.js` — use the shared top-layer helper; add `registerLongPressMenu`
- `index.html` — selection-controls markup (9 buttons → 6 + 2 dividers, `data-has-menu` on Mirror/Rotate)
- `style.css` — `.action-menu`/`.action-menu-item`, `#toast`, `.toolbar-divider` (generalized from `#top-bar-divider`), `[data-has-menu]::after` corner dot, `.color-manage-row`'s wrap hack removed
- `src/ui/editorView.js` — selection-controls button refs/handlers consolidated; `buildColorManageRow`/`buildLayerRow`/`buildColorwayRow` switched to overflow menus; 4 `alert()` → `showToast()`
- `src/ui/beadCatalogDialog.js` — row switched to an overflow menu; 2 `alert()` → `showToast()`

No data-model, storage, or grid/tool-logic changes — this is UI-layer only, same category as the iPad icon/touch-target pass.

## Verification

- `node --test 'src/test/**/*.js'` — expect the existing 365 unchanged (no pure/tested module touched, consistent with every prior UI-only session).
- Headless Chromium via Playwright (local `python3 -m http.server`, this project's standard loop):
  - Long-press on `#selection-mirror` opens a 2-item menu with correct labels; selecting Mirror Vertical performs it and closes the menu; a short tap performs Mirror Horizontal directly when unblocked; a short tap while blocked (odd-width selection) shows a toast with the same text the old `title` carried, and does **not** mirror.
  - Long-press on `#selection-rotate` opens a 3-item menu; each item rotates correctly; a short tap always does 90° CW.
  - Tapping outside an open menu, and Escape, both dismiss it without triggering whatever's underneath.
  - `.color-manage-row` renders on one line (bounding-rect check, no wrap) with the overflow menu producing the same 4 actions, each still firing its existing handler (Delete still goes through the existing usage-guard + `confirm()`).
  - A converted `alert()` site (e.g. Crop to Design with no beads) shows a toast instead of a blocking dialog, and the app remains interactive while it's up.
  - Regression: draw/undo/redo, Select → Copy → Paste, and Manage Colors add/rename/delete still work end to end through the restructured markup.
  - No console/page errors across the run.

CLAUDE.md's Phase Status should be updated at the end, per this project's convention for standalone features.
