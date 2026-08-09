import { peyoteCellOriginMm } from '../grid/peyote.js';
import { worldToScreen, screenToWorld } from './viewport.js';

const CELL_STROKE_STYLE = '#999';
const CELL_LINE_WIDTH_PX = 1;
const BACKGROUND_STYLE = '#fff';
const VISIBLE_RANGE_PADDING_CELLS = 1;

// Syncs the canvas's backing-store resolution to its CSS size * devicePixelRatio
// (crisp on Retina iPad) and scales the context so all drawing below can use CSS
// pixel coordinates. Call whenever the canvas's CSS size changes (init + resize).
export function resizeCanvasForDisplay(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cssWidth, cssHeight };
}

// Clamps a raw [min, max] cell-index range to the grid's actual bounds, expanding
// by one cell of padding on each side so cells straddling the viewport edge still render.
function visibleIndexRange(minMm, maxMm, cellSizeMm, cellCount) {
  const rawMin = Math.floor(minMm / cellSizeMm) - VISIBLE_RANGE_PADDING_CELLS;
  const rawMax = Math.ceil(maxMm / cellSizeMm) + VISIBLE_RANGE_PADDING_CELLS;
  return {
    start: Math.max(0, rawMin),
    end: Math.min(cellCount - 1, rawMax),
  };
}

// Draws only the cells whose bounding box intersects the current viewport, so cost
// scales with what's on screen rather than total pattern size (CLAUDE.md's rationale
// for canvas over per-bead DOM elements).
export function drawPeyoteGrid(ctx, cssWidth, cssHeight, gridParams, viewport) {
  const { rows, cols, beadWidthMm, beadHeightMm } = gridParams;

  ctx.fillStyle = BACKGROUND_STYLE;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const topLeftMm = screenToWorld(0, 0, viewport);
  const bottomRightMm = screenToWorld(cssWidth, cssHeight, viewport);

  const colRange = visibleIndexRange(topLeftMm.xMm, bottomRightMm.xMm, beadWidthMm, cols);
  const rowRange = visibleIndexRange(topLeftMm.yMm, bottomRightMm.yMm, beadHeightMm, rows);

  ctx.strokeStyle = CELL_STROKE_STYLE;
  ctx.lineWidth = CELL_LINE_WIDTH_PX;

  for (let row = rowRange.start; row <= rowRange.end; row++) {
    for (let col = colRange.start; col <= colRange.end; col++) {
      const originMm = peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm);
      const topLeft = worldToScreen(originMm.xMm, originMm.yMm, viewport);
      const bottomRight = worldToScreen(
        originMm.xMm + beadWidthMm,
        originMm.yMm + beadHeightMm,
        viewport
      );
      ctx.strokeRect(
        topLeft.xPx,
        topLeft.yPx,
        bottomRight.xPx - topLeft.xPx,
        bottomRight.yPx - topLeft.yPx
      );
    }
  }
}
