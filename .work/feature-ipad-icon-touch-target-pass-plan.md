# iPad UX pass: icons, touch targets, pinned undo/redo — implementation plan

## Context

A UX review of the current editor UI ([index.html](../index.html), [style.css](../style.css)) found the top bar and tool rail have accreted controls every session since Phase 8 with no consolidation pass, and several controls fall well under Apple's 44×44pt touch-target minimum — most notably `.color-swatch` at 28×28px (`style.css`'s `.color-swatch`/`.color-swatch-add` rules), and the row-action icons in the library list and Manage Colors list (rename/duplicate/delete/copy/edit, all built as bare emoji `textContent` at ~24-28px effective target — see `buildColorManageRow` in `src/ui/editorView.js` and the row-building code in `src/ui/libraryView.js`).

User confirmed direction: prioritize icons over text labels, make touch targets bigger throughout, and pin Undo/Redo permanently to the top-right corner for easy reach. Device is iPad Pro (not mini), so reclaiming screen real estate is a secondary, "nice if free" benefit — not the primary driver the way it would be on a smaller device.

Also confirmed: the icon set should be vendored from a real open-source icon library (Lucide, MIT/ISC-licensed), not hand-authored from scratch — better and more consistent visual quality than an LLM hand-drawing ~20 SVGs, while still keeping zero runtime/network dependency once vendored locally.

## Approach

This is a UI-layer restructuring only — no grid/state/storage logic changes. Every existing element `id` that `editorView.js`/`libraryView.js` already wire via `getElementById` stays in place (same discipline Phase 8's layout restructuring used), so behavior wiring is untouched; only markup, CSS, and a handful of small JS additions change.

### 1. Vendored icon set — `/vendor/icons/` + `src/ui/icons.js`

Vendor real files from **Lucide** (simple stroke-based line icons, consistent optical sizing, well-suited to this app's plain utilitarian look) — same shape as this project's earlier `/vendor/pdfjs/` precedent: static local files, fetched once during implementation (via `WebFetch` against Lucide's official raw SVG source, e.g. `raw.githubusercontent.com/lucide-icons/lucide/main/icons/<name>.svg`), committed into the repo — no CDN calls at runtime, no webfont, no build step, no `node_modules`. A `/vendor/icons/LICENSE` file carries Lucide's license notice (ISC — permissive, requires only the copyright/license text be preserved when redistributing, same diligence as any vendored third-party asset).

`src/ui/icons.js`:
- `createIcon(name)` → fetches/caches (`Map`, loaded once) the vendored `/vendor/icons/<name>.svg`, clones it into a new `<svg>` element sized via CSS (`currentColor` stroke, so it inherits button text color / pressed-state color for free) — used by JS-built rows (library rows, color-manage rows, bead-catalog rows).
- `mountIcons(root = document)` → scans for `[data-icon="name"]` elements already in `index.html`'s static markup (top bar, tool rail, dialogs) and injects the matching SVG into each, called once from `main.js` boot — static HTML never duplicates icon markup, one source of truth either way.

Icon set needed (~20 unique glyphs, several reused): draw (pencil), erase (eraser), fill (bucket), replace (swap-arrows), select (dashed marquee), copy, cut (scissors), paste (clipboard), mirror-h, mirror-v, deselect, clear/delete (trash — reused for Clear, library delete, color delete, colorway delete, remove photo), rename (pencil — reused for library rename, color rename, colorway rename), duplicate (stacked squares — reused for library duplicate and the color "copy to another bead type" action, which gets its own distinct arrow-into-tray glyph instead since those are different operations), drag-handle (grip dots — reused everywhere a list is reorderable), back (chevron), undo/redo (curved arrows), print, panel-toggle (sidebar), settings (gear), units (ruler), outline-toggle (square outline), reset-view (crosshair), list/gallery view (lines / grid), edit-color (palette), load-photo (image), move-photo (four-way arrows), add (plus), confirm (check), cancel (x). Every name maps 1:1 to a real Lucide icon of the same or near-same name, so there's no ambiguity about what gets fetched.

### 2. Shared touch-target system — `style.css`

A `.icon-btn` base class: square, centered SVG, minimum `2.75rem` (44px) — bumped to `3rem` (48px) for the highest-frequency targets (tool rail, color swatches, top-bar right cluster). Applied consistently instead of the current per-group one-off padding rules. `.color-swatch`/`.color-swatch-add` grow from 1.75rem to the new minimum; `.library-row-action`, `.color-manage-action`, `.library-drag-handle`, `.color-manage-drag-handle` all move onto the same base class.

### 3. Top bar: pinned Undo/Redo, icon-first, settings overflow

Restructure `#top-bar` into two non-wrapping flex zones instead of one flat wrapping row of 13 controls:
- **Left**: Back (icon + "Library" label, kept — it's the one control that benefits from orientation text) → a new **Pattern Settings** gear button, opening a `<dialog id="settings-dialog">` (same native-`<dialog>` convention as `#resize-dialog`/`#bead-catalog-dialog`) that houses the genuinely rare, per-design setup controls: bead type select, Bead Types… manage button, Rows/Cols inputs, Resize button. Size readout stays as plain text in the left zone (informational, not a button, cheap to leave visible).
- **Right** (`margin-left: auto`, `flex-wrap: nowrap` container so it can't be pushed onto a second line by the left zone wrapping): Outline toggle, Units toggle, Reset View, Panel toggle, Print/Export, then a visual divider, then **Undo, Redo** last — literally the top-right-most corner elements, at the enlarged 48px target size. This directly satisfies "always upper right, easy access" without needing any new positioning mechanism (`position: fixed` etc.) — flex order + `margin-left: auto` is enough given the two-zone split.

Moving Units/Outline/Reset View/Print/Panel to icon buttons (instead of today's text buttons) shrinks their combined width enough that the bar comfortably fits on one line at iPad Pro portrait width even before anything moves to the settings dialog — the settings-dialog move is what guarantees it, not strictly required by width alone.

### 4. Tool rail: icon-only, narrower, contextual

`#tool-toggle` (Draw/Erase/Fill/Replace/Select) and `#selection-controls`/`#paste-controls` become icon-only buttons at the enlarged target size. Two behavior-relevant changes (small JS additions in `editorView.js`, both additive to existing `update*Buttons` functions, no new state):
- `#selection-controls` currently renders all 6 buttons permanently (just disabled) — change to hidden entirely unless `appState.tool === 'select'`, matching the pattern `#paste-controls` already uses correctly. Fold this into `updateSelectionButtons()`/`setTool()`.
- Icon-only buttons need `title`/`aria-label` for tooltip + VoiceOver (iPad Pro + Apple Pencil hover will surface `title` as a hover tooltip too, a nice incidental win for this device).

Since icons need less horizontal room than text like "Deselect" or "Mirror ↔", `#tool-rail`'s width can drop from `6rem` to roughly `4.5rem` while the buttons themselves get *bigger* — this is the "useful to reclaim" real-estate win, delivered as a side effect rather than a separate task.

### 5. Library rows and Manage Colors rows: icon swap + bigger targets

`src/ui/libraryView.js` and the `buildColorManageRow`/row-building code in `src/ui/editorView.js`: replace emoji `textContent` (`✎`, `⎘`, `✖`, `🎨`, `☰`) with `createIcon(...)` calls, apply `.icon-btn` sizing. Row height/padding increases modestly to comfortably fit the larger action buttons. List/Gallery view toggle buttons in the library header also get icons alongside their existing text (or icon-only with the same `aria-pressed` styling already in place).

### Files touched
- New: `/vendor/icons/*.svg` (~20 files) + `/vendor/icons/LICENSE`
- New: `src/ui/icons.js`
- `index.html` — top-bar restructuring into left/right zones + new `#settings-dialog`, `data-icon` attributes on static buttons, tool-rail/selection/paste-controls markup simplified to icon buttons
- `style.css` — `.icon-btn` system, top-bar zone layout, settings-dialog styling (reuse existing dialog convention), enlarged swatch/row/rail sizing
- `src/ui/editorView.js` — swap emoji for `createIcon()` in `buildColorManageRow`; wire settings-dialog open/close; fold "hide selection-controls unless tool is select" into existing `updateSelectionButtons()`/`setTool()`; no changes to hook signatures or any pure logic
- `src/ui/libraryView.js` — swap emoji for `createIcon()` in row-action buttons
- `main.js` — one new call to `mountIcons()` during boot
- Time permitting, apply the same drag-handle/action-icon swap to `beadCatalogDialog.js`'s rows for visual consistency (flagged in CLAUDE.md's Phase Status notes as still using tiny touch targets) — lower priority than the four items above, called out separately so it can be dropped without affecting the rest.

CLAUDE.md's Phase Status should be updated at the end of implementation, per this project's established convention for standalone features.

## Verification

- `node --test 'src/test/**/*.js'` — expect the existing count unchanged (no pure/tested module touched; this is DOM/CSS-only, consistent with the precedent every other UI-only session in this project's history has followed).
- Headless Chromium via Playwright against a local `python3 -m http.server` (the project's standard verification loop):
  - `getBoundingClientRect()` checks confirming every interactive control (color swatches, tool-rail buttons, library row actions, color-manage row actions, top-bar buttons) measures ≥44×44 CSS px.
  - Screenshot/measure the top bar at iPad Pro 11" (834×1194) and 13" (1024×1366), both orientations, confirming Undo/Redo render in the top-right corner and never wrap to a second line.
  - Confirm `#selection-controls` is absent except when the Select tool is active, and present with correct enabled/disabled states once a selection exists.
  - Confirm the settings dialog opens/closes and that bead-type change, rows/cols resize, and the Bead Catalog manager still work through it unmodified (regression check on relocated-but-not-rewired controls).
  - Smoke-test draw/erase/undo/redo, colorway switching, and photo trace to confirm the markup move didn't disturb any existing wiring.
  - No console/page errors across the run.

## Not yet implemented

This plan was scoped and written up on 2026-08-13 but no code has been written yet — pick up here in a future session.
