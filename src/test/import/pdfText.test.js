import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructPageText } from '../../import/pdfText.js';

test('reconstructPageText joins ordinary same-line items with no gap', () => {
  // Coordinates modeled on a real Loomerly word-chart line, where pdf.js's text layer
  // gives back an empty string for the direction-arrow glyph (see the plan — the font's
  // subset has no ToUnicode mapping for that icon glyph).
  const items = [
    { str: 'Row 1&2 (', x: 50, y: 667.25, width: 46.7 },
    { str: '', x: 96.7, y: 667.25, width: 0 },
    { str: ' ', x: 96.7, y: 667.25, width: 10 },
    { str: ') (3)D', x: 106.7, y: 667.25, width: 30 },
  ];
  assert.equal(reconstructPageText(items), 'Row 1&2 ( ) (3)D');
});

test('reconstructPageText splits same-y items into separate lines across a big x gap', () => {
  // Modeled on a real color-list page: three colors' catalog numbers print at the same y,
  // with no whitespace between them in the raw item stream.
  const items = [
    { str: 'M01', x: 76, y: 694, width: 17.4 },
    { str: 'M16F', x: 246.7, y: 694, width: 21.8 },
    { str: 'M135', x: 417.3, y: 694, width: 22.3 },
  ];
  assert.deepEqual(reconstructPageText(items).split('\n'), ['M01', 'M16F', 'M135']);
});

test('reconstructPageText separates rows at different y even with no x gap', () => {
  const items = [
    { str: 'Row 3 ( ) (1)D', x: 50, y: 649.25, width: 60 },
    { str: 'Row 4 ( ) (2)D', x: 50, y: 631.25, width: 60 },
  ];
  assert.deepEqual(reconstructPageText(items).split('\n'), ['Row 3 ( ) (1)D', 'Row 4 ( ) (2)D']);
});

test('reconstructPageText treats a small y jitter as the same line', () => {
  const items = [
    { str: 'A', x: 40, y: 100.0, width: 5 },
    { str: 'B', x: 50, y: 101.4, width: 5 }, // within SAME_LINE_Y_TOLERANCE_PT
  ];
  assert.equal(reconstructPageText(items), 'AB');
});

test('reconstructPageText drops empty items and blank lines', () => {
  const items = [
    { str: '', x: 10, y: 10, width: 0 },
    { str: '  ', x: 10, y: 10, width: 0 },
  ];
  assert.equal(reconstructPageText(items), '');
});

test('reconstructPageText reconstructs a full multi-color color-list row group in document order', () => {
  // Modeled directly on a real page: catalog#/code/name/count each print as their own
  // y-band, colors left-to-right within each band, no header line above them.
  const items = [
    { str: 'A', x: 46.1, y: 733.6, width: 7.8 },
    { str: '01', x: 66, y: 739.5, width: 9.7 },
    { str: 'White', x: 66, y: 727, width: 23 },
    { str: 'Count: 350', x: 66, y: 714.5, width: 43 },
    { str: 'B', x: 223.6, y: 733.6, width: 7.5 },
    { str: '02', x: 243.3, y: 739.5, width: 9.7 },
    { str: 'Black', x: 243.3, y: 727, width: 20.9 },
    { str: 'Count: 472', x: 243.3, y: 714.5, width: 43 },
  ];
  assert.deepEqual(reconstructPageText(items).split('\n'), [
    '01', '02',
    'A', 'B',
    'White', 'Black',
    'Count: 350', 'Count: 472',
  ]);
});
