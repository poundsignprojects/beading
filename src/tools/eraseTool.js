import { cellKey, clearCell } from '../state/cellStore.js';

// Same shape as drawTool's applyDrawAtCell: mutates in place, returns whether
// anything changed so a drag re-entering already-empty cells skips a redraw.
export function applyEraseAtCell(cells, row, col) {
  if (!cells.has(cellKey(row, col))) return false;
  clearCell(cells, row, col);
  return true;
}
