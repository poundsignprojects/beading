import { resolveGridEngine } from '../grid/gridEngine.js';
import { worldToScreen } from './viewport.js';

const SELECTION_STROKE_STYLE = '#2c7be5';
const SELECTION_FILL_STYLE = 'rgba(44, 123, 229, 0.12)';
const SELECTION_LINE_WIDTH_PX = 2;
const SELECTION_DASH = [6, 4];

// Draws the marquee selection over the grid, in world-mm space via the same
// viewport transform as the grid itself — reuses the resolved grid engine's
// cellOrigin directly rather than needing a new grid-math helper.
//
// selection.mask (Set<cellKey>, optional — see tools/magicWandTool.js and
// .work/feature-lasso-select-plan.md) marks a non-rectangular selection: every
// cell in the mask is drawn individually instead of one bounding rectangle, so
// the user sees exactly what a magic-wand tap actually selected, not its
// bounding box. An ordinary marquee selection carries no mask and renders as
// one rect exactly as before.
export function drawSelectionOverlay(ctx, viewport, gridParams, selection) {
  if (!selection) return;
  const { beadWidthMm, beadHeightMm } = gridParams;
  const engine = resolveGridEngine(gridParams.stitchType);

  ctx.save();
  ctx.fillStyle = SELECTION_FILL_STYLE;
  ctx.strokeStyle = SELECTION_STROKE_STYLE;
  ctx.lineWidth = SELECTION_LINE_WIDTH_PX;
  ctx.setLineDash(SELECTION_DASH);

  if (selection.mask) {
    for (const key of selection.mask) {
      const [row, col] = key.split(',').map(Number);
      const originMm = engine.cellOrigin(row, col, gridParams);
      const topLeft = worldToScreen(originMm.xMm, originMm.yMm, viewport);
      const bottomRight = worldToScreen(originMm.xMm + beadHeightMm, originMm.yMm + beadWidthMm, viewport);
      const w = bottomRight.xPx - topLeft.xPx;
      const h = bottomRight.yPx - topLeft.yPx;
      ctx.fillRect(topLeft.xPx, topLeft.yPx, w, h);
      ctx.strokeRect(topLeft.xPx, topLeft.yPx, w, h);
    }
  } else {
    const { rowStart, rowEnd, colStart, colEnd } = selection;
    const topLeftMm = engine.cellOrigin(rowStart, colStart, gridParams);
    const bottomRightMm = engine.cellOrigin(rowEnd, colEnd, gridParams);
    const topLeft = worldToScreen(topLeftMm.xMm, topLeftMm.yMm, viewport);
    // bottomRight uses the *far* corner of the end cell, not its origin — add one full
    // cell's extent so the box encloses the last row/col rather than stopping at its start.
    const bottomRight = worldToScreen(bottomRightMm.xMm + beadHeightMm, bottomRightMm.yMm + beadWidthMm, viewport);
    ctx.fillRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
    ctx.strokeRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  }

  ctx.restore();
}
