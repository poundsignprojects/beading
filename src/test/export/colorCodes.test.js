import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignColorCodes } from '../../export/colorCodes.js';

test('assignColorCodes: most-used color gets A', () => {
  const codes = assignColorCodes([
    { colorId: 'red', count: 3 },
    { colorId: 'blue', count: 10 },
    { colorId: 'green', count: 1 },
  ]);
  assert.equal(codes.get('blue'), 'A');
});

test('assignColorCodes: a 30-color fixture rolls over into AA, AB, ...', () => {
  const colorCounts = Array.from({ length: 30 }, (_, i) => ({
    colorId: `color${i}`,
    count: 30 - i, // strictly descending so sort order is unambiguous
  }));
  const codes = assignColorCodes(colorCounts);
  assert.equal(codes.get('color0'), 'A');
  assert.equal(codes.get('color25'), 'Z');
  assert.equal(codes.get('color26'), 'AA');
  assert.equal(codes.get('color27'), 'AB');
  assert.equal(codes.get('color29'), 'AD');
});

test('assignColorCodes: a color with zero uses never gets a code', () => {
  const codes = assignColorCodes([{ colorId: 'red', count: 5 }]);
  assert.equal(codes.get('unused'), undefined);
  assert.equal(codes.size, 1);
});

test('assignColorCodes: output is a plain Map keyed by colorId', () => {
  const codes = assignColorCodes([{ colorId: 'red', count: 1 }]);
  assert.ok(codes instanceof Map);
});
