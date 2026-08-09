import { cellKey, setCell } from '../state/cellStore.js';

// Mutates cells in place (pure w.r.t. return value: no reads/writes outside the
// given Map). Returns the { row, col, before, after } diff so a caller can record
// it into a stroke's undo patch, or null if nothing changed (before === after) —
// null is falsy and the diff object is truthy, so existing `if (applyDrawAtCell(...))`
// callers keep working unchanged.
export function applyDrawAtCell(cells, row, col, colorId) {
  const before = cells.get(cellKey(row, col));
  if (before && before.colorId === colorId) return null;
  setCell(cells, row, col, colorId);
  return { row, col, before, after: { colorId } };
}
