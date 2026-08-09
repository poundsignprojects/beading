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
