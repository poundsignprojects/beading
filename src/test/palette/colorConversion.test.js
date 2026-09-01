import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, isValidHex, normalizeHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, hexToHsv, hsvToHex,
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
