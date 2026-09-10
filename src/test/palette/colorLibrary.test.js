import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSwatchAppearance, UNASSIGNED_SWATCH } from '../../palette/colorLibrary.js';

const customColors = [
  { id: 'red', name: 'Red', hex: '#ff0000', alphaPercent: 100, luster: 'matte' },
  { id: 'blue', name: 'Blue', hex: '#0000ff', alphaPercent: 50, luster: 'shiny' },
];

test('resolveSwatchAppearance returns UNASSIGNED_SWATCH for colorId null', () => {
  assert.equal(resolveSwatchAppearance(customColors, null), UNASSIGNED_SWATCH);
});

test('resolveSwatchAppearance returns the matching swatch\'s hex/alpha/luster for a real colorId', () => {
  assert.deepEqual(resolveSwatchAppearance(customColors, 'blue'), { hex: '#0000ff', alphaPercent: 50, luster: 'shiny' });
});

test('resolveSwatchAppearance returns null (not a fallback) for a colorId with no matching entry', () => {
  assert.equal(resolveSwatchAppearance(customColors, 'deleted-color-id'), null);
});
