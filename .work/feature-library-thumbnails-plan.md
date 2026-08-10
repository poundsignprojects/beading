# Feature Plan — Library Thumbnail Gallery

## Context

Backlog item ("thumbnail grid view of library," CLAUDE.md's Later/optional section), scheduled by this plan. Two asks:

1. Every design in the library should show a small thumbnail of its actual pattern — even in the current list layout, not just in a new view.
2. A toggle to switch the whole library between the existing list layout and a larger thumbnail-forward gallery layout.

Not a phase-plan item (Phase 8 was the last scheduled phase); this is a standalone feature plan.

## Decisions

- **Thumbnail storage: a field on the design record itself, not a separate object store.** `photoTraces` got its own store specifically because a reference photo `Blob` can be multi-MB and shouldn't be re-serialized on every debounced cell-edit autosave (see `db.js`'s comment). A thumbnail is the opposite case — a small PNG (order of a few KB, mostly flat colors, so PNG compresses it well) at a fixed small pixel size — so including it directly in the same `saveDesign` write `designStore.js` already does on every autosave adds negligible cost. No `DB_VERSION` bump needed: IndexedDB records are schemaless, so a new field on an existing store doesn't require a migration in the `db.js` sense (unlike a brand-new store).
- **Regenerated on every save, from live state — no separate dirty-tracking.** `persistCurrentDesign()` in `main.js` already reads whatever's live in `appState` right before writing; the thumbnail is computed there too, every time, so it's always in sync with what's actually drawn. No cache-invalidation logic needed.
- **No backfill pass for designs that predate this feature (or were never reopened since).** They show a neutral placeholder box until next opened+saved. Considered mirroring `migrateDesign.js`'s "runs once per design during `listDesignsSorted`" pattern, but that would require materializing each design's active colorway's cells (`colorwaySync.js`) and fetching its bead type's `customColors` from IndexedDB for every design on every library boot just to render a thumbnail nobody may look at yet — real cost for a personal-use library that's opened frequently anyway (each design gets a real thumbnail the moment it's next opened). Flagged as the one open call in this plan worth revisiting if it's a real annoyance in practice.
- **List and gallery modes reuse identical row markup**, switched by a single CSS class on the list container (`#library-list.gallery-mode`) rather than two different DOM shapes. This means `libraryView.js`'s existing drag-reorder logic barely changes — it already operates generically over whatever `<li class="library-row">` elements are inside `#library-list`.
- **View mode is a persisted global preference** (`preferences.libraryViewMode: 'list' | 'gallery'`), same mechanism as `panelCollapsed` — fixes prior-app pain point #1 by not resetting to list every session.
- **A shared `resolveSwatchHex` helper is extracted** to `src/palette/colorLibrary.js` (colorId → hex, handling the `null`/unassigned case). Today this logic is duplicated between `editorView.js`'s `resolveColor` and `printView.js`'s `resolveSwatch`; the thumbnail renderer becomes a third caller with the exact same need, which is the natural trigger to dedupe rather than write a fourth near-copy.

## `src/render/thumbnailRenderer.js` (new)

Pure-ish (touches the DOM only to create a detached `<canvas>`, same pattern print/export and the main canvas already rely on — no `OffscreenCanvas`, for broadest iPad Safari compatibility).

```js
import { peyoteCellOriginMm } from '../grid/peyote.js';

const THUMBNAIL_BACKGROUND_STYLE = '#fff';
const THUMBNAIL_CORNER_RADIUS_FRACTION = 0.25; // matches canvasRenderer.js's round-bead constant

// Renders a design's current pattern into a small square-bounded PNG data URL, fit
// (not cropped) within maxSizePx on its longer side. No outlines, no empty-cell
// dots — both would just be noise at thumbnail scale — only occupied cells are
// drawn, which is also cheaper than a full rows*cols sweep for a sparse pattern.
export function renderThumbnailDataUrl(gridParams, cells, resolveColor, beadShape, maxSizePx) {
  const { beadWidthMm, beadHeightMm, boundingBoxMm } = gridParams;
  const scale = maxSizePx / Math.max(boundingBoxMm.widthMm, boundingBoxMm.heightMm);
  const canvasWidth = Math.max(1, Math.round(boundingBoxMm.widthMm * scale));
  const canvasHeight = Math.max(1, Math.round(boundingBoxMm.heightMm * scale));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = THUMBNAIL_BACKGROUND_STYLE;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  for (const [key, cell] of cells) {
    const [row, col] = key.split(',').map(Number);
    const origin = peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm);
    const x = origin.xMm * scale;
    const y = origin.yMm * scale;
    const w = beadHeightMm * scale;
    const h = beadWidthMm * scale;
    ctx.fillStyle = resolveColor(cell.colorId);
    if (beadShape === 'round') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(w, h) * THUMBNAIL_CORNER_RADIUS_FRACTION);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  return canvas.toDataURL('image/png');
}
```

An empty design (`cells.size === 0`) still produces a valid blank-white data URL, not `null` — so "no thumbnail yet" (design never saved under this feature) and "thumbnail of an empty design" stay distinguishable (`thumbnailDataUrl` is `null`/`undefined` only in the former case).

## `src/palette/colorLibrary.js`

Add the shared lookup both existing call sites currently duplicate:

```js
// Shared by editorView.js/printView.js/thumbnailRenderer's caller — colorId === null
// means "occupied, no color assigned in this colorway" (see UNASSIGNED_SWATCH above);
// an id with no matching customColors entry (a deleted color still referenced by an
// old cell) falls back to a visibly-wrong magenta rather than throwing.
export function resolveSwatchHex(customColors, colorId) {
  if (colorId === null) return UNASSIGNED_SWATCH.hex;
  return customColors.find((swatch) => swatch.id === colorId)?.hex ?? '#ff00ff';
}
```

`editorView.js`'s `resolveColor` becomes a one-line wrapper (`(colorId) => resolveSwatchHex(appState.customColors, colorId)`) or is replaced outright at its two call sites. `printView.js`'s local `resolveSwatch` (which returns the whole swatch object, for the name too, not just hex) stays as its own thing — it needs `name` as well as `hex`, so it isn't a pure duplicate of this — but the plan is to leave it doing its own `find` for the swatch object and not force an artificial shared abstraction there; only the hex-only lookup (used by `resolveColor` and the new thumbnail call) gets deduped.

## `src/storage/designStore.js`

- `createDesign`: seed `thumbnailDataUrl: null` in the new record.
- `saveDesign`: no signature change — already spreads whatever's passed in; `main.js` just needs to include `thumbnailDataUrl` in the object it passes.
- `duplicateDesign`: copy `thumbnailDataUrl` from the original verbatim (`...original` spread already does this) — correct immediately, since a fresh duplicate's pattern is pixel-identical to its source until the user edits it.

## `main.js`

- Constant: `const THUMBNAIL_MAX_SIZE_PX = 200;` (rendered once at a size that stays crisp scaled down into either the small list thumbnail box or the larger gallery tile via CSS, rather than re-rendering two sizes).
- Import `renderThumbnailDataUrl` and `resolveSwatchHex`; import `BEAD_TYPES` from `../src/palette/beadSpecs.js` (not currently imported in `main.js`).
- In `persistCurrentDesign()`, right after computing `shapeEntries`/materializing colors and before calling `saveDesign`:
  ```js
  const thumbnailDataUrl = appState.gridParams
    ? renderThumbnailDataUrl(
        appState.gridParams,
        appState.cells,
        (colorId) => resolveSwatchHex(appState.customColors, colorId),
        BEAD_TYPES[appState.beadTypeKey].shape,
        THUMBNAIL_MAX_SIZE_PX,
      )
    : existing.thumbnailDataUrl;
  ```
  and include `thumbnailDataUrl` in the object passed to `saveDesign(...)`.
- No new debounce — this rides the existing `debouncedSave`/`onImmediateSave` cadence untouched. Flag as a verification step (see below) that regenerating a thumbnail on every autosave tick doesn't introduce a perceptible cost even against a large, dense pattern.
- `boot()`: pass `appState.preferences.libraryViewMode` to the library view (see below) before the first `renderList` call.
- New `handleViewModeChanged(mode)`:
  ```js
  async function handleViewModeChanged(mode) {
    appState.preferences = { ...appState.preferences, libraryViewMode: mode };
    await savePreferences(appState.db, appState.preferences);
  }
  ```
  wired into `mountLibraryView`'s callbacks as `onViewModeChanged`.

## `src/storage/preferencesStore.js`

`DEFAULT_PREFERENCES` gains `libraryViewMode: 'list'` — additive, so an existing preferences row without this field just reads `undefined` until first toggled, and `getPreferences` already falls back to the full `DEFAULT_PREFERENCES` object only when no row exists at all (an existing row is returned as-is). To avoid a returning user's `undefined` mode silently breaking the toggle's `aria-pressed` state, `libraryView.js`'s initial mode read should treat anything other than `'gallery'` as `'list'` (`mode === 'gallery' ? 'gallery' : 'list'`), not a strict equality check against `'list'`.

## `src/ui/libraryView.js`

- `mountLibraryView(callbacks)` gains two new DOM refs: `#library-view-list` / `#library-view-gallery` toggle buttons.
- New closure state: `let currentViewMode = 'list';`
- New exposed control: `setViewMode(mode)` — sets `currentViewMode`, toggles `listEl.classList.toggle('gallery-mode', mode === 'gallery')`, updates both toggle buttons' `aria-pressed`, and does **not** re-render rows itself (row markup is identical in both modes — only CSS changes); `main.js` calls this once at boot with the stored preference, before the first `renderList`.
- Toggle button click handlers call `setViewMode(mode)` directly (immediate visual feedback) and then `callbacks.onViewModeChanged(mode)` (persist).
- `buildRow(design)`: insert a thumbnail element between the drag handle and the info button:
  ```js
  const thumb = document.createElement('div');
  thumb.className = 'library-row-thumb';
  if (design.thumbnailDataUrl) {
    const img = document.createElement('img');
    img.src = design.thumbnailDataUrl;
    img.alt = '';
    thumb.append(img);
  }
  // else: stays empty, styled as a neutral placeholder box via CSS — no broken-image
  // icon risk, no placeholder asset file to manage (this project has none so far).
  ```
  inserted into `row.append(handle, thumb, info, renameButton, duplicateButton, deleteButton)`.
- Drag-reorder target detection (`handleListPointerMove`) needs a second algorithm for the wrapped 2D gallery grid — the existing one (`e.clientY < rect.top + rect.height / 2`) only makes sense for a single vertical column and must **not** be touched for list mode (it's already tested/working). Add a mode-aware helper instead of trying to unify into one formula:
  ```js
  function isBeforeTarget(pointerX, pointerY, rect, viewMode) {
    if (viewMode !== 'gallery') return pointerY < rect.top + rect.height / 2;
    const withinRowBand = pointerY >= rect.top && pointerY <= rect.bottom;
    return withinRowBand
      ? pointerX < rect.left + rect.width / 2
      : pointerY < rect.top + rect.height / 2;
  }
  ```
  `handleListPointerMove`'s `siblings.find(...)` predicate becomes `isBeforeTarget(e.clientX, e.clientY, rect, currentViewMode)`. List mode's behavior is byte-for-byte unchanged (same expression, just routed through the helper); gallery mode additionally compares X when the pointer's Y falls within a tile's own row band, and falls back to the Y-only check otherwise (covers dragging across a row-wrap boundary).

## `index.html`

Add a view-mode toggle inside `#library-header`, next to `#library-new`:

```html
<div id="library-view-toggle" role="group" aria-label="View">
  <button id="library-view-list" type="button" aria-pressed="true">List</button>
  <button id="library-view-gallery" type="button" aria-pressed="false">Gallery</button>
</div>
```

## `style.css`

- `.library-row-thumb` (list-mode default): fixed small box, e.g. `width: 44px; height: 44px; flex-shrink: 0; border-radius: 4px; overflow: hidden; background: #eee;` (neutral placeholder fill when empty); `.library-row-thumb img { width: 100%; height: 100%; object-fit: contain; }`.
- `#library-list.gallery-mode`: switches the container from today's flex-column to a wrapping grid — `display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 1rem; list-style: none; padding: 0;` (only applies when the class is present; base `#library-list` rules are untouched, so list mode's CSS is unaffected).
- `.gallery-mode .library-row`: `flex-direction: column; align-items: stretch; position: relative; border: 1px solid #ddd; border-radius: 8px; padding: 0.5rem;` (turns the same flex-row markup into a vertical card).
- `.gallery-mode .library-row-thumb`: `width: 100%; aspect-ratio: 1; height: auto;` (square tile regardless of the pattern's actual aspect ratio, letterboxed via the inner `img`'s `object-fit: contain`).
- `.gallery-mode .library-drag-handle`: `position: absolute; top: 0.25rem; left: 0.25rem;` (small corner overlay instead of its own row, since a compact tile has no spare horizontal strip for it).
- `.gallery-mode .library-row-action`: smaller icon buttons, wrapped into a row below the name rather than trailing on the same line as in list mode.
- `#library-view-toggle`: styled consistent with the existing `aria-pressed` grouped-button convention already used by `#tool-toggle` etc.

## Build order + verification

1. `src/palette/colorLibrary.js` — add `resolveSwatchHex`; update `editorView.js`'s `resolveColor` to use it (small, isolated, run the full test suite + a quick Playwright pass to confirm the palette/canvas still render identically — pure refactor, no behavior change expected).
2. `src/render/thumbnailRenderer.js` — new, no dependents yet. Directly testable in headless Chromium only (canvas + `document.createElement` — no `node:test` coverage, same as `canvasRenderer.js`/`selectionOverlay.js`'s existing precedent) by rendering a small fixture pattern and confirming the data URL decodes to the expected pixel colors at a few sample points.
3. `designStore.js` + `preferencesStore.js` — `thumbnailDataUrl`/`libraryViewMode` field additions.
4. `main.js` — wire thumbnail regeneration into `persistCurrentDesign()`, wire `handleViewModeChanged`, pass initial view mode to `mountLibraryView`.
5. `index.html`/`style.css` — toggle markup + thumbnail/gallery CSS.
6. `libraryView.js` — thumbnail element in `buildRow`, `setViewMode`, gallery-aware drag-reorder.
7. Verification pass (Playwright, same local-`http.server` approach as prior phases):
   - Create 3+ designs, draw a distinct pattern/color in each; reload the library and confirm each design's `thumbnailDataUrl` (read directly from IndexedDB in the driver script — simpler and more robust than pixel-sampling a rendered `<img>`) is non-null and differs across designs.
   - An empty, never-drawn-in design shows the placeholder box (no `<img>`, not a broken image).
   - Toggle List → Gallery: `#library-list` gains `gallery-mode`, tiles lay out in a grid, thumbnails render at the larger size; toggle back confirms list layout returns unchanged. Reload confirms the chosen mode persisted.
   - Drag-reorder regression-check in list mode (must still behave exactly as today — reuse Phase 4's existing verification scenario). New check in gallery mode: with 5+ tiles (enough to wrap to a second row), drag a tile from the second row to before the first tile in the first row, and drag one within the same row past a neighbor — confirm the resulting order matches intent in both cases.
   - Time `renderThumbnailDataUrl` against a large, dense pattern (reuse the existing 300×200/5,000-cell perf fixture other phases use) to confirm it stays well under the 800ms autosave debounce window, consistent with this project's existing perf-consciousness (e.g. Phase 5's word-chart timing check).

## Open, low-stakes implementation calls

- **No backfill for pre-existing designs' thumbnails** (see Decisions) — placeholder until next open+save. Cheap to add later as a `migrateDesign.js`-style pass if it turns out to matter in practice.
- **Thumbnail render size (200px)** and **gallery tile minimum width (9rem)** are starting guesses, not checked against real content at the two iPad sizes this project's other phases flag (Pro 11"/mini, both orientations) — easy to tune later, no data-model impact.
- **JPEG vs. PNG** — PNG chosen for sharp bead edges and because solid-color regions compress extremely well; worth a real-world size check once there are enough saved designs to see typical `thumbnailDataUrl` sizes in IndexedDB, but not expected to matter at this pattern scale.

## Next step after this plan

Not scheduled into the numbered Phase Plan (Phase 8 was the last scheduled phase) — this and the paste drag-placement plan are both standalone feature plans pulled from the Later/optional backlog and the user's direct feedback, implemented independently of each other.
