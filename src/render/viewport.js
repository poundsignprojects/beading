// viewport = { originXmm, originYmm, scalePxPerMm }
// origin = the mm-space world coordinate at the canvas's top-left CSS-pixel corner.
// scalePxPerMm = zoom expressed directly in pixels-per-millimeter.
//
// Pan/zoom is applied by manual multiplication here, not via ctx.translate/ctx.scale
// compounded with gesture state — keeps stroke line widths zoom-independent and keeps
// screenToWorld trivially reusable for pinch-anchor math and hit-testing.

export function worldToScreen(xMm, yMm, viewport) {
  return {
    xPx: (xMm - viewport.originXmm) * viewport.scalePxPerMm,
    yPx: (yMm - viewport.originYmm) * viewport.scalePxPerMm,
  };
}

export function screenToWorld(xPx, yPx, viewport) {
  return {
    xMm: xPx / viewport.scalePxPerMm + viewport.originXmm,
    yMm: yPx / viewport.scalePxPerMm + viewport.originYmm,
  };
}
