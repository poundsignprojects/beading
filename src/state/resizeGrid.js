// Remaps a design's placed cells when rows/cols change, so growing or shrinking
// the grid doesn't require discarding the existing pattern. `anchor` controls which
// side absorbs the change for one axis:
//   'start' — existing content stays pinned to index 0; the change happens at the
//             end (bottom row index / right col index).
//   'end'   — existing content stays pinned to the last index; the change happens
//             at the start (top row index / left col index).
//   'both'  — split across both ends; an odd unit (growing or shrinking) goes to
//             the 'end' side.
function axisOffset(oldCount, newCount, anchor) {
  const delta = newCount - oldCount;
  if (anchor === 'start') return 0;
  if (anchor === 'end') return delta;
  return Math.floor(delta / 2);
}

function remapKey(key, rowOffset, colOffset) {
  const [row, col] = key.split(',').map(Number);
  return { row: row + rowOffset, col: col + colOffset };
}

// Generic remap over [key, value] pairs — shared by resizeCells (a Map, iterated as
// entries), resizeKeyList (a plain key array, value ignored), and resizeColorEntries
// (a design record's persisted [cellKey, colorId] pairs). Drops any pair whose
// remapped key lands outside the new [0,newRows)x[0,newCols) bounds — the only
// place entries are lost, and only for a dimension that shrank.
function remapEntries(entries, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor) {
  const rowOffset = axisOffset(oldRows, newRows, rowAnchor);
  const colOffset = axisOffset(oldCols, newCols, colAnchor);
  const result = [];
  for (const [key, value] of entries) {
    const { row, col } = remapKey(key, rowOffset, colOffset);
    if (row < 0 || row >= newRows || col < 0 || col >= newCols) continue;
    result.push([`${row},${col}`, value]);
  }
  return result;
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
