import { cellKey, setCell, clearCell } from '../state/cellStore.js';

// The exact cells being picked up for a move — every occupied cell in
// `baseCells` within `bounds` (the active selection), or, when `bounds` is
// null (no selection — see the Move tool's "move the whole layer" case),
// every occupied cell in baseCells at all. Deliberately doesn't scan a
// rectangular bounds cell-by-cell for the no-selection case: most of a sparse
// pattern's grid is empty, so a whole-layer move only ever touches cells that
// are actually occupied. Computed once per drag (bounds/baseCells never
// change mid-drag, only the delta does).
export function collectMovingEntries(baseCells, bounds) {
  const entries = [];
  if (bounds) {
    const { rowStart, rowEnd, colStart, colEnd } = bounds;
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        if (baseCells.has(cellKey(row, col))) entries.push([row, col]);
      }
    }
  } else {
    for (const key of baseCells.keys()) {
      const [row, col] = key.split(',').map(Number);
      entries.push([row, col]);
    }
  }
  return entries;
}

// Moves `movingEntries` (see collectMovingEntries) by (deltaRow, deltaCol)
// against the pristine `baseCells` snapshot, writing the result into the live
// `cells` Map — front semantics, the moved content always wins wherever it
// lands (matches applyPaste's default). A destination outside
// [0,rows)x[0,cols) is dropped, same "clip what doesn't fit" rule applyPaste
// already uses.
//
// `touchedKeys` is a Set the caller creates once per drag (starting empty)
// and passes into every call — mutated in place, accumulating every cell key
// this call OR any earlier call in the same drag has touched. That history is
// what gets reset to baseline before applying the new delta, which is what
// makes repeated calls at different deltas safe: resetting only this call's
// own footprint would leave behind whatever an earlier, larger delta wrote
// somewhere outside it (e.g. a drag that swings out to a large offset and
// back leaves a stale copy far from the final position if only the final
// call's own footprint were cleaned up).
//
// Returns the full patch — every touched cell whose final value differs from
// baseCells — so the caller only pushes history once, at drag end, not once
// per frame.
export function applyMove(cells, baseCells, movingEntries, deltaRow, deltaCol, rows, cols, touchedKeys) {
  for (const [row, col] of movingEntries) {
    touchedKeys.add(cellKey(row, col));
    touchedKeys.add(cellKey(row + deltaRow, col + deltaCol));
  }

  // Reset every cell this drag has ever touched back to its pristine baseline.
  for (const key of touchedKeys) {
    const [row, col] = key.split(',').map(Number);
    const base = baseCells.get(key);
    if (base) setCell(cells, row, col, base.colorId);
    else clearCell(cells, row, col);
  }
  // Pick up the source cells...
  for (const [row, col] of movingEntries) {
    clearCell(cells, row, col);
  }
  // ...and place them back shifted.
  for (const [row, col] of movingEntries) {
    const targetRow = row + deltaRow;
    const targetCol = col + deltaCol;
    if (targetRow < 0 || targetRow >= rows || targetCol < 0 || targetCol >= cols) continue;
    const base = baseCells.get(cellKey(row, col));
    setCell(cells, targetRow, targetCol, base.colorId);
  }

  const patch = [];
  for (const key of touchedKeys) {
    const [row, col] = key.split(',').map(Number);
    const before = baseCells.get(key);
    const after = cells.get(key);
    if (before?.colorId === after?.colorId) continue;
    patch.push({ row, col, before, after });
  }
  return patch;
}
