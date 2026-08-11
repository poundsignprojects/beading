import { cellKey, setCell, clearCell } from '../state/cellStore.js';

// Reads every occupied cell within `selection`'s bounds into a clipboard object,
// coordinates relative to the selection's top-left corner. Absent cells inside the
// bounds are simply not listed — same sparse convention cellsToEntries already uses.
export function buildClipboard(cells, selection) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  const entries = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const cell = cells.get(cellKey(row, col));
      if (cell) entries.push([row - rowStart, col - colStart, cell.colorId]);
    }
  }
  return { rows: rowEnd - rowStart + 1, cols: colEnd - colStart + 1, cells: entries };
}

// The erase half of Cut — removes every occupied cell within selection's bounds,
// returning the patch so it's undo-able exactly like any other multi-cell action.
export function applyEraseRegion(cells, selection) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  const patch = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const key = cellKey(row, col);
      const before = cells.get(key);
      if (!before) continue;
      patch.push({ row, col, before, after: undefined });
      clearCell(cells, row, col);
    }
  }
  return patch;
}

// Stamps clipboard content anchored with its top-left at (anchorRow, anchorCol).
// Entries landing outside [0,rows)x[0,cols) are clipped, not shifted — same "drop
// what doesn't fit" rule resizeGrid.js's remapEntries already uses, so a paste
// stamped near an edge just doesn't fully land there.
//
// mode: 'front' (default, current behavior) overwrites whatever's already at each
// target cell; 'behind' leaves an already-occupied target cell untouched (existing
// bead wins) and only fills cells that are currently empty within the pasted
// footprint. Either way, a clipboard cell that was itself absent at copy time was
// never in clipboard.cells to begin with, so gaps *within* the footprint that the
// clipboard also had gaps at are never touched — unchanged from Phase 7.
export function applyPaste(cells, clipboard, anchorRow, anchorCol, rows, cols, mode = 'front') {
  const patch = [];
  for (const [relRow, relCol, colorId] of clipboard.cells) {
    const row = anchorRow + relRow;
    const col = anchorCol + relCol;
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
    const key = cellKey(row, col);
    const before = cells.get(key);
    if (mode === 'behind' && before) continue; // existing bead wins, pasted cell skipped
    if (before && before.colorId === colorId) continue; // no-op cell, skip
    patch.push({ row, col, before, after: { colorId } });
    setCell(cells, row, col, colorId);
  }
  return patch;
}
