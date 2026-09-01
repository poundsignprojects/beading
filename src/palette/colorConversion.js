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
