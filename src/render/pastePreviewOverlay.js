import { resolveGridEngine } from '../grid/gridEngine.js';
import { colShiftRowDelta } from '../grid/peyote.js';
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
// Deliberately doesn't adopt a color's own alpha/shine (see .work/feature-bead-
// finish-effects-mvp-plan.md) — the ghost's own fixed PASTE_PREVIEW_ALPHA already
// signals "not committed yet," and layering a color's own translucency/highlight
// on top would compound two different kinds of translucency and read as muddy
// rather than informative. Just reads .hex off whatever resolveColor returns.
export function drawPastePreviewOverlay(ctx, viewport, gridParams, clipboard, pastePreview, resolveColor) {
  if (!clipboard || !pastePreview) return;
  const { beadWidthMm, beadHeightMm } = gridParams;
  const engine = resolveGridEngine(gridParams.stitchType);
  const { anchorRow, anchorCol, originAnchorCol, needsRowCompensation } = pastePreview;
  const dropCount = gridParams.dropCount ?? 1;
  // A clipboard cell's OWN starting column (for compensation purposes) is
  // where it would sit if pasted back at originAnchorCol — see
  // resolvePasteAnchorCol's comment in pointerRouter.js and handlePasteConfirm's
  // matching use of the same formula, so the ghost always previews exactly
  // where Confirm will actually stamp it.
  const rowCompFor = (relCol) => colShiftRowDelta(
    originAnchorCol + relCol, needsRowCompensation, gridParams.cols, gridParams.staggerFlipped, dropCount
  );

  ctx.save();
  ctx.globalAlpha = PASTE_PREVIEW_ALPHA;
  for (const [relRow, relCol, colorId] of clipboard.cells) {
    const row = anchorRow + relRow + rowCompFor(relCol);
    const originMm = engine.cellOrigin(row, anchorCol + relCol, gridParams);
    const topLeft = worldToScreen(originMm.xMm, originMm.yMm, viewport);
    const bottomRight = worldToScreen(originMm.xMm + beadHeightMm, originMm.yMm + beadWidthMm, viewport);
    ctx.fillStyle = resolveColor(colorId)?.hex ?? MISSING_COLOR_FALLBACK_HEX;
    ctx.fillRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  }
  ctx.restore();

  // The compensation only ever nudges a row by +1 for a "recessed"-starting
  // column, never negative — so the outer bounding box's row range only ever
  // needs to widen at the bottom (max), never the top (min); but computing
  // both from the actual per-column compensation, rather than assuming that,
  // keeps this correct even if colShiftRowDelta's own convention ever changes.
  let minRowComp = 0, maxRowComp = 0;
  if (needsRowCompensation) {
    minRowComp = Infinity;
    maxRowComp = -Infinity;
    for (let relCol = 0; relCol < clipboard.cols; relCol++) {
      const comp = rowCompFor(relCol);
      minRowComp = Math.min(minRowComp, comp);
      maxRowComp = Math.max(maxRowComp, comp);
    }
  }
  const topLeftMm = engine.cellOrigin(anchorRow + minRowComp, anchorCol, gridParams);
  const bottomRightMm = engine.cellOrigin(anchorRow + (clipboard.rows - 1) + maxRowComp, anchorCol + clipboard.cols - 1, gridParams);
  const topLeft = worldToScreen(topLeftMm.xMm, topLeftMm.yMm, viewport);
  const bottomRight = worldToScreen(bottomRightMm.xMm + beadHeightMm, bottomRightMm.yMm + beadWidthMm, viewport);
  ctx.save();
  ctx.strokeStyle = PASTE_PREVIEW_BORDER_STYLE;
  ctx.lineWidth = PASTE_PREVIEW_BORDER_WIDTH_PX;
  ctx.setLineDash(PASTE_PREVIEW_DASH);
  ctx.strokeRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.restore();
}
