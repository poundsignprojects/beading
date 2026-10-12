// Converts between a grid's bead counts (rows/cols) and its physical size in
// mm, for entering a pattern size as a measurement instead of a bead count.
// Goes through the stitch type's own generateGrid rather than restating its
// bounding-box formula, so a stitch type with an overhang (peyote's half-bead
// stagger) or any future engine stays correct here with no changes.

import { resolveGridEngine } from './gridEngine.js';

export function gridSizeMm(rows, cols, stitchType, bead) {
  const { boundingBoxMm } = resolveGridEngine(stitchType).generateGrid({
    rows,
    cols,
    beadWidthMm: bead.widthMm,
    beadHeightMm: bead.heightMm,
  });
  return { widthMm: boundingBoxMm.widthMm, heightMm: boundingBoxMm.heightMm };
}

// Every engine's bounding box is linear in the bead count along each axis
// (size = perBead * count + overhang), so two probes recover both terms.
// Rounds to the NEAREST whole bead count — a measurement is a target, and the
// closest achievable size is more useful than always landing under it.
export function rowsColsForSizeMm(widthMm, heightMm, stitchType, bead) {
  const one = gridSizeMm(1, 1, stitchType, bead);
  const two = gridSizeMm(2, 2, stitchType, bead);
  const perColMm = two.widthMm - one.widthMm;
  const perRowMm = two.heightMm - one.heightMm;
  const colOverhangMm = one.widthMm - perColMm;
  const rowOverhangMm = one.heightMm - perRowMm;
  const count = (targetMm, perBeadMm, overhangMm) =>
    Math.max(1, Math.round((targetMm - overhangMm) / perBeadMm) || 1);
  return {
    rows: count(heightMm, perRowMm, rowOverhangMm),
    cols: count(widthMm, perColMm, colOverhangMm),
  };
}
