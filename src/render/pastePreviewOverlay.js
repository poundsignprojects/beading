import { peyoteCellOriginMm } from '../grid/peyote.js';
import { worldToScreen } from './viewport.js';
import { MISSING_COLOR_FALLBACK_HEX } from '../palette/colorLibrary.js';

const PASTE_PREVIEW_ALPHA = 0.9;
const PASTE_PREVIEW_BORDER_STYLE = '#2c7be5';
const PASTE_PREVIEW_BORDER_WIDTH_PX = 2;
const PASTE_PREVIEW_DASH = [4, 3];

// Ghost-renders the clipboard's content at the pending paste anchor, translucent so
// whatever it would cover (paste-in-front) or be covered by (paste-behind) stays
// visible underneath for comparison before Confirm. Bounding-box outline uses the
// same corner math selectionOverlay.js already uses for a selection rectangle.
export function drawPastePreviewOverlay(ctx, viewport, gridParams, clipboard, pastePreview, resolveColor) {
  if (!clipboard || !pastePreview) return;
  const { cols, beadWidthMm, beadHeightMm } = gridParams;
  const { anchorRow, anchorCol } = pastePreview;

  ctx.save();
  ctx.globalAlpha = PASTE_PREVIEW_ALPHA;
  for (const [relRow, relCol, colorId] of clipboard.cells) {
    const originMm = peyoteCellOriginMm(anchorRow + relRow, anchorCol + relCol, beadWidthMm, beadHeightMm, cols);
    const topLeft = worldToScreen(originMm.xMm, originMm.yMm, viewport);
    const bottomRight = worldToScreen(originMm.xMm + beadHeightMm, originMm.yMm + beadWidthMm, viewport);
    ctx.fillStyle = resolveColor(colorId) ?? MISSING_COLOR_FALLBACK_HEX;
    ctx.fillRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  }
  ctx.restore();

  const topLeftMm = peyoteCellOriginMm(anchorRow, anchorCol, beadWidthMm, beadHeightMm, cols);
  const bottomRightMm = peyoteCellOriginMm(anchorRow + clipboard.rows - 1, anchorCol + clipboard.cols - 1, beadWidthMm, beadHeightMm, cols);
  const topLeft = worldToScreen(topLeftMm.xMm, topLeftMm.yMm, viewport);
  const bottomRight = worldToScreen(bottomRightMm.xMm + beadHeightMm, bottomRightMm.yMm + beadWidthMm, viewport);
  ctx.save();
  ctx.strokeStyle = PASTE_PREVIEW_BORDER_STYLE;
  ctx.lineWidth = PASTE_PREVIEW_BORDER_WIDTH_PX;
  ctx.setLineDash(PASTE_PREVIEW_DASH);
  ctx.strokeRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.restore();
}
