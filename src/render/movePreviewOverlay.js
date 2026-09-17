import { resolveGridEngine } from '../grid/gridEngine.js';
import { colShiftRowDelta } from '../grid/peyote.js';
import { cellKey } from '../state/cellStore.js';
import { worldToScreen } from './viewport.js';
import { MISSING_COLOR_FALLBACK_HEX } from '../palette/colorLibrary.js';

// Same visual language as pastePreviewOverlay.js's ghost (translucent fill +
// dashed bounding box) — a separate module rather than a shared one because
// the two sources are shaped differently: paste's clipboard is always a
// dense rectangle of [relRow, relCol, colorId] triples, while a move's
// movingEntries is a sparse, possibly-irregular list of [row, col] pairs (a
// selection's actual occupied cells, or a whole layer's) looked up against a
// baseCells snapshot.
const MOVE_PREVIEW_ALPHA = 0.9;
const MOVE_PREVIEW_BORDER_STYLE = '#2c7be5';
const MOVE_PREVIEW_BORDER_WIDTH_PX = 2;
const MOVE_PREVIEW_DASH = [4, 3];

// Ghost-renders where the moved content will land once Confirmed. The
// content's ORIGINAL position is hidden from the base render by
// editorView.js's own "hole" cells substitution (see cellsForDisplay), so
// this only ever needs to draw the destination — nothing here touches
// appState.cells.
export function drawMovePreviewOverlay(ctx, viewport, gridParams, movePreview, resolveColor) {
  if (!movePreview || movePreview.movingEntries.length === 0) return;
  const { baseCells, movingEntries, deltaRow, deltaCol, needsRowCompensation } = movePreview;
  const { beadWidthMm, beadHeightMm } = gridParams;
  const engine = resolveGridEngine(gridParams.stitchType);
  const dropCount = gridParams.dropCount ?? 1;

  const targets = movingEntries.map(([row, col]) => {
    const base = baseCells.get(cellKey(row, col));
    const targetRow = row + deltaRow + colShiftRowDelta(col, needsRowCompensation, gridParams.cols, gridParams.staggerFlipped, dropCount);
    const targetCol = col + deltaCol;
    return { row: targetRow, col: targetCol, colorId: base?.colorId ?? null };
  });

  ctx.save();
  ctx.globalAlpha = MOVE_PREVIEW_ALPHA;
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const { row, col, colorId } of targets) {
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    const originMm = engine.cellOrigin(row, col, gridParams);
    const topLeft = worldToScreen(originMm.xMm, originMm.yMm, viewport);
    const bottomRight = worldToScreen(originMm.xMm + beadHeightMm, originMm.yMm + beadWidthMm, viewport);
    ctx.fillStyle = resolveColor(colorId)?.hex ?? MISSING_COLOR_FALLBACK_HEX;
    ctx.fillRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  }
  ctx.restore();

  const topLeftMm = engine.cellOrigin(minRow, minCol, gridParams);
  const bottomRightMm = engine.cellOrigin(maxRow, maxCol, gridParams);
  const topLeft = worldToScreen(topLeftMm.xMm, topLeftMm.yMm, viewport);
  const bottomRight = worldToScreen(bottomRightMm.xMm + beadHeightMm, bottomRightMm.yMm + beadWidthMm, viewport);
  ctx.save();
  ctx.strokeStyle = MOVE_PREVIEW_BORDER_STYLE;
  ctx.lineWidth = MOVE_PREVIEW_BORDER_WIDTH_PX;
  ctx.setLineDash(MOVE_PREVIEW_DASH);
  ctx.strokeRect(topLeft.xPx, topLeft.yPx, bottomRight.xPx - topLeft.xPx, bottomRight.yPx - topLeft.yPx);
  ctx.restore();
}
