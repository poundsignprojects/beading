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

// `context` (optional, {colorwayId, layerId}) records which layer/colorway this
// patch's row/col coordinates belong to, at the moment it was made — switching
// layers/colorways is itself never a history entry (see pushGeometryChange's own
// comment on "geometry"-kind entries below), so undo/redo needs this to know
// whether it must jump to a different layer/colorway before replaying the patch.
// The caller (editorView.js) is responsible for doing that jump; this module only
// records/exposes the context, it never switches anything itself.
export function pushPatch(history, patch, context = null) {
  if (patch.length === 0) return false;
  history.undoStack.push({ kind: 'patch', patch, context });
  if (history.undoStack.length > MAX_HISTORY_DEPTH) history.undoStack.shift();
  history.redoStack.length = 0;
  return true;
}

// A geometry change (resize/crop/rotate) touches more than individual cell colors
// — grid dimensions, per-design stagger, and every colorway's colors all move
// together — so it can't be expressed as a cell-patch array the way a stroke can.
// Also reused for a layer/colorway CREATE or DELETE (a whole-state view snapshot,
// not just cell colors) — both are pushed onto the SAME stack as ordinary patches
// (an entry here is a plain object tagged 'geometry', a patch entry is tagged
// 'patch' — undo/redo below tell them apart by that), so undo/redo replay every
// kind of action in one true chronological order rather than treating a resize (or
// a layer/colorway create/delete) as a wall that clears everything before it.
// `before`/`after` are whatever shape the caller's own `apply` function
// understands (this module has no opinion on it — editorView.js's own snapshot
// shapes live entirely in its own callers, not here); `apply` is called with
// `before` on undo and `after` on redo. Unlike a patch entry, a geometry entry
// needs no separate layer/colorway "jump" step before it's replayed — applying it
// already sets whichever layer/colorway is active as part of what it restores
// (see editorView.js's commitGeometrySnapshot/commitViewSnapshot).
export function pushGeometryChange(history, before, after, apply) {
  history.undoStack.push({ kind: 'geometry', before, after, apply });
  if (history.undoStack.length > MAX_HISTORY_DEPTH) history.undoStack.shift();
  history.redoStack.length = 0;
}

export function canUndo(history) {
  return history.undoStack.length > 0;
}

export function canRedo(history) {
  return history.redoStack.length > 0;
}

// The layer/colorway context (if any) the entry about to be undone/redone
// belongs to — lets a caller switch to the right layer/colorway BEFORE calling
// undo()/redo(), without that switch itself becoming a separate history entry.
// Returns null for a geometry entry (no jump needed — see pushGeometryChange's
// comment) or an empty stack.
export function peekUndoContext(history) {
  const entry = history.undoStack[history.undoStack.length - 1];
  return entry && entry.kind === 'patch' ? entry.context : null;
}

export function peekRedoContext(history) {
  const entry = history.redoStack[history.redoStack.length - 1];
  return entry && entry.kind === 'patch' ? entry.context : null;
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
  if (entry.kind === 'geometry') entry.apply(entry.before);
  else applyPatch(entry.patch, cells, 'before');
  history.redoStack.push(entry);
  return true;
}

export function redo(history, cells) {
  const entry = history.redoStack.pop();
  if (!entry) return false;
  if (entry.kind === 'geometry') entry.apply(entry.after);
  else applyPatch(entry.patch, cells, 'after');
  history.undoStack.push(entry);
  return true;
}

export function clearHistory(history) {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
