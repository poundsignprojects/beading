// Remaps a design's placed cells when rows/cols change, so growing or shrinking
// the grid doesn't require discarding the existing pattern. `anchor` controls which
// side absorbs the change for one axis:
//   'start' — existing content stays pinned to index 0; the change happens at the
//             end (bottom row index / right col index).
//   'end'   — existing content stays pinned to the last index; the change happens
//             at the start (top row index / left col index).
//   'both'  — split across both ends; an odd unit (growing or shrinking) goes to
//             the 'end' side.
export function axisOffset(oldCount, newCount, anchor) {
  const delta = newCount - oldCount;
  if (anchor === 'start') return 0;
  if (anchor === 'end') return delta;
  return Math.floor(delta / 2);
}

function remapKey(key, rowOffset, colOffset) {
  const [row, col] = key.split(',').map(Number);
  return { row: row + rowOffset, col: col + colOffset };
}

// Remaps [key, value] pairs by an explicit row/col offset, dropping any pair whose
// remapped key lands outside the new [0,newRows)x[0,newCols) bounds. The shared
// primitive underneath both the anchor-based remap (below) and the bounding-box
// crop (further below) — the only difference between them is how the offset is
// derived.
function remapEntriesByOffset(entries, rowOffset, colOffset, newRows, newCols) {
  const result = [];
  for (const [key, value] of entries) {
    const { row, col } = remapKey(key, rowOffset, colOffset);
    if (row < 0 || row >= newRows || col < 0 || col >= newCols) continue;
    result.push([`${row},${col}`, value]);
  }
  return result;
}

// Generic remap over [key, value] pairs — shared by resizeCells (a Map, iterated as
// entries), resizeKeyList (a plain key array, value ignored), and resizeColorEntries
// (a design record's persisted [cellKey, colorId] pairs). Drops any pair whose
// remapped key lands outside the new [0,newRows)x[0,newCols) bounds — the only
// place entries are lost, and only for a dimension that shrank.
function remapEntries(entries, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor) {
  const rowOffset = axisOffset(oldRows, newRows, rowAnchor);
  const colOffset = axisOffset(oldCols, newCols, colAnchor);
  return remapEntriesByOffset(entries, rowOffset, colOffset, newRows, newCols);
}

export function resizeCells(cells, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor) {
  return new Map(remapEntries(cells, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor));
}

// Counts how many placed cells a given anchor combination would drop, without
// building the remapped Map — drives the resize dialog's live "this will remove
// N beads" warning as the user changes anchor choices.
export function countCellsLost(cells, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor) {
  const survivors = remapEntries(cells, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor);
  return cells.size - survivors.length;
}

// Remaps a design's shared-shape key list (Phase 6's shapeEntries) the same way
// resizeCells remaps a Map — same anchor semantics, same drop rule.
export function resizeKeyList(keys, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor) {
  const paired = keys.map((key) => [key, null]);
  return remapEntries(paired, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor).map(([key]) => key);
}

// Remaps one colorway's persisted [cellKey, colorId] pairs — same anchor offsets
// applied to appState.cells, so a colorway's colors land at the same coordinates
// its cells would have, whether or not it's the currently active one.
export function resizeColorEntries(colorEntries, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor) {
  return remapEntries(colorEntries, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor);
}

// The smallest bounding box containing every occupied cell — the basis for "Crop
// to Design". `cells` is anything iterable as "row,col" keys (a Map's .keys(), or
// a plain key array). Returns null for an empty design — there's nothing to crop
// to, distinct from a design that's already cropped as tight as it can be.
export function boundingBoxForCells(cells) {
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  const keys = cells instanceof Map ? cells.keys() : cells;
  for (const key of keys) {
    const [row, col] = key.split(',').map(Number);
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }
  if (minRow === Infinity) return null;
  return { minRow, maxRow, minCol, maxCol, rows: maxRow - minRow + 1, cols: maxCol - minCol + 1 };
}

// Crops a cells Map to a bounding box from boundingBoxForCells. Unlike a manual
// resize, this never drops a cell — the box is derived from the cells themselves,
// so every one of them is guaranteed to land inside [0,box.rows)x[0,box.cols).
export function cropCells(cells, box) {
  return new Map(remapEntriesByOffset(cells, -box.minRow, -box.minCol, box.rows, box.cols));
}

// Crops one colorway's persisted [cellKey, colorId] pairs to the same bounding box
// applied to appState.cells — mirrors resizeColorEntries' relationship to resizeCells.
export function cropColorEntries(colorEntries, box) {
  return remapEntriesByOffset(colorEntries, -box.minRow, -box.minCol, box.rows, box.cols);
}

// peyote.js's isRaised() pins which parity is "raised" (offset 0) vs "recessed"
// (offset +half a bead-width) to a cell's own absolute col value — deliberately,
// so a resize/crop that doesn't shift a cell's col at all can't silently re-flip
// its look (see peyote.js's own comment). But shifting a cell's col by an ODD
// amount (a resize anchored 'end'/'both' on cols, or a crop whose bounding box
// doesn't start at col 0) changes that cell's absolute col parity even though
// its position *relative to its neighbors* hasn't changed at all — every column
// shifts together, so the shape is preserved, but every column's raised/recessed
// registration flips as one uniform unit, which reads as a real visual change
// (every other column jogs by half a bead). Toggling the per-design
// staggerFlipped constant by the same amount compensates: it cancels the parity
// flip the shift itself introduces, so shifted content keeps rendering with the
// exact raised/recessed look it had before the resize/crop. An even col shift
// needs no compensation (parity unaffected); only the shift's own parity matters,
// not its sign or magnitude.
export function compensatedStaggerFlipped(staggerFlipped, colOffset) {
  return Math.abs(colOffset) % 2 === 1 ? !staggerFlipped : staggerFlipped;
}
