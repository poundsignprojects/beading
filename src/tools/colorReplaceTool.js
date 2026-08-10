import { setCell } from '../state/cellStore.js';

// Replaces every cell in `cells` whose colorId matches sourceColorId with
// targetColorId — global across the whole active colorway, not scoped to a region
// (matches the plain meaning of "replace this color"; a selection-scoped variant
// is a possible later refinement, not needed for v1). Never touches absent cells —
// this is a recolor, not a shape change, unlike fill.
export function applyColorReplace(cells, sourceColorId, targetColorId) {
  if (sourceColorId === targetColorId) return [];
  const patch = [];
  for (const [key, cell] of cells) {
    if (cell.colorId !== sourceColorId) continue;
    const [row, col] = key.split(',').map(Number);
    patch.push({ row, col, before: cell, after: { colorId: targetColorId } });
    setCell(cells, row, col, targetColorId);
  }
  return patch;
}
