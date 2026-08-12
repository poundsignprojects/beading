import { peyoteCellOriginMm } from '../grid/peyote.js';
import { worldToScreen } from './viewport.js';

const SELECTION_STROKE_STYLE = '#2c7be5';
const SELECTION_FILL_STYLE = 'rgba(44, 123, 229, 0.12)';
const SELECTION_LINE_WIDTH_PX = 2;
const SELECTION_DASH = [6, 4];

// Draws the marquee selection rectangle over the grid, in world-mm space via the
// same viewport transform as the grid itself — reuses peyoteCellOriginMm directly
// rather than needing a new grid-math helper, since the box's world-space corners
// are just two ordinary cell origins plus one cell's extent.
export function drawSelectionOverlay(ctx, viewport, gridParams, selection) {
  if (!selection) return;
  const { rows, beadWidthMm, beadHeightMm } = gridParams;
  const { rowStart, rowEnd, colStart, colEnd } = selection;
  const topLeftMm = peyoteCellOriginMm(rowStart, colStart, beadWidthMm, beadHeightMm, rows);
  const bottomRightMm = peyoteCellOriginMm(rowEnd, colEnd, beadWidthMm, beadHeightMm, rows);
  const topLeft = worldToScreen(topLeftMm.xMm, topLeftMm.yMm, viewport);
  // bottomRight uses the *far* corner of the end cell, not its origin — add one full
  // cell's extent so the box encloses the last row/col rather than stopping at its start.
  const bottomRight = worldToScreen(bottomRightMm.xMm + beadHeightMm, bottomRightMm.yMm + beadWidthMm, viewport);

  ctx.save();
  ctx.fillStyle = SELECTION_FILL_STYLE;
  ctx.fillRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.strokeStyle = SELECTION_STROKE_STYLE;
  ctx.lineWidth = SELECTION_LINE_WIDTH_PX;
  ctx.setLineDash(SELECTION_DASH);
  ctx.strokeRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.restore();
}
