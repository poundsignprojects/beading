// Pure functions over a cells Map<string, { colorId }>. String keys avoid any
// row/col-encoding collision risk that a numeric packing scheme would need to guard
// against, at negligible cost for a sparse, canvas-culled pattern (CLAUDE.md's
// "grid math and tool logic as pure functions" convention).

export function cellKey(row, col) {
  return `${row},${col}`;
}

export function setCell(cells, row, col, colorId) {
  cells.set(cellKey(row, col), { colorId });
}

export function clearCell(cells, row, col) {
  cells.delete(cellKey(row, col));
}

export function getCell(cells, row, col) {
  return cells.get(cellKey(row, col));
}
