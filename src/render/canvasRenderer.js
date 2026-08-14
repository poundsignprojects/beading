import { peyoteCellOriginMm } from '../grid/peyote.js';
import { worldToScreen, screenToWorld } from './viewport.js';

const CELL_STROKE_STYLE = '#000';
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
// Floor exists only so the outline doesn't vanish entirely when zoomed out far
// enough that the proportional fraction would round to nothing — kept low so it
// rarely overrides the fraction. A higher floor (0.75px, pre-existing) dominated
// at small cell sizes instead of the fraction, making the outline look thicker
// than the bead it was outlining rather than scaling down with it.
const BEAD_LINE_WIDTH_MIN_PX = 0.4;
// resolveColor can return null for a cell whose colorId no longer matches any
// customColors entry (a deleted color still referenced by an old cell) — drawn
// as a white bead with a red X instead of guessing a color, per
// .work/feature-color-deletion-guard-and-missing-color-plan.md.
const MISSING_COLOR_FILL_STYLE = '#fff';
const MISSING_COLOR_X_STYLE = '#c0392b';
const MISSING_COLOR_X_LINE_WIDTH_FRACTION = 0.12;
const MISSING_COLOR_X_LINE_WIDTH_MIN_PX = 0.75;
const MISSING_COLOR_X_INSET_FRACTION = 0.22; // keeps the X inside the bead outline

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
// beadCornerRadiusFraction is a property of the bead type itself (see
// beadSpecs.js's findBeadType) — 0/undefined draws sharp corners, a positive
// fraction (of the smaller bead dimension) draws rounded ones. ctx.roundRect(...,
// 0) draws identically to ctx.rect(...), so there's no need to branch on a
// separate "shape" concept.
// showBeadOutlines toggles the stroked outline around each occupied cell — when
// false, the fill is drawn edge-to-edge with no inset/stroke, so neighboring
// beads' colors touch directly rather than leaving a visible line between them.
export function drawPeyoteGrid(ctx, cssWidth, cssHeight, gridParams, viewport, cells, resolveColor, photoLayer = null, beadCornerRadiusFraction = 0, showBeadOutlines = true) {
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
      const originMm = peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm, rows);
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
        const lineWidthPx = showBeadOutlines
          ? Math.max(
              BEAD_LINE_WIDTH_MIN_PX,
              Math.min(widthPx, heightPx) * BEAD_LINE_WIDTH_FRACTION
            )
          : 0;
        const insetPx = lineWidthPx / 2;
        const beadX = topLeft.xPx + insetPx;
        const beadY = topLeft.yPx + insetPx;
        const beadWidthPx = widthPx - insetPx * 2;
        const beadHeightPx = heightPx - insetPx * 2;
        const hex = resolveColor(cell.colorId);
        ctx.fillStyle = hex ?? MISSING_COLOR_FILL_STYLE;
        ctx.lineWidth = lineWidthPx;
        ctx.beginPath();
        const radiusPx = Math.min(beadWidthPx, beadHeightPx) * beadCornerRadiusFraction;
        ctx.roundRect(beadX, beadY, beadWidthPx, beadHeightPx, radiusPx);
        ctx.fill();
        if (showBeadOutlines) ctx.stroke();

        if (hex === null) {
          const inset = Math.min(beadWidthPx, beadHeightPx) * MISSING_COLOR_X_INSET_FRACTION;
          ctx.strokeStyle = MISSING_COLOR_X_STYLE;
          ctx.lineWidth = Math.max(
            MISSING_COLOR_X_LINE_WIDTH_MIN_PX,
            Math.min(beadWidthPx, beadHeightPx) * MISSING_COLOR_X_LINE_WIDTH_FRACTION
          );
          ctx.beginPath();
          ctx.moveTo(beadX + inset, beadY + inset);
          ctx.lineTo(beadX + beadWidthPx - inset, beadY + beadHeightPx - inset);
          ctx.moveTo(beadX + beadWidthPx - inset, beadY + inset);
          ctx.lineTo(beadX + inset, beadY + beadHeightPx - inset);
          ctx.stroke();
          ctx.strokeStyle = CELL_STROKE_STYLE; // restore — reused unset across the loop's outline strokes
        }
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

  // Reference photo renders as a translucent overlay on top of everything —
  // beads included — at the user's chosen opacity, so the photo and the
  // beadwork-so-far stay simultaneously visible for direct comparison rather
  // than the photo being occluded wherever a bead has been placed. photoLayer
  // is plain drawable data ({ image, opacityPercent, xMm, yMm, widthMm,
  // heightMm}); this module stays ignorant of "photo trace" as a persisted
  // concept, matching its existing role for cells/resolveColor.
  if (photoLayer) {
    const photoTopLeft = worldToScreen(photoLayer.xMm, photoLayer.yMm, viewport);
    const photoBottomRight = worldToScreen(
      photoLayer.xMm + photoLayer.widthMm,
      photoLayer.yMm + photoLayer.heightMm,
      viewport
    );
    ctx.save();
    ctx.globalAlpha = photoLayer.opacityPercent / 100;
    ctx.drawImage(
      photoLayer.image,
      photoTopLeft.xPx,
      photoTopLeft.yPx,
      photoBottomRight.xPx - photoTopLeft.xPx,
      photoBottomRight.yPx - photoTopLeft.yPx
    );
    ctx.restore();
  }
}
