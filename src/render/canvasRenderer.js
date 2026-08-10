import { peyoteCellOriginMm } from '../grid/peyote.js';
import { worldToScreen, screenToWorld } from './viewport.js';

const CELL_STROKE_STYLE = '#999';
const BACKGROUND_STYLE = '#fff';
const VISIBLE_RANGE_PADDING_CELLS = 1;
const EMPTY_CELL_DOT_STYLE = '#999';
const EMPTY_CELL_DOT_RADIUS_FRACTION = 0.12; // fraction of the smaller cell dimension
const EMPTY_CELL_DOT_MIN_RADIUS_PX = 0.5;
// Each bead's outline is stroked around a rect inset by half the line width, so the
// stroke's outer edge lands exactly on the cell boundary — neighboring beads' outlines
// meet there rather than overlapping on a shared centerline. Both the line width and
// the resulting gap scale with cell size (fraction of the smaller bead dimension), so
// beads read as thin-outlined at any zoom instead of a fixed-width hairline that looks
// too thick zoomed out or too thin zoomed in.
const BEAD_LINE_WIDTH_FRACTION = 0.06; // fraction of the smaller bead dimension
const BEAD_LINE_WIDTH_MIN_PX = 0.75;
// Rocailles are round-bodied beads and render with rounded cell corners; Delicas are
// cylindrical (square-cut sides) and stay sharp-cornered — see beadSpecs.js `shape`.
const BEAD_CORNER_RADIUS_FRACTION = 0.25; // fraction of the smaller bead dimension

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
// for canvas over per-bead DOM elements). `cells` is a Map<"row,col", { colorId }>
// (see cellStore.js) and `resolveColor` maps a colorId to a paintable hex string —
// this module stays ignorant of what a "color library" is, it just resolves and
// paints. Both are optional so Phase 1 callers/tests keep working unchanged.
export function drawPeyoteGrid(ctx, cssWidth, cssHeight, gridParams, viewport, cells, resolveColor, beadShape = 'cylinder') {
  const { rows, cols, beadWidthMm, beadHeightMm } = gridParams;

  ctx.fillStyle = BACKGROUND_STYLE;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const topLeftMm = screenToWorld(0, 0, viewport);
  const bottomRightMm = screenToWorld(cssWidth, cssHeight, viewport);

  const rowRange = visibleIndexRange(topLeftMm.xMm, bottomRightMm.xMm, beadHeightMm, rows);
  const colRange = visibleIndexRange(topLeftMm.yMm, bottomRightMm.yMm, beadWidthMm, cols);

  ctx.strokeStyle = CELL_STROKE_STYLE;

  for (let row = rowRange.start; row <= rowRange.end; row++) {
    for (let col = colRange.start; col <= colRange.end; col++) {
      const originMm = peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm);
      const topLeft = worldToScreen(originMm.xMm, originMm.yMm, viewport);
      const bottomRight = worldToScreen(
        originMm.xMm + beadHeightMm,
        originMm.yMm + beadWidthMm,
        viewport
      );
      const widthPx = bottomRight.xPx - topLeft.xPx;
      const heightPx = bottomRight.yPx - topLeft.yPx;

      const cell = cells?.get(`${row},${col}`);
      if (cell) {
        const lineWidthPx = Math.max(
          BEAD_LINE_WIDTH_MIN_PX,
          Math.min(widthPx, heightPx) * BEAD_LINE_WIDTH_FRACTION
        );
        const insetPx = lineWidthPx / 2;
        const beadX = topLeft.xPx + insetPx;
        const beadY = topLeft.yPx + insetPx;
        const beadWidthPx = widthPx - insetPx * 2;
        const beadHeightPx = heightPx - insetPx * 2;
        ctx.fillStyle = resolveColor(cell.colorId);
        ctx.lineWidth = lineWidthPx;
        ctx.beginPath();
        if (beadShape === 'round') {
          const radiusPx = Math.min(beadWidthPx, beadHeightPx) * BEAD_CORNER_RADIUS_FRACTION;
          ctx.roundRect(beadX, beadY, beadWidthPx, beadHeightPx, radiusPx);
        } else {
          ctx.rect(beadX, beadY, beadWidthPx, beadHeightPx);
        }
        ctx.fill();
        ctx.stroke();
      } else {
        const centerXPx = topLeft.xPx + widthPx / 2;
        const centerYPx = topLeft.yPx + heightPx / 2;
        const radiusPx = Math.max(
          EMPTY_CELL_DOT_MIN_RADIUS_PX,
          Math.min(widthPx, heightPx) * EMPTY_CELL_DOT_RADIUS_FRACTION
        );
        ctx.fillStyle = EMPTY_CELL_DOT_STYLE;
        ctx.beginPath();
        ctx.arc(centerXPx, centerYPx, radiusPx, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
