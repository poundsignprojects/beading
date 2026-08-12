import { peyoteCellOriginMm } from '../grid/peyote.js';

const THUMBNAIL_BACKGROUND_STYLE = '#fff';
const THUMBNAIL_CORNER_RADIUS_FRACTION = 0.25; // matches canvasRenderer.js's round-bead constant

// Renders a design's current pattern into a small square-bounded PNG data URL, fit
// (not cropped) within maxSizePx on its longer side. No outlines, no empty-cell
// dots — both would just be noise at thumbnail scale — only occupied cells are
// drawn, which is also cheaper than a full rows*cols sweep for a sparse pattern.
export function renderThumbnailDataUrl(gridParams, cells, resolveColor, beadShape, maxSizePx) {
  const { rows, beadWidthMm, beadHeightMm, boundingBoxMm } = gridParams;
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
    const origin = peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm, rows);
    const x = origin.xMm * scale;
    const y = origin.yMm * scale;
    const w = beadHeightMm * scale;
    const h = beadWidthMm * scale;
    ctx.fillStyle = resolveColor(cell.colorId);
    if (beadShape === 'round') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(w, h) * THUMBNAIL_CORNER_RADIUS_FRACTION);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  return canvas.toDataURL('image/png');
}
