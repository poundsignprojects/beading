// Rotates a design's placed cells (and everything keyed the same way — a
// colorway's persisted colorEntries, a shared-shape key list) by a multiple of
// 90°. Mirrors resizeGrid.js's shape and spirit, but with one real structural
// difference: peyote.js's isRaised() stagger rule is cosmetic only (its own
// comment: "it has no effect on which cell holds which color, only on the
// on-screen zigzag silhouette"), so a rotation of the cell *data* is a pure
// row/col index transform — it never needs to solve any "is this still
// stitchable" problem the way resizeGrid.js's compensatedStaggerFlipped does
// for a shift. Concretely: rotation is a bijection over the whole
// [0,rows)x[0,cols) domain, so unlike a resize/crop, nothing is ever dropped;
// and staggerFlipped is simply reset to a fresh default after a rotation
// rather than compensated for — there's no prior stagger registration to stay
// continuous with, since a rotation is a wholesale new set of coordinates, not
// a shift of the existing ones. See .work/feature-ruler-rotation-viewmode-
// datefix-plan.md §2 for the full derivation.

// direction: 'cw' | 'ccw' | '180'. 90°/270° swap which axis is which (a design
// that was wider than it was tall becomes taller than it is wide); 180° leaves
// dimensions unchanged.
export function rotatedDimensions(rows, cols, direction) {
  return direction === '180' ? { rows, cols } : { rows: cols, cols: rows };
}

// The one coordinate transform every rotation in this module (and
// cutCopyTool.js's rotateClipboard, over a clipboard's relative coordinates)
// is built from. `rows`/`cols` are the dimensions of the grid `row`/`col` are
// currently expressed against — i.e. the *pre*-rotation dimensions.
export function rotatedCoord(row, col, rows, cols, direction) {
  if (direction === 'cw') return { row: col, col: rows - 1 - row };
  if (direction === 'ccw') return { row: cols - 1 - col, col: row };
  return { row: rows - 1 - row, col: cols - 1 - col }; // '180'
}

function rotateKey(key, rows, cols, direction) {
  const [row, col] = key.split(',').map(Number);
  const rotated = rotatedCoord(row, col, rows, cols, direction);
  return `${rotated.row},${rotated.col}`;
}

// Generic remap over [key, value] pairs — shared by rotateCells (a Map,
// iterated as entries), rotateKeyList (a plain key array, value ignored), and
// rotateColorEntries (a design record's persisted [cellKey, colorId] pairs).
// Unlike resizeGrid.js's equivalent, nothing is ever dropped — a rotation is a
// bijection over the whole domain, so every entry always lands somewhere valid
// in the rotated dimensions.
function rotateEntries(entries, rows, cols, direction) {
  const result = [];
  for (const [key, value] of entries) {
    result.push([rotateKey(key, rows, cols, direction), value]);
  }
  return result;
}

export function rotateCells(cells, rows, cols, direction) {
  return new Map(rotateEntries(cells, rows, cols, direction));
}

// Rotates a design's shared-shape key list (Phase 6's shapeEntries) the same
// way rotateCells rotates a Map.
export function rotateKeyList(keys, rows, cols, direction) {
  const paired = keys.map((key) => [key, null]);
  return rotateEntries(paired, rows, cols, direction).map(([key]) => key);
}

// Rotates one colorway's persisted [cellKey, colorId] pairs — same coordinate
// transform applied to appState.cells, so a colorway's colors land at the same
// coordinates its cells would have, whether or not it's the currently active
// one.
export function rotateColorEntries(colorEntries, rows, cols, direction) {
  return rotateEntries(colorEntries, rows, cols, direction);
}

// In-place 180° rotation of a selection's own content, within its own
// unchanged W×H footprint. 180° is the one angle that never changes a
// footprint's dimensions (see rotatedDimensions), so — like mirrorTool.js's
// applyMirror — this can swap content between existing positions directly,
// rather than needing the copy→rotate→paste flow 90°/270° require when the
// selection isn't square. Reads the whole selection before writing any of it:
// a swap, not a sequence of independent writes, since two cells can be
// re-reading each other (an odd-sized selection has a center cell that maps
// to itself).
export function rotateSelection180(cells, selection) {
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  const rows = rowEnd - rowStart + 1;
  const cols = colEnd - colStart + 1;

  const before = new Map();
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      before.set(`${row},${col}`, cells.get(`${row},${col}`));
    }
  }

  const patch = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const key = `${row},${col}`;
      const local = rotatedCoord(row - rowStart, col - colStart, rows, cols, '180');
      const srcKey = `${local.row + rowStart},${local.col + colStart}`;
      const source = before.get(srcKey);
      const current = before.get(key);
      if (current === source) continue; // both absent, or (shouldn't happen) identical objects
      if (source && current && source.colorId === current.colorId) continue;
      patch.push({ row, col, before: current, after: source ? { colorId: source.colorId } : undefined });
      if (source) cells.set(key, { colorId: source.colorId });
      else cells.delete(key);
    }
  }
  return patch;
}
