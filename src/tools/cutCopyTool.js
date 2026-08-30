import { cellKey, setCell, clearCell } from '../state/cellStore.js';
import { rotatedDimensions, rotatedCoord } from '../state/rotateGrid.js';

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

// Rotates a clipboard's own relative-coordinate content by a multiple of 90° —
// same coordinate transform as rotateGrid.js's rotateCells, but over a
// clipboard's {rows, cols, cells: [[relRow, relCol, colorId], ...]} triples
// instead of a full design's Map, since a clipboard's cells aren't keyed
// strings. Used by selection rotation's 90°/270° path: rotating a non-square
// selection changes its footprint (H×W instead of W×H), which can't be
// stamped back in place the way rotateSelection180 can, so it's routed
// through this + the existing paste-preview flow instead (see
// .work/feature-ruler-rotation-viewmode-datefix-plan.md §2).
export function rotateClipboard(clipboard, direction) {
  const { rows, cols, cells } = clipboard;
  const rotatedCells = cells.map(([relRow, relCol, colorId]) => {
    const rotated = rotatedCoord(relRow, relCol, rows, cols, direction);
    return [rotated.row, rotated.col, colorId];
  });
  const { rows: newRows, cols: newCols } = rotatedDimensions(rows, cols, direction);
  return { rows: newRows, cols: newCols, cells: rotatedCells };
}
