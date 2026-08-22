import { cellKey, setCell, clearCell } from '../state/cellStore.js';

function flippedCoord(row, col, selection, axis) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  return axis === 'horizontal'
    ? { row, col: colStart + colEnd - col }
    : { row: rowStart + rowEnd - row, col };
}

// axis: 'horizontal' | 'vertical'. Caller must not invoke 'horizontal' on an
// even-width selection — reversing col order changes which cells land on which
// side of isRaised's col-parity stagger rule (see peyote.js), so an even-width
// flip lands content at the wrong physical stagger. 'vertical' has no such
// constraint: isRaised depends only on col, never on row, so reversing row order
// never changes any cell's stagger. Enforced at the UI layer by disabling the
// button, not re-checked here, since this function has no way to produce a
// *correct* result for an even-width horizontal flip, only a silently wrong one.
export function applyMirror(cells, selection, axis) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  // Read every cell's current value before writing any of them — a swap, not a
  // sequence of independent writes, since two cells can be re-reading each other.
  const before = new Map();
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      before.set(cellKey(row, col), cells.get(cellKey(row, col)));
    }
  }

  const patch = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const key = cellKey(row, col);
      const { row: srcRow, col: srcCol } = flippedCoord(row, col, selection, axis);
      const source = before.get(cellKey(srcRow, srcCol));
      const current = before.get(key);
      if (current === source) continue; // both absent, or (shouldn't happen) identical objects
      if (source && current && source.colorId === current.colorId) continue;
      patch.push({ row, col, before: current, after: source ? { colorId: source.colorId } : undefined });
      if (source) setCell(cells, row, col, source.colorId);
      else clearCell(cells, row, col);
    }
  }
  return patch;
}
