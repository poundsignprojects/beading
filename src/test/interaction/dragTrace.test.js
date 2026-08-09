import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolatedWorldPoints } from '../../interaction/dragTrace.js';

test('interpolatedWorldPoints: last point exactly matches the target (no drift)', () => {
  const points = interpolatedWorldPoints({ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 5 }, 0.5);
  const last = points[points.length - 1];
  assert.equal(last.xMm, 10);
  assert.equal(last.yMm, 5);
});

test('interpolatedWorldPoints: point count scales with distance / stepMm', () => {
  const points = interpolatedWorldPoints({ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, 1);
  assert.equal(points.length, 10);
});

test('interpolatedWorldPoints: zero-distance move still returns the endpoint', () => {
  const points = interpolatedWorldPoints({ xMm: 3, yMm: 3 }, { xMm: 3, yMm: 3 }, 0.5);
  assert.deepEqual(points, [{ xMm: 3, yMm: 3 }]);
});

test('interpolatedWorldPoints: very small distance below stepMm still returns one point at the target', () => {
  const points = interpolatedWorldPoints({ xMm: 0, yMm: 0 }, { xMm: 0.01, yMm: 0 }, 0.8);
  assert.equal(points.length, 1);
  assert.equal(points[0].xMm, 0.01);
});

test('interpolatedWorldPoints: very large distance produces no drift at the endpoint', () => {
  const points = interpolatedWorldPoints({ xMm: 0, yMm: 0 }, { xMm: 10000, yMm: -3000 }, 0.65);
  const last = points[points.length - 1];
  assert.equal(last.xMm, 10000);
  assert.equal(last.yMm, -3000);
});
