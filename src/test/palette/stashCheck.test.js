import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findStashShortfalls } from '../../palette/stashCheck.js';

function color(id, name, stashCount) {
  return { id, name, stashCount };
}

test('a color with no stashCount set is never compared, even if the pattern needs a lot of it', () => {
  const colorCounts = [{ colorId: 'red', count: 500 }];
  const customColors = [color('red', 'Red', null)];
  assert.deepEqual(findStashShortfalls(colorCounts, customColors), []);
});

test('a color with stashCount undefined (never migrated/set) is also never compared', () => {
  const colorCounts = [{ colorId: 'red', count: 500 }];
  const customColors = [{ id: 'red', name: 'Red' }];
  assert.deepEqual(findStashShortfalls(colorCounts, customColors), []);
});

test('a color with enough stash is not reported', () => {
  const colorCounts = [{ colorId: 'red', count: 10 }];
  const customColors = [color('red', 'Red', 10)];
  assert.deepEqual(findStashShortfalls(colorCounts, customColors), []);
});

test('a color needing more than the stash count is reported with the exact needed/stash numbers', () => {
  const colorCounts = [{ colorId: 'red', count: 120 }];
  const customColors = [color('red', 'Red', 80)];
  assert.deepEqual(findStashShortfalls(colorCounts, customColors), [
    { colorId: 'red', name: 'Red', needed: 120, stashCount: 80 },
  ]);
});

test('a stashCount of 0 is a real tracked value, not "unset" — still compared', () => {
  const colorCounts = [{ colorId: 'red', count: 1 }];
  const customColors = [color('red', 'Red', 0)];
  assert.deepEqual(findStashShortfalls(colorCounts, customColors), [
    { colorId: 'red', name: 'Red', needed: 1, stashCount: 0 },
  ]);
});

test('a dangling colorId with no matching custom color is skipped, not thrown', () => {
  const colorCounts = [{ colorId: 'ghost', count: 5 }];
  const customColors = [];
  assert.deepEqual(findStashShortfalls(colorCounts, customColors), []);
});

test('mixed pattern: only the colors actually short are reported, in colorCounts order', () => {
  const colorCounts = [
    { colorId: 'red', count: 120 },
    { colorId: 'blue', count: 10 },
    { colorId: 'green', count: 40 },
  ];
  const customColors = [
    color('red', 'Red', 80), // short
    color('blue', 'Blue', 10), // exactly enough
    color('green', 'Green', 15), // short
  ];
  assert.deepEqual(findStashShortfalls(colorCounts, customColors), [
    { colorId: 'red', name: 'Red', needed: 120, stashCount: 80 },
    { colorId: 'green', name: 'Green', needed: 40, stashCount: 15 },
  ]);
});
