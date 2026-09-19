import { cellKey } from '../state/cellStore.js';

// Two selection-producing variants of the same idea fillTool.js/colorReplaceTool.js
// already implement for mutation: instead of writing a new color, each collects the
// matched cells into a mask (Set<cellKey>) plus its bounding box, in the exact shape
// appState.selection already carries an optional `mask` field for (see
// .work/feature-lasso-select-plan.md, which worked out the same generalization for a
// polygon selection — cutCopyTool.js's buildClipboard/applyEraseRegion and
// selectionOverlay.js already respect `selection.mask` when present, so both wand
// variants get Copy/Cut/Paste/Rotate-90° for free with no further changes).

// Contiguous variant ("similar to the fill tool"): same iterative flood fill as
// fillTool.js's applyFill (same visited-set/seed-match/neighborsFn shape), but
// selects the matched region instead of recoloring it. A seed on an empty cell
// selects the contiguous empty region, matching fillTool's own willingness to fill
// empty space — there's no reason for the two "fill vs. select an area" tools to
// disagree about what counts as "one color."
export function selectWandContiguous(cells, startRow, startCol, rows, cols, neighborsFn) {
  const seed = cells.get(cellKey(startRow, startCol));
  const seedColorId = seed ? seed.colorId : undefined;

  const visited = new Set();
  const mask = new Set();
  const queue = [[startRow, startCol]];
  let rowStart = startRow;
  let rowEnd = startRow;
  let colStart = startCol;
  let colEnd = startCol;

  while (queue.length > 0) {
    const [row, col] = queue.pop();
    const key = cellKey(row, col);
    if (visited.has(key)) continue;
    visited.add(key);

    const cell = cells.get(key);
    const matchesSeed = cell ? cell.colorId === seedColorId : seedColorId === undefined;
    if (!matchesSeed) continue;

    mask.add(key);
    if (row < rowStart) rowStart = row;
    if (row > rowEnd) rowEnd = row;
    if (col < colStart) colStart = col;
    if (col > colEnd) colEnd = col;

    for (const [nRow, nCol] of neighborsFn(row, col)) {
      if (nRow < 0 || nRow >= rows || nCol < 0 || nCol >= cols) continue;
      if (!visited.has(cellKey(nRow, nCol))) queue.push([nRow, nCol]);
    }
  }

  return { rowStart, rowEnd, colStart, colEnd, mask };
}

// Global variant ("similar to the color replace tool"): same whole-cells scan as
// colorReplaceTool.js's applyColorReplace, but selects every matching cell instead
// of recoloring it — non-contiguous, anywhere in the design. colorId can be `null`
// (an occupied-but-unassigned colorway cell, see colorwaySync.js) as well as a real
// color id; the caller is responsible for not calling this with an empty seed cell's
// undefined "color" (there's no sparse-map entry for empty cells to match against),
// same guard colorReplaceTool.js's own call site already applies.
export function selectWandGlobal(cells, colorId) {
  const mask = new Set();
  let rowStart = Infinity;
  let rowEnd = -Infinity;
  let colStart = Infinity;
  let colEnd = -Infinity;

  for (const [key, cell] of cells) {
    if (cell.colorId !== colorId) continue;
    mask.add(key);
    const [row, col] = key.split(',').map(Number);
    if (row < rowStart) rowStart = row;
    if (row > rowEnd) rowEnd = row;
    if (col < colStart) colStart = col;
    if (col > colEnd) colEnd = col;
  }

  if (mask.size === 0) return null;
  return { rowStart, rowEnd, colStart, colEnd, mask };
}
