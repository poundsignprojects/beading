import { cellKey, setCell } from '../state/cellStore.js';

// Mutates cells in place (pure w.r.t. return value: no reads/writes outside the
// given Map). Returns whether anything actually changed, so callers can skip a
// redraw when a drag re-enters an already-painted cell with the same color.
export function applyDrawAtCell(cells, row, col, colorId) {
  const existing = cells.get(cellKey(row, col));
  if (existing && existing.colorId === colorId) return false;
  setCell(cells, row, col, colorId);
  return true;
}
