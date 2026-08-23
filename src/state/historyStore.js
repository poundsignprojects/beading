// Undo/redo over committed stroke patches. In-memory only, never persisted (a
// patch's row/col values are only meaningful against the grid geometry they were
// recorded under — see CLAUDE.md Phase 3 status / the Phase 3 plan's clearHistory
// guard). Pure with respect to the history/cells passed in, consistent with
// cellStore.js/drawTool.js/eraseTool.js.

import { setCell, clearCell } from './cellStore.js';

// Generous for undo's actual use case (catching a recent mistake) without letting
// an unbounded stack grow over a long session.
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

// A geometry change (resize/crop) touches more than individual cell colors — grid
// dimensions, per-design stagger, and every colorway's colors all move together —
// so it can't be expressed as a cell-patch array the way a stroke can. Pushed onto
// the SAME stack as ordinary patches (an entry here is a plain object, a patch
// entry is a plain array — undo/redo below tell them apart by that), so undo/redo
// replay both kinds of action in one true chronological order rather than treating
// a resize as a wall that clears everything before it. `before`/`after` are
// whatever shape the caller's own `apply` function understands (this module has no
// opinion on it — editorView.js's own snapshot shape lives entirely in main.js's
// caller, not here); `apply` is called with `before` on undo and `after` on redo.
export function pushGeometryChange(history, before, after, apply) {
  history.undoStack.push({ isGeometry: true, before, after, apply });
  if (history.undoStack.length > MAX_HISTORY_DEPTH) history.undoStack.shift();
  history.redoStack.length = 0;
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
  const entry = history.undoStack.pop();
  if (!entry) return false;
  if (entry.isGeometry) entry.apply(entry.before);
  else applyPatch(entry, cells, 'before');
  history.redoStack.push(entry);
  return true;
}

export function redo(history, cells) {
  const entry = history.redoStack.pop();
  if (!entry) return false;
  if (entry.isGeometry) entry.apply(entry.after);
  else applyPatch(entry, cells, 'after');
  history.undoStack.push(entry);
  return true;
}

export function clearHistory(history) {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
