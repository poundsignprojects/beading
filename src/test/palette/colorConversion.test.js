import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, isValidHex, normalizeHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, hexToHsv, hsvToHex,
  hexToRgba, alphaOverWhite, hsvToHsl, hslToHsv, hexToHsl, hslToHex,
} from '../../palette/colorConversion.js';

test('clamp01 clamps into [0, 1]', () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(0.4), 0.4);
});

test('isValidHex accepts 3- and 6-digit hex, with or without a leading #', () => {
  assert.equal(isValidHex('#ff0000'), true);
  assert.equal(isValidHex('ff0000'), true);
  assert.equal(isValidHex('#f00'), true);
  assert.equal(isValidHex('f00'), true);
  assert.equal(isValidHex('#ff00'), false);
  assert.equal(isValidHex('not-a-color'), false);
  assert.equal(isValidHex(''), false);
});

test('normalizeHex expands 3-digit shorthand and lowercases', () => {
  assert.equal(normalizeHex('#F00'), '#ff0000');
  assert.equal(normalizeHex('ABC'), '#aabbcc');
  assert.equal(normalizeHex('#1a2B3c'), '#1a2b3c');
});

test('hexToRgb / rgbToHex round-trip known values', () => {
  assert.deepEqual(hexToRgb('#ff0000'), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hexToRgb('#00ff80'), { r: 0, g: 255, b: 128 });
  assert.equal(rgbToHex({ r: 255, g: 0, b: 0 }), '#ff0000');
  assert.equal(rgbToHex({ r: 0, g: 255, b: 128 }), '#00ff80');
});

test('rgbToHsv on known primary/secondary colors', () => {
  assert.deepEqual(rgbToHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 255, b: 0 }), { h: 120, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 0, b: 255 }), { h: 240, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, v: 0 });
  assert.deepEqual(rgbToHsv({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, v: 1 });
});

test('hsvToRgb inverts rgbToHsv for known colors', () => {
  assert.deepEqual(hsvToRgb({ h: 0, s: 1, v: 1 }), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hsvToRgb({ h: 120, s: 1, v: 1 }), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hsvToRgb({ h: 240, s: 1, v: 1 }), { r: 0, g: 0, b: 255 });
  assert.deepEqual(hsvToRgb({ h: 0, s: 0, v: 0.5 }), { r: 128, g: 128, b: 128 });
});

test('hexToHsv / hsvToHex round-trip a spread of hex values', () => {
  const samples = ['#ff0000', '#00ff00', '#0000ff', '#c0392b', '#7f8c8d', '#000000', '#ffffff', '#3498db'];
  for (const hex of samples) {
    assert.equal(hsvToHex(hexToHsv(hex)), hex);
  }
});

test('hexToRgba builds an rgba() string at the given alphaPercent', () => {
  assert.equal(hexToRgba('#ff0000', 100), 'rgba(255, 0, 0, 1)');
  assert.equal(hexToRgba('#ff0000', 50), 'rgba(255, 0, 0, 0.5)');
  assert.equal(hexToRgba('#ff0000', 0), 'rgba(255, 0, 0, 0)');
  assert.equal(hexToRgba('#ff0000'), 'rgba(255, 0, 0, 1)'); // defaults to fully opaque
});

test('hexToRgba clamps alphaPercent outside 0-100', () => {
  assert.equal(hexToRgba('#ff0000', 150), 'rgba(255, 0, 0, 1)');
  assert.equal(hexToRgba('#ff0000', -20), 'rgba(255, 0, 0, 0)');
});

test('alphaOverWhite returns the input hex unchanged at alphaPercent 100', () => {
  assert.equal(alphaOverWhite('#3498db', 100), '#3498db');
});

test('alphaOverWhite returns pure white at alphaPercent 0, regardless of input hex', () => {
  assert.equal(alphaOverWhite('#ff0000', 0), '#ffffff');
  assert.equal(alphaOverWhite('#123456', 0), '#ffffff');
});

test('alphaOverWhite blends toward white proportionally at intermediate alpha', () => {
  // #ff0000 at 50% over white -> r stays 255, g/b blend halfway to 255 (128, rounded)
  assert.equal(alphaOverWhite('#ff0000', 50), '#ff8080');
});

test('hsvToHsl on known colors', () => {
  // Pure red: HSV(0, 100%, 100%) -> HSL(0, 100%, 50%).
  assert.deepEqual(hsvToHsl({ h: 0, s: 1, v: 1 }), { h: 0, s: 1, l: 0.5 });
  // Black: v=0 -> l=0, s=0 regardless of input s (achromatic).
  assert.deepEqual(hsvToHsl({ h: 0, s: 1, v: 0 }), { h: 0, s: 0, l: 0 });
  // White: v=1, s=0 -> l=1, s=0.
  assert.deepEqual(hsvToHsl({ h: 0, s: 0, v: 1 }), { h: 0, s: 0, l: 1 });
  // Mid gray: v=0.5, s=0 -> l=0.5, s=0.
  assert.deepEqual(hsvToHsl({ h: 0, s: 0, v: 0.5 }), { h: 0, s: 0, l: 0.5 });
  // HSV(0, 50%, 100%) -> RGB(255, 128, 128) -> HSL(0, 100%, 75%), hand-derived.
  const hsl = hsvToHsl({ h: 0, s: 0.5, v: 1 });
  assert.equal(hsl.h, 0);
  assert.ok(Math.abs(hsl.s - 1) < 1e-9);
  assert.ok(Math.abs(hsl.l - 0.75) < 1e-9);
});

test('hslToHsv inverts hsvToHsl for the same known colors', () => {
  assert.deepEqual(hslToHsv({ h: 0, s: 1, l: 0.5 }), { h: 0, s: 1, v: 1 });
  assert.deepEqual(hslToHsv({ h: 0, s: 0, l: 0 }), { h: 0, s: 0, v: 0 });
  assert.deepEqual(hslToHsv({ h: 0, s: 0, l: 1 }), { h: 0, s: 0, v: 1 });
  const hsv = hslToHsv({ h: 0, s: 1, l: 0.75 });
  assert.equal(hsv.h, 0);
  assert.ok(Math.abs(hsv.s - 0.5) < 1e-9);
  assert.ok(Math.abs(hsv.v - 1) < 1e-9);
});

test('hsvToHsl / hslToHsv round-trip a spread of hsv values without drifting, h untouched', () => {
  const samples = [
    { h: 200, s: 0.3, v: 0.9 }, { h: 45, s: 1, v: 0.4 }, { h: 300, s: 0.6, v: 0.6 },
    { h: 10, s: 0, v: 0.2 }, { h: 359.5, s: 0.8, v: 0.05 },
  ];
  for (const hsv of samples) {
    const roundTripped = hslToHsv(hsvToHsl(hsv));
    assert.ok(Math.abs(roundTripped.h - hsv.h) < 1e-6, `h: ${roundTripped.h} vs ${hsv.h}`);
    assert.ok(Math.abs(roundTripped.s - hsv.s) < 1e-6, `s: ${roundTripped.s} vs ${hsv.s}`);
    assert.ok(Math.abs(roundTripped.v - hsv.v) < 1e-6, `v: ${roundTripped.v} vs ${hsv.v}`);
  }
});

test('hexToHsl / hslToHex round-trip a spread of hex values', () => {
  const samples = ['#ff0000', '#00ff00', '#0000ff', '#c0392b', '#7f8c8d', '#000000', '#ffffff', '#3498db'];
  for (const hex of samples) {
    assert.equal(hslToHex(hexToHsl(hex)), hex);
  }
});

test('rgbToHsv / hsvToRgb round-trip a spread of rgb triples without drifting', () => {
  const samples = [
    { r: 12, g: 200, b: 90 }, { r: 255, g: 128, b: 0 }, { r: 33, g: 33, b: 200 }, { r: 10, g: 10, b: 10 },
  ];
  for (const rgb of samples) {
    const roundTripped = hsvToRgb(rgbToHsv(rgb));
    // Allow +/-1 for rounding through the hue/saturation/value intermediate form.
    assert.ok(Math.abs(roundTripped.r - rgb.r) <= 1, `r: ${roundTripped.r} vs ${rgb.r}`);
    assert.ok(Math.abs(roundTripped.g - rgb.g) <= 1, `g: ${roundTripped.g} vs ${rgb.g}`);
    assert.ok(Math.abs(roundTripped.b - rgb.b) <= 1, `b: ${roundTripped.b} vs ${rgb.b}`);
  }
});
