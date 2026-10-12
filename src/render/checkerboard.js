// The "this is transparent" checkerboard, in two versions: crisp, and a
// pre-blurred copy of the same tile. The blurred copy is what a Matte bead or
// swatch shows through its own color instead of the crisp one — a frosted
// haze across the whole face, with the bead's own edge still drawn crisp by
// whoever clips to it (beadFill.js on canvas, the swatch's own box in CSS).
//
// Blurring the tile once and reusing it — rather than blurring per bead — is
// what makes this affordable and, more to the point, possible at all: Safari
// has no reliable CanvasRenderingContext2D.filter, and ctx.shadowBlur was
// already tried and rejected for softness in beadFill.js. The blur below is
// plain array math, so it behaves identically everywhere.

export const CHECKERBOARD_LIGHT = '#ffffff';
export const CHECKERBOARD_DARK = '#cccccc';

// Per-pass box radius as a fraction of one checker square, and how many
// passes (three box passes approximate a gaussian). Tuned to leave the
// pattern still readable as a checkerboard, just out of focus — a heavier
// blur flattens it to a uniform gray, which stops reading as "transparent".
const BLUR_RADIUS_FRACTION = 0.17;
const BLUR_PASSES = 3;

// Box-blurs RGBA pixel data for a size x size tile in place-equivalent
// fashion (returns a new array), wrapping at every edge. Wrapping is what
// keeps the result seamless when the tile repeats: a checker tile is
// periodic, so a pixel at the left edge really does neighbor the right edge.
export function boxBlurWrapped(data, size, radius, passes = 1) {
  let current = Uint8ClampedArray.from(data);
  if (radius < 1) return current;
  const windowSize = radius * 2 + 1;
  const wrap = (i) => ((i % size) + size) % size;
  for (let pass = 0; pass < passes; pass++) {
    for (const horizontal of [true, false]) {
      const next = new Uint8ClampedArray(current.length);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          for (let channel = 0; channel < 4; channel++) {
            let sum = 0;
            for (let d = -radius; d <= radius; d++) {
              const sx = horizontal ? wrap(x + d) : x;
              const sy = horizontal ? y : wrap(y + d);
              sum += current[(sy * size + sx) * 4 + channel];
            }
            next[(y * size + x) * 4 + channel] = Math.round(sum / windowSize);
          }
        }
      }
      current = next;
    }
  }
  return current;
}

// One repeat of the pattern: two squares by two squares.
export function createCheckerTile(squarePx) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = squarePx * 2;
  const ctx = tile.getContext('2d');
  ctx.fillStyle = CHECKERBOARD_LIGHT;
  ctx.fillRect(0, 0, tile.width, tile.height);
  ctx.fillStyle = CHECKERBOARD_DARK;
  ctx.fillRect(0, 0, squarePx, squarePx);
  ctx.fillRect(squarePx, squarePx, squarePx, squarePx);
  return tile;
}

// Same tile, same size, same registration as createCheckerTile — so the two
// line up exactly when one is drawn over the other at the same origin.
export function createBlurredCheckerTile(squarePx) {
  const tile = createCheckerTile(squarePx);
  const ctx = tile.getContext('2d');
  const image = ctx.getImageData(0, 0, tile.width, tile.height);
  const radius = Math.max(1, Math.round(squarePx * BLUR_RADIUS_FRACTION));
  image.data.set(boxBlurWrapped(image.data, tile.width, radius, BLUR_PASSES));
  ctx.putImageData(image, 0, 0);
  return tile;
}
