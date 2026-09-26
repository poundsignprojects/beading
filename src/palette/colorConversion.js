// Pure hex/RGB/HSV conversion math for the custom color picker (colorPickerDialog.js).
// Exists so the picker's saturation-value square + hue bar can be driven by
// ordinary numbers instead of the browser's own <input type="color"> — which is
// what made the picker look/behave differently on iPad Safari vs. Mac Safari in
// the first place (two different OS-native pickers, not something CSS can unify).

export function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

export function isValidHex(value) {
  return /^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$/.test(value);
}

// Expands a 3-digit hex to 6 digits and ensures a leading '#'; assumes isValidHex
// already passed.
export function normalizeHex(value) {
  const withHash = value.startsWith('#') ? value : `#${value}`;
  if (withHash.length === 4) {
    return `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`.toLowerCase();
  }
  return withHash.toLowerCase();
}

export function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  const num = parseInt(normalized.slice(1), 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex({ r, g, b }) {
  const toHex = (n) => Math.round(clamp01(n / 255) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsv({ r, g, b }) {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rf) h = ((gf - bf) / delta) % 6;
    else if (max === gf) h = (bf - rf) / delta + 2;
    else h = (rf - gf) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

export function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let rf = 0;
  let gf = 0;
  let bf = 0;
  if (hh < 1) [rf, gf, bf] = [c, x, 0];
  else if (hh < 2) [rf, gf, bf] = [x, c, 0];
  else if (hh < 3) [rf, gf, bf] = [0, c, x];
  else if (hh < 4) [rf, gf, bf] = [0, x, c];
  else if (hh < 5) [rf, gf, bf] = [x, 0, c];
  else [rf, gf, bf] = [c, 0, x];
  const m = v - c;
  return {
    r: Math.round((rf + m) * 255),
    g: Math.round((gf + m) * 255),
    b: Math.round((bf + m) * 255),
  };
}

export function hexToHsv(hex) {
  return rgbToHsv(hexToRgb(hex));
}

export function hsvToHex(hsv) {
  return rgbToHex(hsvToRgb(hsv));
}

// HSV <-> HSL, for the picker's HSL slider mode (colorPickerDialog.js). h stays
// in degrees throughout; s/v/l are all 0-1 fractions, matching this file's
// existing hsv convention. Exact inverses of each other (verified via the
// round-trip test below) — h passes through untouched in both directions, so
// switching modes mid-edit never perturbs a channel the user didn't touch.
export function hsvToHsl({ h, s, v }) {
  const l = v * (1 - s / 2);
  const sl = l <= 0 || l >= 1 ? 0 : clamp01((v - l) / Math.min(l, 1 - l));
  return { h, s: sl, l: clamp01(l) };
}

export function hslToHsv({ h, s, l }) {
  const v = clamp01(l + s * Math.min(l, 1 - l));
  const sv = v === 0 ? 0 : clamp01(2 * (1 - l / v));
  return { h, s: sv, v };
}

export function hexToHsl(hex) {
  return hsvToHsl(hexToHsv(hex));
}

export function hslToHex(hsl) {
  return hsvToHex(hslToHsv(hsl));
}

// Real alpha compositing — for CANVAS rendering (paintBeadFill in
// beadFill.js), safe because the canvas always fills an explicit #fff (or
// chosen canvas-background) before drawing any cell, every frame. Also safe
// for a DOM element in the one case where THIS element owns a fixed,
// known backdrop it was given specifically to show transparency against —
// colorPickerDialog.js's own live-editing swatch, layered over a checkerboard
// set in CSS. For every other DOM swatch (palette, Manage Colors), where the
// ambient background varies by where the swatch happens to sit, use
// alphaOverWhite below instead — a plain rgba() would composite differently
// in each of those places.
export function hexToRgba(hex, alphaPercent = 100) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alphaPercent / 100)})`;
}

// For DOM swatches whose ancestor background varies (#f8f8f8 side panel,
// #fff manage row) and thus can't be given a controlled backdrop of their
// own — a plain rgba() would composite differently in each place and
// none of them would reliably match what the canvas shows (which always
// composites against a hard-coded white fill). Precomposits the alpha blend
// against white instead, returning a flat OPAQUE hex that reads identically
// everywhere it's used.
export function alphaOverWhite(hex, alphaPercent = 100) {
  const { r, g, b } = hexToRgb(hex);
  const a = clamp01(alphaPercent / 100);
  const blend = (channel) => Math.round(channel * a + 255 * (1 - a));
  return rgbToHex({ r: blend(r), g: blend(g), b: blend(b) });
}
