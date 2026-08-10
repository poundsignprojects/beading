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

// Applies the row/col offsets implied by the anchor choices to every existing
// cell, dropping any cell that lands outside the new [0,newRows)x[0,newCols)
// bounds — the only place cells are lost, and only for a dimension that shrank.
export function resizeCells(cells, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor) {
  const rowOffset = axisOffset(oldRows, newRows, rowAnchor);
  const colOffset = axisOffset(oldCols, newCols, colAnchor);
  const resized = new Map();
  for (const [key, value] of cells) {
    const { row, col } = remapKey(key, rowOffset, colOffset);
    if (row < 0 || row >= newRows || col < 0 || col >= newCols) continue;
    resized.set(`${row},${col}`, value);
  }
  return resized;
}

// Counts how many placed cells a given anchor combination would drop, without
// building the remapped Map — drives the resize dialog's live "this will remove
// N beads" warning as the user changes anchor choices.
export function countCellsLost(cells, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor) {
  const rowOffset = axisOffset(oldRows, newRows, rowAnchor);
  const colOffset = axisOffset(oldCols, newCols, colAnchor);
  let lost = 0;
  for (const key of cells.keys()) {
    const { row, col } = remapKey(key, rowOffset, colOffset);
    if (row < 0 || row >= newRows || col < 0 || col >= newCols) lost++;
  }
  return lost;
}
