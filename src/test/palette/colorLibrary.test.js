import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSwatchHex, UNASSIGNED_SWATCH } from '../../palette/colorLibrary.js';

const customColors = [
  { id: 'red', name: 'Red', hex: '#ff0000' },
  { id: 'blue', name: 'Blue', hex: '#0000ff' },
];

test('resolveSwatchHex returns UNASSIGNED_SWATCH.hex for colorId null', () => {
  assert.equal(resolveSwatchHex(customColors, null), UNASSIGNED_SWATCH.hex);
});

test('resolveSwatchHex returns the matching swatch\'s hex for a real colorId', () => {
  assert.equal(resolveSwatchHex(customColors, 'blue'), '#0000ff');
});

test('resolveSwatchHex returns null (not a fallback string) for a colorId with no matching entry', () => {
  assert.equal(resolveSwatchHex(customColors, 'deleted-color-id'), null);
});
