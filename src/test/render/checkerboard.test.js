import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxBlurWrapped } from '../../render/checkerboard.js';

// A size x size opaque grayscale tile from a (x, y) => value function.
function tile(size, valueAt) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = valueAt(x, y);
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  }
  return data;
}

const checker = (square) => (x, y) => ((Math.floor(x / square) + Math.floor(y / square)) % 2 === 0 ? 200 : 255);

test('boxBlurWrapped leaves a uniform tile unchanged', () => {
  const data = tile(8, () => 123);
  assert.deepEqual(boxBlurWrapped(data, 8, 2, 3), data);
});

test('boxBlurWrapped returns a copy untouched when radius is below 1', () => {
  const data = tile(8, checker(4));
  const result = boxBlurWrapped(data, 8, 0, 3);
  assert.deepEqual(result, data);
  assert.notEqual(result, data);
});

test('boxBlurWrapped softens a checker edge without changing alpha or the overall average', () => {
  const size = 16;
  const data = tile(size, checker(8));
  const result = boxBlurWrapped(data, size, 1, 3);
  const edge = (0 * size + 7) * 4; // last pixel of the dark square, next to a light one
  assert.ok(result[edge] > 200 && result[edge] < 255);
  let before = 0;
  let after = 0;
  for (let i = 0; i < data.length; i += 4) {
    before += data[i];
    after += result[i];
    assert.equal(result[i + 3], 255);
  }
  assert.ok(Math.abs(before - after) / (size * size) < 1);
});

test('boxBlurWrapped wraps at the edges, so a repeating tile stays seamless', () => {
  const size = 16;
  const result = boxBlurWrapped(tile(size, checker(8)), size, 1, 3);
  const at = (x, y) => result[(y * size + x) * 4];
  // The checker is symmetric about each square boundary, including the one
  // that only exists across the wrap (x = 15 | x = 0).
  assert.equal(at(0, 3) - 200, 255 - at(15, 3));
  assert.equal(at(8, 3) - 255, 200 - at(7, 3));
});
