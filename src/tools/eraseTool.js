import { cellKey, clearCell } from '../state/cellStore.js';

// Same shape as drawTool's applyDrawAtCell: mutates in place, returns the
// { row, col, before, after: undefined } diff, or null if the cell was already
// empty (null is falsy, the diff object is truthy — existing truthy/falsy
// callers keep working unchanged).
export function applyEraseAtCell(cells, row, col) {
  const before = cells.get(cellKey(row, col));
  if (!before) return null;
  clearCell(cells, row, col);
  return { row, col, before, after: undefined };
}
