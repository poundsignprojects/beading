// Shared bead-fill painter for canvasRenderer.js's drawGrid and
// thumbnailRenderer.js's renderThumbnailDataUrl — both used to duplicate a flat
// `ctx.fillStyle = hex; ctx.fill()`. This is where transparency (alphaPercent)
// and a shiny luster's highlight are actually painted (.work/feature-bead-
// finish-effects-mvp-plan.md). Outline stroking and the missing-color X marker
// stay in each caller, since neither depends on finish.
//
// The shine design below is the final result of several rejected approaches
// tried against a live preview artifact, not the first idea attempted: a
// diagonal linear sweep (too broad/flat); a small radial corner-spot (an
// improvement, but a floating blob unrelated to the bead's own shape); an
// ellipse-based cap (structurally wrong — an ellipse's near and far edges
// always curve in *opposite* directions, reading as a lens bulging in the
// middle rather than a highlight that recedes near the bead's own corners);
// a rounded-rect cap softened with ctx.shadowBlur (tried twice, for two
// different shapes — a blur radius large enough to look "soft" ended up
// dominating the whole shape rather than just softening its edge, with no
// usable middle ground to tune). What survived: a filled cap clipped to an
// inset copy of the bead's own path, with a gradient whose peak can sit
// anywhere along it and fades symmetrically to each side using an eased
// curve rather than blur for softness.
import { hexToRgba, clamp01 } from '../palette/colorConversion.js';

// Every constant below was chosen interactively against a live preview
// artifact (not guessed). Two real bugs were found along the way: (1) an
// asymmetric fade formula that visibly dragged the peak toward one side as
// softness increased, unrelated to where the peak itself sat — fixed by
// parameterizing both sides of the fade by distance-from-peak using the
// identical curve, which is what addPeakFade below does; (2) ctx.shadowBlur's
// "soft or dominates the whole shape, nothing in between" failure mode,
// described above — softness here is a gradient curve shape instead, with no
// blur involved anywhere.
const SHINE_INSET_TOP_BOTTOM_FRACTION = 0.10; // margin from the true edge, scaled off the bead's height
const SHINE_INSET_SIDES_FRACTION = 0.10;      // margin from the true edge, scaled off the bead's width
const SHINE_CORE_POSITION_FRACTION = 0.29;    // where the brightest point sits: 0 = top of the inset box, 1 = bottom
const SHINE_CORE_EXTENT_FRACTION = 0;         // how far the full-brightness plateau extends to each side of the peak — 0 means a single bright point, not a held plateau
const SHINE_FADE_EXTENT_FRACTION = 0.17;      // how much further the fade continues beyond the plateau, to each side
const SHINE_SOFTNESS = 0.02;                  // 0 = linear falloff; higher = lingers near peak longer before dropping off. Near-linear was the chosen look, not a soft cushioned edge.
const SHINE_PEAK_ALPHA = 0.82;                // the highlight's own opacity — independent of the bead's own alphaPercent, see below. Deliberately not 1 — fully opaque read as too stark once actually compared side by side.
const SHINE_COLOR_HEX = '#ffffff';
const PEAK_FADE_STEPS = 8; // resolution of the manually-added stops approximating the eased curve

// Paints only the fill — outline stroking and the missing-color X marker stay
// in each caller (canvasRenderer.js), since neither depends on finish.
export function paintBeadFill(ctx, x, y, w, h, radiusPx, appearance) {
  const { hex, alphaPercent, luster } = appearance;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radiusPx);
  ctx.fillStyle = hexToRgba(hex, alphaPercent);
  ctx.fill();

  if (luster === 'shiny') {
    paintShineCap(ctx, x, y, w, h, radiusPx);
  }
}

// Clips to a smaller, inset copy of the bead's own roundRect path — so the
// highlight's ends automatically curve to match the bead's rounded corners,
// sharp on a Delica or round on a Rocaille, with no per-bead-type logic —
// then fills that region with a gradient whose brightest point sits at
// SHINE_CORE_POSITION_FRACTION and fades out symmetrically to each side of
// it, not just downward from the top edge. Drawn directly with its own fixed
// alpha, never derived from or scaled by the bead's own alphaPercent — that's
// what keeps it genuinely opaque-looking regardless of how transparent the
// bead body itself is: alpha compositing at a fixed value doesn't get
// diluted by whatever it happens to be drawn on top of.
function paintShineCap(ctx, x, y, w, h, radiusPx) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radiusPx);
  ctx.clip();

  const insetTBPx = h * 0.5 * SHINE_INSET_TOP_BOTTOM_FRACTION;
  const insetLRPx = w * 0.5 * SHINE_INSET_SIDES_FRACTION;
  const insetX = x + insetLRPx;
  const insetY = y + insetTBPx;
  const insetW = Math.max(w - insetLRPx * 2, 1);
  const insetH = Math.max(h - insetTBPx * 2, 1);
  const insetRadius = Math.max(radiusPx - Math.min(insetTBPx, insetLRPx), 0);

  ctx.beginPath();
  ctx.roundRect(insetX, insetY, insetW, insetH, insetRadius);
  ctx.clip();

  const plateauStart = clamp01(SHINE_CORE_POSITION_FRACTION - SHINE_CORE_EXTENT_FRACTION);
  const plateauEnd = clamp01(SHINE_CORE_POSITION_FRACTION + SHINE_CORE_EXTENT_FRACTION);
  const fadeInStart = clamp01(plateauStart - SHINE_FADE_EXTENT_FRACTION);
  const fadeOutEnd = clamp01(plateauEnd + SHINE_FADE_EXTENT_FRACTION);

  const gradient = ctx.createLinearGradient(insetX, insetY, insetX, insetY + insetH);
  addPeakFade(gradient, plateauStart, fadeInStart);
  gradient.addColorStop(plateauStart, shineRgba(SHINE_PEAK_ALPHA));
  gradient.addColorStop(plateauEnd, shineRgba(SHINE_PEAK_ALPHA));
  addPeakFade(gradient, plateauEnd, fadeOutEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(insetX, insetY, insetW, insetH);
  ctx.restore();
}

// Adds stops for one side of the fade, parameterized by distance from the
// peak (0 at offsetNearPeak, 1 at offsetFar) rather than by "how far along
// this call's own direction" — that distinction is what guarantees the
// fade-in side (above the peak) and fade-out side (below it) are true mirror
// images of each other regardless of the softness curve applied. Works
// correctly whichever of offsetNearPeak/offsetFar is numerically larger, so
// the same function serves both sides without an explicit direction flag.
function addPeakFade(gradient, offsetNearPeak, offsetFar) {
  const exponent = 1 + SHINE_SOFTNESS * 5; // 1 = linear, 6 = lingers near peak longer before dropping off
  const lo = Math.min(offsetNearPeak, offsetFar);
  const hi = Math.max(offsetNearPeak, offsetFar);
  const span = Math.abs(offsetFar - offsetNearPeak);
  for (let i = 0; i <= PEAK_FADE_STEPS; i++) {
    const offset = lo + (i / PEAK_FADE_STEPS) * (hi - lo);
    const d = span < 1e-6 ? 0 : clamp01(Math.abs(offset - offsetNearPeak) / span);
    const alpha = SHINE_PEAK_ALPHA * (1 - Math.pow(d, exponent));
    gradient.addColorStop(clamp01(offset), shineRgba(alpha));
  }
}

function shineRgba(alpha) {
  return hexToRgba(SHINE_COLOR_HEX, alpha * 100); // hexToRgba takes 0-100, alpha here is 0-1
}
