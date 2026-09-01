// Pure placement/scale math for the photo trace reference overlay — no DOM,
// canvas, or IndexedDB here. Position/size are always in mm (Decision #6), so
// they compose with the viewport's existing worldToScreen transform for free.

// Default placement on load: centered over the grid's current bounding box,
// scaled uniformly (preserving the image's own aspect ratio) so its larger
// dimension matches the grid's corresponding bounding-box dimension — a
// reasonable starting point, not an attempt at automatic alignment.
export function defaultPhotoPlacement(imageWidthPx, imageHeightPx, gridBoundingBoxMm) {
  const scale = Math.min(
    gridBoundingBoxMm.widthMm / imageWidthPx,
    gridBoundingBoxMm.heightMm / imageHeightPx
  );
  const widthMm = imageWidthPx * scale;
  const heightMm = imageHeightPx * scale;
  return {
    widthMm,
    heightMm,
    xMm: (gridBoundingBoxMm.widthMm - widthMm) / 2,
    yMm: (gridBoundingBoxMm.heightMm - heightMm) / 2,
    rotationDeg: 0,
  };
}

// Degrees nudged per click of the Rotate CCW/CW buttons — a fixed step rather
// than a slider, since fine/arbitrary alignment is already covered by the
// two-finger twist gesture (touch) and Shift+wheel (desktop, see
// pointerRouter.js); the buttons exist for quick, discoverable, repeatable
// nudges on any input device.
export const PHOTO_ROTATE_STEP_DEG = 15;

// Keeps a rotation angle in [0, 360) so it doesn't grow without bound across
// many small gesture frames or button nudges — purely cosmetic (the canvas
// rotation math in canvasRenderer.js doesn't care about the stored range),
// but keeps a persisted value legible.
export function normalizeRotationDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

// Used by the pinch-to-scale "Move Photo" interaction — scales widthMm/heightMm by
// scaleFactor while keeping anchorWorld pinned under screenPoint, mirroring
// pointerRouter.js's existing zoomToAnchor for the main viewport but operating on
// the photo's own xMm/yMm/widthMm/heightMm instead of a shared viewport object.
export function scalePhotoToAnchor(photoTrace, anchorWorld, scaleFactor) {
  const newWidthMm = photoTrace.widthMm * scaleFactor;
  const newHeightMm = photoTrace.heightMm * scaleFactor;
  // Keep the point under the pinch anchor fixed: it's at a fractional position
  // within the photo (relative to its top-left) that must stay the same fraction
  // after scaling.
  const fracX = (anchorWorld.xMm - photoTrace.xMm) / photoTrace.widthMm;
  const fracY = (anchorWorld.yMm - photoTrace.yMm) / photoTrace.heightMm;
  return {
    widthMm: newWidthMm,
    heightMm: newHeightMm,
    xMm: anchorWorld.xMm - fracX * newWidthMm,
    yMm: anchorWorld.yMm - fracY * newHeightMm,
  };
}
