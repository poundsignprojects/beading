import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldToScreen, screenToWorld } from '../../render/viewport.js';

const viewport = { originXmm: 5, originYmm: 10, scalePxPerMm: 4 };

test('worldToScreen: origin maps to screen (0,0)', () => {
  assert.deepEqual(worldToScreen(5, 10, viewport), { xPx: 0, yPx: 0 });
});

test('worldToScreen: known offset scales correctly', () => {
  const screen = worldToScreen(7, 12, viewport);
  assert.equal(screen.xPx, 8); // (7-5)*4
  assert.equal(screen.yPx, 8); // (12-10)*4
});

test('screenToWorld: screen (0,0) maps back to origin', () => {
  assert.deepEqual(screenToWorld(0, 0, viewport), { xMm: 5, yMm: 10 });
});

test('worldToScreen/screenToWorld round-trip at arbitrary coordinates', () => {
  const world = { xMm: 123.4, yMm: -56.7 };
  const screen = worldToScreen(world.xMm, world.yMm, viewport);
  const roundTripped = screenToWorld(screen.xPx, screen.yPx, viewport);
  assert.ok(Math.abs(roundTripped.xMm - world.xMm) < 1e-9);
  assert.ok(Math.abs(roundTripped.yMm - world.yMm) < 1e-9);
});

test('round-trip holds at a different scale', () => {
  const vp2 = { originXmm: 0, originYmm: 0, scalePxPerMm: 0.5 };
  const screen = worldToScreen(200, 300, vp2);
  const world = screenToWorld(screen.xPx, screen.yPx, vp2);
  assert.ok(Math.abs(world.xMm - 200) < 1e-9);
  assert.ok(Math.abs(world.yMm - 300) < 1e-9);
});
