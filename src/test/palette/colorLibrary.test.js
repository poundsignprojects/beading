import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSwatchAppearance, normalizeFinish, UNASSIGNED_SWATCH } from '../../palette/colorLibrary.js';

const customColors = [
  { id: 'red', name: 'Red', hex: '#ff0000', alphaPercent: 100, matte: false, metallic: false },
  { id: 'blue', name: 'Blue', hex: '#0000ff', alphaPercent: 50, matte: true, metallic: true },
];

test('resolveSwatchAppearance returns UNASSIGNED_SWATCH for colorId null', () => {
  assert.equal(resolveSwatchAppearance(customColors, null), UNASSIGNED_SWATCH);
});

test('resolveSwatchAppearance returns the matching swatch\'s hex/alpha/finish for a real colorId', () => {
  assert.deepEqual(resolveSwatchAppearance(customColors, 'blue'), { hex: '#0000ff', alphaPercent: 50, matte: true, metallic: true });
});

test('resolveSwatchAppearance returns null (not a fallback) for a colorId with no matching entry', () => {
  assert.equal(resolveSwatchAppearance(customColors, 'deleted-color-id'), null);
});

test('normalizeFinish maps a legacy luster of matte to no finish at all, not the new Matte', () => {
  assert.deepEqual(normalizeFinish({ luster: 'matte' }), { matte: false, metallic: false });
});

test('normalizeFinish maps a legacy luster of shiny to Metallic', () => {
  assert.deepEqual(normalizeFinish({ luster: 'shiny' }), { matte: false, metallic: true });
});

test('normalizeFinish treats a record with no finish fields as no finish', () => {
  assert.deepEqual(normalizeFinish({}), { matte: false, metallic: false });
});

test('normalizeFinish keeps the new flags independently, ignoring a stale luster', () => {
  assert.deepEqual(normalizeFinish({ matte: true, metallic: false, luster: 'shiny' }), { matte: true, metallic: false });
  assert.deepEqual(normalizeFinish({ matte: true, metallic: true }), { matte: true, metallic: true });
  assert.deepEqual(normalizeFinish({ matte: false, metallic: false, luster: 'shiny' }), { matte: false, metallic: false });
});
