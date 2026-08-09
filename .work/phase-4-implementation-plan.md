# Phase 4 Implementation Plan — Save/Load + Project Library

## Context

Phases 1–2 built a peyote grid engine and draw/erase tools, but the app still holds exactly one pattern in memory — there is no persistence, no library, and no concept of "a design" as a distinct saved thing. Per CLAUDE.md's phase plan, Phase 4 is: "Autosave to IndexedDB, reorderable design list (manual ordering), global persistent preferences (fixes prior-app pain point #1 and #2)."

(This was originally planned and written as Phase 3, before undo/redo was inserted as its own Phase 3 ahead of it — see CLAUDE.md's Phase Plan and Decision #12. This document has been renumbered accordingly; no content changed beyond phase references.)

This phase is a different kind of work than Phases 1–2. Those were pure grid/tool math with a thin UI on top; this one is data modeling, async storage, and a second application view — closer to "small app" territory than "canvas renderer." It directly addresses four of the five prior-app pain points from project-brief.md:

- **#1 (preferences don't persist)** — a global preferences record, not per-design settings.
- **#2 (no control over design order)** — a reorderable library list.
- **#4 (easy to lose state)** — autosave, no manual save step, no "duplicate before experimenting" ritual.
- **#5 (too many taps to close a design)** — a real library view to return to, one tap away, at all times.

(Pain point #3, colorways, is Phase 6 — out of scope here. See "Scope boundary" below.)

No Phase 4 code is written yet.

## Decisions confirmed for this plan

- **Only `id`, `name`, `beadTypeKey`, `rows`, `cols`, `cellEntries`, `order`, `createdAt`, `updatedAt` are persisted per design.** `gridParams` and `viewport` are not stored — they're already derived from `rows`/`cols`/`beadTypeKey` via `generatePeyoteGrid` and `fitViewportToGrid` today, and opening a saved design re-derives them the same way. Storing derived data would just create a second source of truth to keep in sync.
- **Cells are stored as a plain array of `[key, { colorId }]` entries, not a `Map`.** IndexedDB's structured-clone algorithm *can* store a `Map` directly, but Decision #5 (CLAUDE.md) already commits to a future JSON export/import — a `Map` doesn't round-trip through `JSON.stringify`. Storing entries now means export/import later is a data-only change, not a storage-format migration. `cellStore.js` gains `cellsToEntries`/`entriesToCells` as the single place that shape conversion happens.
- **Units, default bead type, and default rows/cols are global preferences — not per-design fields.** This is the direct fix for pain point #1: "grid/tool preferences" resetting per-file is the specific complaint, so those values live in one `preferences` record, not on each design.
- **No dedicated "Preferences" screen for v1.** Whenever the editor's bead-type/rows/cols controls are confirmed (i.e. `regenerateGrid` runs) or units are toggled, those values are *also* written back to the global preferences record as the new defaults for the *next new design*. This satisfies pain point #1 with zero new UI — the alternative (a separate settings screen you have to remember to visit) is more surface area for the same outcome. Revisit only if it proves confusing in practice.
- **Design ordering uses fractional sort keys (`order: number`), not array position.** Dropping a design between two others computes `order = (before.order + after.order) / 2`; dropping at either end uses `neighbor.order ± 1`. This means a drag-reorder only ever writes the *one* moved record, never renumbers the whole list — simpler and cheaper than maintaining dense integer positions. (At personal-library scale — tens of designs, not thousands of reorders — float precision is not a real concern.)
- **"Duplicate as new design" is in scope for this phase**, even though CLAUDE.md's one-line Phase 4 summary doesn't name it. It's explicitly requested in project-brief.md ("a duplicate as new design option should still exist for true forks"), and once design CRUD + a list UI exist, it's a small addition (copy the record, new id, independent `cellEntries`) — same reasoning as Phase 2 adding a Clear button beyond its one-line summary. **This is not a colorway.** A duplicate is a fully independent record (new cells, no shared state); a colorway (Phase 6) is the same grid with a swappable palette pointer. Worth stating plainly now so the two don't get conflated when Phase 6 arrives.
- **The app always boots into the library view**, never straight into an editor / never auto-resuming the last-open design. See "Open questions" — this is my recommendation, not yet locked in.
- **`pointerRouter.js`'s `cells` parameter becomes `getCells()`.** Today `attachPointerRouter` is called once, at boot, and closes over the single `appState.cells` Map by value. Once designs can be switched, `appState.cells` gets reassigned to a *different* Map on every design open — but the router's closure would keep writing into the old, discarded one, silently losing every stroke on any design after the first. `getGridParams`, `getTool`, and `getColorId` are already getters for exactly this reason (fresh value per event); `cells` needs to join them. One-line signature change, called out here because it's a real correctness bug, not a style nit.

## Scope boundary

Not in this phase: undo/redo (Phase 3 — built ahead of this one), colorways (Phase 6), photo trace overlay, fill/color-replace/cut/copy/mirror (Phase 7), print/export (Phase 5), any real backup/cloud sync (Decision #5 — later). Autosave here is local IndexedDB only, same single-browser-instance limitation project-brief.md already flags as not an acceptable *end* state — Phase 4 doesn't change that, it just stops losing data *within* that instance.

## File-by-file breakdown

```
/src
  /storage
    db.js                 — NEW: generic IndexedDB promise wrapper. openDatabase() creates
                             schema v1 (object stores "designs" keyPath 'id', "preferences"
                             keyPath 'id'); get/put/getAll/del helpers wrap IDBRequest in
                             promises. No design- or preference-shaped logic here.
    designStore.js         — NEW: design-record CRUD on db.js — listDesignsSorted (by
                             `order`), createDesign, saveDesign (bumps updatedAt),
                             deleteDesign, duplicateDesign
    preferencesStore.js    — NEW: getPreferences (returns built-in defaults if none saved
                             yet), savePreferences
    debounce.js            — NEW: debounce(fn, delayMs) returning a debounced function with
                             a .flush() that invokes immediately using the last pending args

  /state
    cellStore.js            — ADD: cellsToEntries(cells) / entriesToCells(entries) —
                               Map <-> plain array, the only place this shape conversion
                               happens (also sets up Decision #5's future JSON export)
    designOrder.js           — NEW: orderForInsertAt(sortedList, targetIndex) — pure
                               fractional-order calculation for drag-reorder
    appState.js               — NEW: createAppState() factory, lifted out of main.js's
                               inline object literal (flagged as a future extraction in
                               Phase 2's main.js comment — this is that trigger). Now
                               spans view state (which screen), the open IndexedDB handle,
                               preferences, the in-memory design list, current design id,
                               plus the existing per-design/editor fields.

  /ui
    libraryView.js            — NEW: renders the design list into #library-view — name,
                                 relative "updated" time, drag handle, duplicate/rename/
                                 delete icon buttons, a "+ New" button. Owns pointer-based
                                 drag-reorder (mirrors pointerRouter.js's pointer-event
                                 style). Talks to main.js only through injected callbacks
                                 (onOpen, onCreate, onRename, onDuplicate, onDelete,
                                 onReorder) — never reaches into appState directly, per
                                 CLAUDE.md's "modules read/write through defined functions"
    editorView.js              — NEW: today's main.js grid/tool/palette/canvas wiring,
                                 lifted into mount()/unmount() so main.js can show/hide it.
                                 Adds a "Back to Library" control that flushes any pending
                                 autosave, then hands control back to main.js.

  /test
    state/cellStore.test.js     — ADD cellsToEntries/entriesToCells round-trip cases
    state/designOrder.test.js   — NEW
    storage/debounce.test.js    — NEW (node:test mock timers, no real IndexedDB/DOM needed)

main.js                      — shrinks to an app shell: open the DB, load preferences +
                                design list on boot, own the single appState instance,
                                wire library<->editor view switching, wire autosave
                                (debounced save on cell changes, immediate save on
                                regenerate/rename, flush on visibilitychange/pagehide and
                                on "Back to Library")
index.html                    — wrap existing controls/canvas in `#editor-view`; add a new
                                `#library-view` (list container + New button); both toggle
                                via a `hidden` attribute
style.css                     — library row layout, drag-handle affordance, in-progress-
                                drag visual state (dragged row offset + gap placeholder)
```

## Data model

```js
// IndexedDB store "designs", keyPath 'id'
{
  id: string,              // crypto.randomUUID()
  name: string,
  beadTypeKey: 'delica11' | 'rocaille11',
  rows: number,
  cols: number,
  cellEntries: [ ['row,col', { colorId: string }], ... ],  // see cellStore.cellsToEntries
  order: number,            // fractional sort key, see designOrder.js
  createdAt: number,        // epoch ms
  updatedAt: number,        // epoch ms
}

// IndexedDB store "preferences", keyPath 'id' — single row, id: 'global'
{
  id: 'global',
  units: 'mm' | 'in',
  defaultBeadTypeKey: 'delica11' | 'rocaille11',
  defaultRows: number,
  defaultCols: number,
}
```

Nothing about `gridParams` or `viewport` is stored — both are re-derived on load exactly as `regenerateGrid`/`fitViewportToGrid` already do today.

```js
// src/state/cellStore.js — additions
export function cellsToEntries(cells) {
  return Array.from(cells.entries());
}
export function entriesToCells(entries) {
  return new Map(entries);
}
```

## Storage layer

```js
// src/storage/db.js
const DB_NAME = 'bead-pattern-designer';
const DB_VERSION = 1;

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const store = db.transaction(storeName, mode).objectStore(storeName);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const getAll = (db, storeName) => run(db, storeName, 'readonly', (s) => s.getAll());
export const get = (db, storeName, key) => run(db, storeName, 'readonly', (s) => s.get(key));
export const put = (db, storeName, value) => run(db, storeName, 'readwrite', (s) => s.put(value));
export const del = (db, storeName, key) => run(db, storeName, 'readwrite', (s) => s.delete(key));
```

`designStore.js` and `preferencesStore.js` are both thin, shape-specific wrappers over these four primitives — no IndexedDB API surface leaks past `db.js`.

```js
// src/storage/debounce.js
export function debounce(fn, delayMs) {
  let timer = null;
  let pendingArgs = null;
  const invoke = () => {
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    fn(...args);
  };
  function debounced(...args) {
    pendingArgs = args;
    clearTimeout(timer);
    timer = setTimeout(invoke, delayMs);
  }
  debounced.flush = () => { if (timer) { clearTimeout(timer); invoke(); } };
  return debounced;
}
```

`flush()` replays the *last pending call's* args immediately — needed because the `visibilitychange`/`pagehide` handlers that call it don't have fresh args of their own; they just need "whatever was about to be saved, saved now."

## Autosave

Autosave writes go through one debounced function per open design (created on editor mount, discarded on unmount):

- **Cell changes** (`onCellsChanged`, already fired by `pointerRouter.js` per Phase 2) → debounced save (~800ms). A fast draw stroke fires this many times per second; without debouncing, every intermediate cell would trigger its own IndexedDB write.
- **Regenerate / rename** → immediate save (`flush()`), no debounce — these are already discrete, deliberate, already-confirmed actions, not a stream of small edits.
- **`visibilitychange` (document hidden) and `pagehide`** → immediate `flush()`. iPad Safari can suspend or discard a backgrounded tab; relying purely on the 800ms timer risks losing the last few edits if the user switches apps right after drawing. This is the one piece of autosave that's specifically about the iPad usage pattern, not just "debounce cell writes."
- **"Back to Library"** → immediate `flush()` before the view switches, so the library's "updated" timestamp is never stale by the debounce window.

## Ordering

```js
// src/state/designOrder.js
export function orderForInsertAt(sortedList, targetIndex) {
  if (sortedList.length === 0) return 0;
  if (targetIndex <= 0) return sortedList[0].order - 1;
  if (targetIndex >= sortedList.length) return sortedList[sortedList.length - 1].order + 1;
  return (sortedList[targetIndex - 1].order + sortedList[targetIndex].order) / 2;
}
```

`libraryView.js`'s drag handler computes the hovered target index from row bounding-rect midpoints (same pointer-tracking style as `pointerRouter.js`'s pinch/pan math — pointerdown on a drag-handle element, track `pointermove`, reorder the DOM live for feedback, commit on `pointerup`). On drop: compute `orderForInsertAt` against the list *excluding* the dragged item, `designStore.saveDesign` immediately (not debounced — a discrete drop, same category as regenerate/rename), re-render sorted by the new order.

## Library view

- Each row: name, relative "updated" label, drag handle, rename (pencil), duplicate, delete (trash, `confirm()`-guarded — consistent with the existing Clear/regenerate guards).
- "+ New" creates a design from current preference defaults (`defaultBeadTypeKey`/`defaultRows`/`defaultCols`), name `"Untitled Pattern"`, `order` past the current max, and opens it directly — no name-entry modal first. Renaming later is one tap away; requiring a name up front is exactly the kind of extra step project-brief.md's pain point #5 is about.
- Rename uses `window.prompt()`, consistent with the existing `window.confirm()` usage elsewhere — no need to introduce a custom modal component for this.
- Empty state (zero designs — fresh install, or a wiped DB) shows just the "+ New" button, no auto-created placeholder design.

## Build order + verification

1. **`db.js`** — generic CRUD primitives. *Verify*: Node has no native `indexedDB`, so this (like `canvasRenderer`/`pointerRouter` in prior phases) is verified in headless Chromium via Playwright, not `node --test`. Confirm both stores get created on first open, and put/get/getAll/delete round-trip.
2. **`designStore.js` + `preferencesStore.js`** on top of `db.js`. *Verify* (Playwright): create two designs, list comes back sorted by `order`; `saveDesign` bumps `updatedAt`; `duplicateDesign` produces an independent `cellEntries` array (mutate the original after duplicating, confirm the copy is unaffected); `deleteDesign` removes it; `getPreferences` returns built-in defaults when no row exists yet, then the saved row once one does.
3. **`cellStore.js` additions** + test. *Verify* (`node --test`): entries round-trip through `entriesToCells(cellsToEntries(cells))` for a sample cell set, key order doesn't matter to the result.
4. **`debounce.js`** + test. *Verify* (`node --test`, mock timers): rapid calls collapse to one invocation using the *last* call's args after the delay; `flush()` invokes immediately and cancels the pending timer; `flush()` with nothing pending is a no-op.
5. **`designOrder.js`** + test. *Verify* (`node --test`): insert at start/middle/end/empty-list all produce an order value that sorts correctly relative to its new neighbors.
6. **`appState.js`** — lift the current inline object out of `main.js` into `createAppState()`, no new behavior yet. *Verify*: Phase 1/2 behavior (draw/erase/pan/zoom on the one in-memory grid) is unchanged — a pure-refactor checkpoint before anything new lands on top.
7. **`pointerRouter.js`**: `cells` param → `getCells()`. *Verify*: same Phase 1/2 manual test pass still passes (this step should be behavior-invisible until step 9 makes `appState.cells` actually get reassigned).
8. **`index.html`/`style.css`**: wrap existing controls in `#editor-view`, add empty `#library-view`, no wiring. *Verify*: toggling `hidden` manually in devtools shows/hides correctly, no layout breakage.
9. **`editorView.js`**: lift the canvas/tool/palette wiring out of `main.js` into `mount()`/`unmount()`, add "Back to Library". *Verify*: identical behavior to step 6's checkpoint, now modularized and swappable.
10. **`libraryView.js`** (list + New/Open/Rename/Duplicate/Delete, no drag yet) wired into `main.js`'s view switch. *Verify*: create several designs, each opens the editor with the right bead type/rows/cols/cells restored; Back returns to a list reflecting the latest name/updated time; duplicate and delete behave correctly, including the delete confirm guard.
11. **Autosave wiring**: debounced save on cell changes, immediate save on regenerate/rename, flush on `visibilitychange`/`pagehide`/Back. *Verify*: draw a stroke, wait past 800ms, reload — cells persist. Draw a stroke and immediately dispatch `visibilitychange` (simulating backgrounding) without waiting — confirm the flush captured it.
12. **Preferences wiring**: regenerate and the units toggle also write the global preferences record. *Verify*: change bead type/rows/cols in the editor, go back, create a new design — it inherits the just-used values, not the original hardcoded defaults.
13. **Drag-to-reorder** in `libraryView.js`. *Verify* (Playwright synthetic pointer events first): drag three-plus designs into a specific new sequence, confirm the resulting order both renders correctly and survives a reload.
14. **Real iPad pass**: touch drag-reorder feels intentional (doesn't accidentally open a design when the user meant to drag it, and vice versa); New/Rename/Duplicate/Delete/Back are all comfortable with Pencil or finger; backgrounding Safari mid-stroke and returning doesn't lose the stroke; `confirm()`/`prompt()` dialogs behave as expected under iPad Safari.
15. **Edge cases**: deleting a design the list is currently rendering doesn't throw or leave a stale row; rapid Back→New→Back→New tapping doesn't race the debounce/flush logic into a lost or duplicated write; a library with enough designs to require scrolling still drag-reorders correctly at the scrolled edges.

## Open questions before implementation

1. **Boot behavior.** I'm recommending the app always lands on the library view on load/reload — never auto-resuming the last-open design. This keeps "closing" meaningfully well-defined (there's always a real place you're returning *to*) and matches project-brief.md's explicit ask for a library/gallery view as its own screen. The tradeoff: one extra tap to get back into whatever you were just doing, every time you reopen the app (e.g. after Safari reclaims the tab). If minimizing *that* is the more important convenience, the alternative is storing `lastOpenDesignId` in preferences and resuming straight into the editor on boot, falling back to the library only when there's no open design. Which do you want?

2. **Drag-reorder implementation depth.** The plan above builds real pointer-based drag-and-drop, matching project-brief.md's literal "drag-to-reorder" ask. It's also the single highest-effort, highest-risk piece of this phase — touch drag gestures are the kind of thing that reads fine in a plan and then feels wrong on a real iPad on the first try, and it's the one part of this phase that can't be fully de-risked without device time (step 14). The simpler alternative is per-row up/down move buttons: no gesture code, no drag-vs-tap disambiguation, fully satisfies "I choose the display order" from project-brief.md, just isn't literally a drag. My recommendation is still the real drag — it's the closer match to what was asked, and this app's whole reason for existing is fixing friction the prior app has, so it's worth the extra effort here specifically. But flagging the tradeoff since it's the most expensive line item in the plan.

## Next step after this plan

Once these are resolved, implementation follows the build order above. No code has been written for this phase yet.
