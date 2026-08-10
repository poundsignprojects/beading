import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPhotoPlacement, scalePhotoToAnchor } from '../../state/photoTrace.js';

test('defaultPhotoPlacement: centers a wider-than-tall image against a wider grid box', () => {
  // Image aspect 2:1, grid box aspect 4:1 (wider) — image's width is the
  // constraining dimension once scaled to fit height... actually height is the
  // binding constraint here since the grid is proportionally wider than the image.
  const placement = defaultPhotoPlacement(200, 100, { widthMm: 400, heightMm: 100 });
  // scale = min(400/200, 100/100) = min(2, 1) = 1
  assert.equal(placement.widthMm, 200);
  assert.equal(placement.heightMm, 100);
  assert.equal(placement.xMm, (400 - 200) / 2);
  assert.equal(placement.yMm, 0);
});

test('defaultPhotoPlacement: centers a wider-than-tall image against a taller grid box', () => {
  // Same image, grid box now proportionally taller (100x400) — width is binding.
  const placement = defaultPhotoPlacement(200, 100, { widthMm: 100, heightMm: 400 });
  // scale = min(100/200, 400/100) = min(0.5, 4) = 0.5
  assert.equal(placement.widthMm, 100);
  assert.equal(placement.heightMm, 50);
  assert.equal(placement.xMm, 0);
  assert.equal(placement.yMm, (400 - 50) / 2);
});

test('scalePhotoToAnchor: scaleFactor 1 is a no-op', () => {
  const photo = { xMm: 10, yMm: 20, widthMm: 50, heightMm: 30 };
  const result = scalePhotoToAnchor(photo, { xMm: 30, yMm: 30 }, 1);
  assert.equal(result.widthMm, 50);
  assert.equal(result.heightMm, 30);
  assert.equal(result.xMm, 10);
  assert.equal(result.yMm, 20);
});

test('scalePhotoToAnchor: keeps the anchor point\'s fractional position within the photo constant', () => {
  const photo = { xMm: 10, yMm: 20, widthMm: 50, heightMm: 30 };
  const anchor = { xMm: 30, yMm: 30 }; // 40% across, 33.3% down
  const fracXBefore = (anchor.xMm - photo.xMm) / photo.widthMm;
  const fracYBefore = (anchor.yMm - photo.yMm) / photo.heightMm;

  for (const scaleFactor of [2, 0.5, 1.5]) {
    const result = scalePhotoToAnchor(photo, anchor, scaleFactor);
    const fracXAfter = (anchor.xMm - result.xMm) / result.widthMm;
    const fracYAfter = (anchor.yMm - result.yMm) / result.heightMm;
    assert.ok(Math.abs(fracXAfter - fracXBefore) < 1e-9, `x fraction drifted at scale ${scaleFactor}`);
    assert.ok(Math.abs(fracYAfter - fracYBefore) < 1e-9, `y fraction drifted at scale ${scaleFactor}`);
  }
});
