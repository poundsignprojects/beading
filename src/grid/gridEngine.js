// Resolves a design's stitch type to the grid-math functions that implement it,
// so every render/interaction module can go through one small interface instead
// of importing peyote.js (or square.js) directly and assuming its geometry. See
// .work/feature-square-stitch-plan.md's "Architecture" section — peyote.js itself
// gets zero changes for square stitch to exist.
//
// Every engine function takes the same gridParams-shaped object every consumer
// already has in hand (rows/cols/beadWidthMm/beadHeightMm/staggerFlipped), so
// call sites resolve an engine once via resolveGridEngine(gridParams.stitchType)
// and then call e.g. engine.cellOrigin(row, col, gridParams) instead of threading
// individual fields through every call.

import {
  peyoteCellOriginMm,
  generatePeyoteGrid,
  peyoteCellAtPoint,
  peyoteCellAtPointClamped,
  peyoteCellAtPointUnbounded,
  peyoteNeighbors,
} from './peyote.js';
import {
  squareCellOriginMm,
  generateSquareGrid,
  squareCellAtPoint,
  squareCellAtPointClamped,
  squareCellAtPointUnbounded,
  squareNeighbors,
} from './square.js';

const peyoteEngine = {
  generateGrid: (p) => generatePeyoteGrid(p),
  cellOrigin: (row, col, p) => peyoteCellOriginMm(row, col, p.beadWidthMm, p.beadHeightMm, p.cols, p.staggerFlipped),
  cellAtPoint: (xMm, yMm, p) => peyoteCellAtPoint(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.rows, p.cols, p.staggerFlipped),
  cellAtPointClamped: (xMm, yMm, p) => peyoteCellAtPointClamped(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.rows, p.cols, p.staggerFlipped),
  cellAtPointUnbounded: (xMm, yMm, p) => peyoteCellAtPointUnbounded(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.cols, p.staggerFlipped),
  neighbors: (row, col, p) => peyoteNeighbors(row, col, p.cols, p.staggerFlipped),
};

const squareEngine = {
  generateGrid: (p) => generateSquareGrid(p),
  cellOrigin: (row, col, p) => squareCellOriginMm(row, col, p.beadWidthMm, p.beadHeightMm),
  cellAtPoint: (xMm, yMm, p) => squareCellAtPoint(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.rows, p.cols),
  cellAtPointClamped: (xMm, yMm, p) => squareCellAtPointClamped(xMm, yMm, p.beadWidthMm, p.beadHeightMm, p.rows, p.cols),
  cellAtPointUnbounded: (xMm, yMm, p) => squareCellAtPointUnbounded(xMm, yMm, p.beadWidthMm, p.beadHeightMm),
  neighbors: (row, col) => squareNeighbors(row, col),
};

// peyote is the default/fallback — every design created before stitchType
// existed migrates to 'peyote' explicitly (see migrateDesign.js), so this
// fallback is a safety net, not a real code path once migration has run.
export function resolveGridEngine(stitchType) {
  return stitchType === 'square' ? squareEngine : peyoteEngine;
}

// Single source of truth for the user-facing stitch-type name, shared by the
// settings dialog's <select>, the library row's per-design label, the stitch-
// type-conversion confirm message, and the print header — so these can't drift
// out of sync with each other.
const STITCH_TYPE_LABELS = { peyote: 'Peyote', square: 'Square Stitch' };

export function stitchTypeLabel(stitchType) {
  return STITCH_TYPE_LABELS[stitchType] ?? STITCH_TYPE_LABELS.peyote;
}
