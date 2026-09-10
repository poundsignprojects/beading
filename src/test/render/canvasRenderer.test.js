import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCanvasBackgroundFillStyle } from '../../render/canvasRenderer.js';

test('resolveCanvasBackgroundFillStyle defaults to white with no args', () => {
  assert.equal(resolveCanvasBackgroundFillStyle(), '#fff');
});

test('resolveCanvasBackgroundFillStyle white mode', () => {
  assert.equal(resolveCanvasBackgroundFillStyle({ mode: 'white' }), '#fff');
});

test('resolveCanvasBackgroundFillStyle dark mode', () => {
  assert.equal(resolveCanvasBackgroundFillStyle({ mode: 'dark' }), '#242424');
});

test('resolveCanvasBackgroundFillStyle custom mode with a hex chosen', () => {
  assert.equal(resolveCanvasBackgroundFillStyle({ mode: 'custom', hex: '#3498db' }), '#3498db');
});

test('resolveCanvasBackgroundFillStyle custom mode with no hex chosen yet falls back to white', () => {
  assert.equal(resolveCanvasBackgroundFillStyle({ mode: 'custom', hex: null }), '#fff');
});

test('resolveCanvasBackgroundFillStyle checkerboard mode returns the sentinel, not a hex', () => {
  assert.equal(resolveCanvasBackgroundFillStyle({ mode: 'checkerboard' }), 'checkerboard');
});
