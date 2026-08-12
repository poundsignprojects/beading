import { cellKey, setCell } from '../state/cellStore.js';
import { peyoteNeighbors } from '../grid/peyote.js';

// Flood fill from (startRow, startCol): every physically-connected cell matching
// the seed's state (same colorId, including "absent" as its own matchable state)
// gets set to colorId. Filling into absent cells is a shape change — identical in
// kind to what drawTool.js already does for a single cell, just propagated across
// a region — so it needs no special handling anywhere else in the pipeline (not
// even colorwaySync.js: appState.cells is still just an ordinary Map being mutated).
// Iterative (not recursive) to avoid stack depth issues on a large contiguous region.
export function applyFill(cells, startRow, startCol, colorId, rows, cols) {
  const seed = cells.get(cellKey(startRow, startCol));
  const seedColorId = seed ? seed.colorId : undefined;
  if (seed && seed.colorId === colorId) return [];

  const visited = new Set();
  const queue = [[startRow, startCol]];
  const patch = [];
  while (queue.length > 0) {
    const [row, col] = queue.pop();
    const key = cellKey(row, col);
    if (visited.has(key)) continue;
    visited.add(key);

    const cell = cells.get(key);
    const matchesSeed = cell ? cell.colorId === seedColorId : seedColorId === undefined;
    if (!matchesSeed) continue;

    patch.push({ row, col, before: cell, after: { colorId } });
    setCell(cells, row, col, colorId);

    for (const [nRow, nCol] of peyoteNeighbors(row, col, rows)) {
      if (nRow < 0 || nRow >= rows || nCol < 0 || nCol >= cols) continue;
      if (!visited.has(cellKey(nRow, nCol))) queue.push([nRow, nCol]);
    }
  }
  return patch;
}
