// How a color looks as a DOM swatch — the palette, Working Colors, the Manage
// lists' row swatch, and the color picker's live preview all go through
// applySwatchAppearance, so they can't drift apart. The actual layering
// (highlight over color over checkerboard) lives in style.css's .finish-swatch;
// this only feeds it the color and toggles the two finish classes.

import { hexToRgba } from '../palette/colorConversion.js';
import { createBlurredCheckerTile } from '../render/checkerboard.js';

// One checker square, in CSS px — half of .finish-swatch's 12px
// background-size, which is one full repeat (two squares).
const SWATCH_CHECKER_SQUARE_PX = 6;
// The blurred tile is rendered at this multiple of its CSS size so it isn't
// upscaled on a high-DPI screen.
const SWATCH_TILE_RESOLUTION = 2;

// Generates the blurred checkerboard a Matte swatch shows through its color
// (see checkerboard.js) and hands it to CSS as a custom property. Called once
// at boot. If it never runs, .swatch-matte falls back to the crisp
// checkerboard — Matte just looks like no finish, nothing breaks.
export function installSwatchBackdrop() {
  const tile = createBlurredCheckerTile(SWATCH_CHECKER_SQUARE_PX * SWATCH_TILE_RESOLUTION);
  document.documentElement.style.setProperty('--swatch-checker-blurred', `url(${tile.toDataURL('image/png')})`);
}

export function applySwatchAppearance(el, { hex, alphaPercent, matte, metallic }) {
  el.classList.add('finish-swatch');
  el.style.setProperty('--swatch-fill', hexToRgba(hex, alphaPercent));
  el.classList.toggle('swatch-matte', matte === true);
  el.classList.toggle('swatch-metallic', metallic === true);
}
