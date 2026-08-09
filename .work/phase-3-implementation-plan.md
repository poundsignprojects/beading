# Phase 3 Implementation Plan — Undo/Redo

## Context

Phase 2 shipped draw and erase, both working directly against `appState.cells` with no history — an unwanted bead can only be fixed by erasing it by hand. Undo/redo was added to the feature list this session (project-brief.md, CLAUDE.md Decision #12) and slotted in as its own phase, ahead of Phase 4 (save/load + library), because it's core drawing-tool functionality tightly coupled to Phase 2's already-shipped draw/erase — not a lower-priority tool like fill or mirror (Phase 7).

This phase is built against **today's codebase**, not the Phase 4 plan's future structure. Phase 4 hasn't been implemented yet — `main.js` is still one file with a single in-memory `appState`, and `pointerRouter.js` still takes `cells` as a direct value (the `cells` → `getCells()` change is scoped to Phase 4, when designs start getting swapped; it stays out of this plan). Phase 4's plan already accounts for undo/redo existing before it runs — see "Forward-compat note for Phase 4" below.

No Phase 3 code is written yet.

## Decisions confirmed for this plan

- **The undo unit is a whole stroke, not a single cell.** Per Decision #9, a stroke can be a single tap or a multi-cell drag line. One Undo should remove everything the user just drew in one motion, not force them to tap Undo once per bead to walk back a line — that would make undo nearly useless for its main use case (un-doing a bad line). `pointerRouter.js` already has a well-defined stroke lifecycle (start on pointerdown, continue on pointermove, end on pointerup/cancel or a second-pointer abort) — history hooks into those exact boundaries rather than introducing a second notion of "stroke."
- **History stores diffs (patches), not full-grid snapshots.** A stroke typically touches tens to a few hundred cells; a pattern can have tens of thousands. Snapshotting the whole `cells` Map per stroke would make undo cost scale with pattern size instead of edit size — the same reasoning that made `cellStore`'s Map sparse-by-construction in Phase 2. A patch is `[{ row, col, before, after }, ...]` — `before`/`after` are each either `{ colorId }` or `undefined` (empty cell), directly consumable by `cellStore`'s existing `setCell`/`clearCell`.
- **A cell touched more than once in the same stroke gets exactly one patch entry**, not one per touch. Dragging back and forth over already-painted cells (easy to do, e.g. tracing over a line twice) is a real case, not an edge case — without deduping, undo would still end up correct if entries were unwound in strict reverse order, but it's simpler and smaller to just keep the *first* `before` and *latest* `after` per cell as the stroke progresses. This also means a committed patch's entries can be applied in **any order** (each key appears once), so `historyStore`'s undo/redo never has to reason about ordering within a patch — only which patch is next on the stack.
- **`applyDrawAtCell`/`applyEraseAtCell` change their return value from a plain boolean to `{ row, col, before, after } | null`.** This is the one interface change to already-shipped Phase 2 code. It's a widening, not a breaking change at existing call sites: `null` is falsy and the new object is truthy, so every existing `if (changed)` / `if (applyDrawAtCell(...))` check keeps working unchanged — only the two tool test files, which currently assert `=== true`/`=== false` directly, need updating to check truthiness or shape instead. Doing it here (rather than having `pointerRouter.js` separately re-read `cells.get()` before/after each call) avoids two places knowing how to compute a "before" value.
- **History is in-memory only — never persisted, never cleared by anything except a full pattern reset.** Undo/redo losing its stack on reload is standard behavior for drawing tools generally, and specifically avoids a real correctness trap here: a patch's `row`/`col` values are only meaningful against the grid geometry (`rows`/`cols`/`beadTypeKey`) they were recorded under. Regenerating the grid or hitting Clear already wipes `appState.cells` (with a `confirm()` guard, per Phase 2) — both must also wipe history at the same moment, or a later undo could replay coordinates from a discarded, differently-shaped grid onto the new one.
- **History depth is capped** (`MAX_HISTORY_DEPTH = 100`, a named constant in `historyStore.js`, not a magic number) — the oldest patch is dropped once the cap is exceeded. An unbounded stack over a long session on a large pattern has no natural ceiling; 100 strokes is generous for undo's actual use case (catching a recent mistake) without letting memory grow indefinitely.
- **Undo/redo are actions, not tools.** They don't join `appState.tool`'s draw/erase toggle group — they're one-shot buttons (same category as today's Clear button), not a mode you select and then interact with the canvas in.

## File-by-file breakdown

```
/src
  /state
    strokePatch.js         — NEW: pure accumulator for one in-progress stroke.
                              createStrokePatch() -> Map<key, {row,col,before,after}>;
                              recordCellChange(patch, row, col, before, after) — first
                              touch of a key sets before, every touch updates after;
                              strokePatchToArray(patch) -> [{row,col,before,after}, ...]
    historyStore.js          — NEW: createHistory() -> {undoStack:[], redoStack:[]};
                              pushPatch(history, patchArray) — no-ops on an empty array,
                              clears redoStack, caps undoStack at MAX_HISTORY_DEPTH;
                              undo(history, cells) / redo(history, cells) — pop a patch,
                              apply before/after values via cellStore's setCell/clearCell,
                              push onto the other stack, return whether anything happened;
                              canUndo(history) / canRedo(history); clearHistory(history)

  /tools
    drawTool.js              — MODIFY: applyDrawAtCell returns {row,col,before,after}
                                (before is whatever cells.get() held, possibly undefined)
                                instead of true, or null instead of false
    eraseTool.js              — MODIFY: applyEraseAtCell returns {row,col,before,after:
                                undefined} or null, same pattern

  /interaction
    pointerRouter.js          — MODIFY: drawStroke gains a `patch` field
                                (createStrokePatch()); applyToolAtWorld records each
                                changed cell into it via recordCellChange instead of just
                                returning a boolean; both stroke-end paths (pointerup/
                                cancel via handlePointerEnd, and the second-pointer-abort
                                branch in handlePointerDown) route through one
                                commitStroke() helper that calls the new onStrokeCommitted
                                callback with strokePatchToArray(patch), only if non-empty

  /test
    state/strokePatch.test.js   — NEW
    state/historyStore.test.js  — NEW
    tools/drawTool.test.js       — MODIFY existing cases for the new return shape
    tools/eraseTool.test.js      — MODIFY existing cases for the new return shape

main.js                      — appState gains `history: createHistory()`; new
                                #undo-button/#redo-button wired to historyStore.undo/redo
                                + scheduleRedraw + button-state refresh; Cmd/Ctrl+Z and
                                Cmd/Ctrl+Shift+Z keyboard shortcuts (ignored while an
                                <input> is focused, so they don't hijack normal text-field
                                undo in the rows/cols fields); regenerateGrid() and the
                                Clear handler both call clearHistory(appState.history);
                                attachPointerRouter(...) gains onStrokeCommitted
index.html                    — add #undo-button / #redo-button next to #clear-pattern
style.css                     — disabled-button styling for undo/redo (native `disabled`,
                                not the aria-pressed pattern used for the draw/erase
                                toggle — these are one-shot actions, not a selected mode)
```

## History data model

```js
// A committed patch: array of per-cell diffs, order-independent (see dedupe decision above)
// [{ row, col, before: {colorId} | undefined, after: {colorId} | undefined }, ...]

// src/state/strokePatch.js
export function createStrokePatch() {
  return new Map();
}

export function recordCellChange(strokePatch, row, col, before, after) {
  const key = `${row},${col}`;
  const existing = strokePatch.get(key);
  if (existing) {
    existing.after = after;
  } else {
    strokePatch.set(key, { row, col, before, after });
  }
}

export function strokePatchToArray(strokePatch) {
  return Array.from(strokePatch.values());
}
```

```js
// src/state/historyStore.js
import { setCell, clearCell } from './cellStore.js';

const MAX_HISTORY_DEPTH = 100;

export function createHistory() {
  return { undoStack: [], redoStack: [] };
}

export function pushPatch(history, patch) {
  if (patch.length === 0) return false;
  history.undoStack.push(patch);
  if (history.undoStack.length > MAX_HISTORY_DEPTH) history.undoStack.shift();
  history.redoStack.length = 0;
  return true;
}

export function canUndo(history) {
  return history.undoStack.length > 0;
}

export function canRedo(history) {
  return history.redoStack.length > 0;
}

function applyPatch(patch, cells, key) {
  for (const entry of patch) {
    const value = entry[key]; // 'before' or 'after'
    if (value === undefined) clearCell(cells, entry.row, entry.col);
    else setCell(cells, entry.row, entry.col, value.colorId);
  }
}

export function undo(history, cells) {
  const patch = history.undoStack.pop();
  if (!patch) return false;
  applyPatch(patch, cells, 'before');
  history.redoStack.push(patch);
  return true;
}

export function redo(history, cells) {
  const patch = history.redoStack.pop();
  if (!patch) return false;
  applyPatch(patch, cells, 'after');
  history.undoStack.push(patch);
  return true;
}

export function clearHistory(history) {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
```

All pure with respect to `history` and `cells` passed in explicitly — no module-level state, consistent with `cellStore.js`/`drawTool.js`/`eraseTool.js`.

## Tool return-shape change

```js
// src/tools/drawTool.js
import { cellKey, setCell } from '../state/cellStore.js';

export function applyDrawAtCell(cells, row, col, colorId) {
  const before = cells.get(cellKey(row, col));
  if (before && before.colorId === colorId) return null;
  setCell(cells, row, col, colorId);
  return { row, col, before, after: { colorId } };
}

// src/tools/eraseTool.js
import { cellKey, clearCell } from '../state/cellStore.js';

export function applyEraseAtCell(cells, row, col) {
  const before = cells.get(cellKey(row, col));
  if (!before) return null;
  clearCell(cells, row, col);
  return { row, col, before, after: undefined };
}
```

## Pointer router changes

`pointerRouter.js` already tracks a `drawStroke` variable across a stroke's lifetime (Phase 2). It gains a `patch` field and records into it on every changed cell:

```js
function applyToolAtWorld(worldPoint, strokePatch) {
  const gridParams = getGridParams();
  if (!gridParams) return false;
  const hit = peyoteCellAtPoint(
    worldPoint.xMm, worldPoint.yMm,
    gridParams.beadWidthMm, gridParams.beadHeightMm,
    gridParams.rows, gridParams.cols
  );
  if (!hit) return false;
  const result = getTool() === 'erase'
    ? applyEraseAtCell(cells, hit.row, hit.col)
    : applyDrawAtCell(cells, hit.row, hit.col, getColorId());
  if (!result) return false;
  recordCellChange(strokePatch, result.row, result.col, result.before, result.after);
  return true;
}
```

`startDrawStroke` creates `drawStroke = { pointerId, lastWorld, patch: createStrokePatch() }`; `continueDrawStroke` threads `drawStroke.patch` through. Both places a stroke can end — `handlePointerEnd` (normal pointerup/cancel) and the second-pointer-lands-mid-stroke branch in `handlePointerDown` (Phase 2's abort-to-pan-zoom case, where cells already drawn before the abort must still be undo-able) — call one new `commitStroke()` helper:

```js
function commitStroke() {
  if (!drawStroke) return;
  const patch = strokePatchToArray(drawStroke.patch);
  if (patch.length > 0) onStrokeCommitted(patch);
  drawStroke = null;
}
```

replacing the two places that currently just set `drawStroke = null` directly. `attachPointerRouter`'s options gain `onStrokeCommitted` alongside the existing `onCellsChanged`/`onViewportChange` callbacks — `onCellsChanged` still fires per-move for live redraw feedback during the drag; `onStrokeCommitted` fires once, at the end, for history. Different cadences, both needed.

## Wiring in main.js

```js
appState.history = createHistory();

function updateHistoryButtons() {
  undoButton.disabled = !canUndo(appState.history);
  redoButton.disabled = !canRedo(appState.history);
}

undoButton.addEventListener('click', () => {
  if (undo(appState.history, appState.cells)) {
    scheduleRedraw();
    updateHistoryButtons();
  }
});
redoButton.addEventListener('click', () => {
  if (redo(appState.history, appState.cells)) {
    scheduleRedraw();
    updateHistoryButtons();
  }
});

window.addEventListener('keydown', (e) => {
  const isTextInput = document.activeElement?.tagName === 'INPUT';
  if (isTextInput || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  const applied = e.shiftKey
    ? redo(appState.history, appState.cells)
    : undo(appState.history, appState.cells);
  if (applied) {
    scheduleRedraw();
    updateHistoryButtons();
  }
});
```

`regenerateGrid()` and the Clear button handler each gain `clearHistory(appState.history); updateHistoryButtons();` right next to their existing `appState.cells.clear()`. `attachPointerRouter(...)`'s options gain:

```js
onStrokeCommitted: (patch) => {
  if (pushPatch(appState.history, patch)) updateHistoryButtons();
},
```

`updateHistoryButtons()` also runs once at boot, so both buttons render disabled before anything's drawn.

## Build order + verification

1. **`strokePatch.js`** + test. *Verify* (`node --test`): recording the same key twice keeps the first `before` and the latest `after`; `strokePatchToArray` returns one entry per unique key touched.
2. **`historyStore.js`** + test. *Verify* (`node --test`): `pushPatch` no-ops on `[]`, clears `redoStack` on every push, drops the oldest entry once `MAX_HISTORY_DEPTH` is exceeded (push 101 single-entry patches, confirm the 1st is no longer reachable via undo); `undo`/`redo` correctly restore a sample `cells` Map for both "cell was empty before" (delete on undo) and "cell had a different color before" (restore that color) cases; `canUndo`/`canRedo` track stack emptiness; `clearHistory` empties both stacks.
3. **`drawTool.js`/`eraseTool.js`** return-shape change + updated tests. *Verify* (`node --test`): draw-on-empty returns `{before: undefined, after: {colorId}}`; draw-same-color returns `null`; draw-different-color returns the correct before/after pair; erase-on-empty returns `null`; erase-on-set returns `{before: {colorId}, after: undefined}`.
4. **`pointerRouter.js`**: stroke-patch accumulation, `commitStroke()`, `onStrokeCommitted`. *Verify on Mac first* (manual, same harness as Phase 2): a single tap commits a one-entry patch; a drag line commits one patch covering every cell in the line; a second finger landing mid-stroke still commits the partial patch drawn so far.
5. **Wire `main.js`**: history state, Undo/Redo buttons, keyboard shortcuts, `clearHistory` on regenerate/Clear. *Verify*: buttons start disabled; drawing enables Undo and leaves Redo disabled; Undo reverts the whole last stroke in one tap and enables Redo; Redo reapplies it and re-disables itself if the stack is now empty; a new stroke after an Undo clears the Redo stack (Redo button goes back to disabled); regenerating or clearing the pattern disables both buttons even if history existed before.
6. **Correctness case — overlapping strokes**: scribble back and forth over the same handful of cells within a single continuous drag, release, tap Undo once — confirm the pattern returns exactly to its pre-stroke state in one step (the dedupe behavior from `strokePatch.js`, now proven end-to-end rather than just unit-tested in isolation).
7. **Keyboard shortcuts on Mac**: Cmd+Z undoes, Cmd+Shift+Z redoes, and — specifically — doing this while focus is inside the Rows or Cols number input does *not* trigger pattern undo (should behave as normal browser text-field undo instead, i.e. the app's handler no-ops and lets the input handle it natively).
8. **Real iPad pass**: Undo/Redo buttons are comfortably tappable with Pencil or finger; drawing a line, backgrounding Safari, returning, and tapping Undo still behaves correctly (history is in-memory per Decision above, so this is really confirming Safari didn't reload/reset the tab between backgrounding and return — if it did, that's expected data loss until Phase 4's autosave exists, not a Phase 3 bug).
9. **Edge cases**: undo past the very first stroke is a no-op, not an error (empty `undoStack`, button already disabled so this mainly guards against a stray keyboard shortcut); redo with nothing to redo, same; drawing on a very large grid (reuse Phase 1/2's 200×300 case) with a long dense stroke, confirm committing that one stroke's patch and undoing it stays fast (patch size scales with cells touched in the stroke, not grid size, per the diff-based design — this is the check that actually matters).

## Forward-compat note for Phase 4 (not part of this plan's scope)

Phase 4's already-written plan (`.work/phase-4-implementation-plan.md`) swaps `appState.cells` for a different design's Map on open/switch. When that's implemented, opening or switching a design must also call `clearHistory(appState.history)` — a stroke's patch coordinates are only meaningful against the design they were recorded under, same reasoning as the regenerate/Clear guard above. Noting it here so it isn't missed when Phase 4 is built; no Phase 4 file is being edited as part of this plan.
