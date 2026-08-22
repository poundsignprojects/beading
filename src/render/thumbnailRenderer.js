import { resolveGridEngine } from '../grid/gridEngine.js';
import { MISSING_COLOR_FALLBACK_HEX } from '../palette/colorLibrary.js';

const THUMBNAIL_BACKGROUND_STYLE = '#fff';

// Renders a design's current pattern into a small square-bounded PNG data URL, fit
// (not cropped) within maxSizePx on its longer side. No outlines, no empty-cell
// dots — both would just be noise at thumbnail scale — only occupied cells are
// drawn, which is also cheaper than a full rows*cols sweep for a sparse pattern.
// cornerRadiusFraction is the bead type's own corner-roundness (see
// beadSpecs.js's findBeadType) — 0/undefined draws sharp corners.
export function renderThumbnailDataUrl(gridParams, cells, resolveColor, maxSizePx, cornerRadiusFraction = 0) {
  const { beadWidthMm, beadHeightMm, boundingBoxMm } = gridParams;
  const engine = resolveGridEngine(gridParams.stitchType);
  const scale = maxSizePx / Math.max(boundingBoxMm.widthMm, boundingBoxMm.heightMm);
  const canvasWidth = Math.max(1, Math.round(boundingBoxMm.widthMm * scale));
  const canvasHeight = Math.max(1, Math.round(boundingBoxMm.heightMm * scale));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = THUMBNAIL_BACKGROUND_STYLE;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  for (const [key, cell] of cells) {
    const [row, col] = key.split(',').map(Number);
    const origin = engine.cellOrigin(row, col, gridParams);
    const x = origin.xMm * scale;
    const y = origin.yMm * scale;
    const w = beadHeightMm * scale;
    const h = beadWidthMm * scale;
    ctx.fillStyle = resolveColor(cell.colorId) ?? MISSING_COLOR_FALLBACK_HEX;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(w, h) * cornerRadiusFraction);
    ctx.fill();
  }

  return canvas.toDataURL('image/png');
}
