import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MM_PER_INCH, mmToInches, inchesToMm, formatLength } from '../../units/convert.js';

test('mmToInches converts 25.4mm to 1 inch', () => {
  assert.equal(mmToInches(25.4), 1);
});

test('inchesToMm converts 1 inch to 25.4mm', () => {
  assert.equal(inchesToMm(1), 25.4);
});

test('mmToInches and inchesToMm round-trip', () => {
  assert.ok(Math.abs(inchesToMm(mmToInches(12.7)) - 12.7) < 1e-9);
});

test('formatLength formats mm without conversion', () => {
  assert.equal(formatLength(25.4, 'mm'), '25.40 mm');
});

test('formatLength formats in with conversion', () => {
  assert.equal(formatLength(25.4, 'in'), '1.00 in');
});

test('formatLength respects precision', () => {
  assert.equal(formatLength(MM_PER_INCH * 2, 'in', 0), '2 in');
});
