import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLoomerlyExport, decodeRuns } from '../../import/loomerlyParser.js';

// Fixtures below are built from real Loomerly export text (see .work/samples/ and the
// geometry validation done during this feature's session) — not synthesized guesses.

test('decodeRuns expands run-length-encoded text into a flat bead list', () => {
  assert.deepEqual(decodeRuns('(3)D'), ['D', 'D', 'D']);
  assert.deepEqual(decodeRuns('(1)C, (8)D'), ['C', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D']);
});

test('decodeRuns treats a bare "-" as zero beads (fully tapered-off row)', () => {
  assert.deepEqual(decodeRuns('-'), []);
});

test('decodeRuns treats an interior "(N)-" run as N literal blank positions', () => {
  assert.deepEqual(decodeRuns('(3)B, (14)-, (3)B'), [
    'B', 'B', 'B',
    null, null, null, null, null, null, null, null, null, null, null, null, null, null,
    'B', 'B', 'B',
  ]);
});

test('parses a real single-color tapered strip sample end to end', () => {
  const pageTexts = [
    'Pattern copy copy copy copy copy\nType: Peyote\nWidth: 19\nHeight: 80\nFinished size: 1.2 x 6.6"\nTotal beads: 1,398',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (3)D\nRow 3 ( ) (1)D\nRow 4 ( ) (2)D',
    'Row 5 ( ) (3)D\nRow 6 ( ) (4)D\nRow 160 ( ) -\nWord Chart\nPage 7 of 8\nPattern copy copy copy copy copy',
    'Miyuki Rocailles 11/0 (M)\nM01\nM16F\nA\nB\nSilver Lined Crystal\nMatte Silver Lined Green\nCount: 25\nCount: 84\nColor List\nPage 8 of 8\nPattern copy copy copy copy copy',
  ];

  const result = parseLoomerlyExport(pageTexts);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.meta, {
    type: 'Peyote',
    width: 19,
    height: 80,
    finishedSizeIn: '1.2 x 6.6"',
    totalBeads: 1398,
  });
  assert.equal(result.startingBead, 'Top Right');
  assert.equal(result.rowEntries.length, 6);
  assert.deepEqual(result.rowEntries[0], { rowNumbers: [1, 2], runs: ['D', 'D', 'D'] });
  assert.deepEqual(result.rowEntries[1], { rowNumbers: [3], runs: ['D'] });
  assert.deepEqual(result.rowEntries.at(-1), { rowNumbers: [160], runs: [] });
  assert.equal(result.beadTypeCatalogPrefix, 'Rocailles');
  assert.deepEqual(result.colors, [
    { code: 'A', catalogNumber: 'M01', name: 'Silver Lined Crystal', count: 25 },
    { code: 'B', catalogNumber: 'M16F', name: 'Matte Silver Lined Green', count: 84 },
  ]);
});

test('parses a color list with no bead-type header line (real Loomerly behavior — not every export has one)', () => {
  const pageTexts = [
    'Tesselation 1 Long\nType: Peyote\nWidth: 30\nHeight: 40\nFinished size: 1.6 x 2.7"\nTotal beads: 1,200',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (3)A, (6)B, (7)A, (7)C, (7)A\nRow 3 ( ) (4)A, (3)C, (1)B, (2)A, (3)B, (2)A',
    '01\n02\n03\nA\nB\nC\nWhite\nBlack\nGrey\nCount: 350\nCount: 472\nCount: 378\nPage 5 of 5\nTesselation 1 Long',
  ];

  const result = parseLoomerlyExport(pageTexts);
  assert.equal(result.error, undefined);
  assert.equal(result.beadTypeHeaderRaw, null);
  assert.equal(result.beadTypeCatalogPrefix, null);
  assert.deepEqual(result.colors, [
    { code: 'A', catalogNumber: '01', name: 'White', count: 350 },
    { code: 'B', catalogNumber: '02', name: 'Black', count: 472 },
    { code: 'C', catalogNumber: '03', name: 'Grey', count: 378 },
  ]);
});

test('parses a combined-line direction marker whether the arrow glyph extracted or not', () => {
  // pdf.js gives back an empty string for the arrow glyph against every real sample this
  // feature was built from — direction text inside the parens should never be required.
  const withArrow = 'Row 3 (→) (2)A';
  const withoutArrow = 'Row 3 ( ) (2)A';
  const base = [
    'Title\nType: Peyote\nWidth: 4\nHeight: 10\nFinished size: 0.2 x 0.8"\nTotal beads: 40',
    `Word Chart\nStarting bead: Top Right\nRow 1&2 (←) (1)B, (1)A, (1)B, (1)A\n${withArrow}`,
    'Row 4 (←) (2)B\nA\nM01\nSilver Lined Crystal\nCount: 18\nB\nM401\nBlack\nCount: 22',
  ];
  const withoutArrowPages = [base[0], base[1].replace(withArrow, withoutArrow), base[2]];

  const resultWithArrow = parseLoomerlyExport(base);
  const resultWithoutArrow = parseLoomerlyExport(withoutArrowPages);
  assert.deepEqual(resultWithArrow.rowEntries[1], { rowNumbers: [3], runs: ['A', 'A'] });
  assert.deepEqual(resultWithoutArrow.rowEntries[1], { rowNumbers: [3], runs: ['A', 'A'] });
});

test('color-list body ignores footer echoes of the title and section headings at the word-chart/color-list boundary', () => {
  // The last word-chart page's own footer ("Word Chart" / "Page N of M" / title, each its
  // own line — see pdfText.js) sits directly between the last Row line and the first real
  // color-list line on every real multi-page sample. None of it should leak into the
  // classified names/catalogs buckets.
  const pageTexts = [
    'My Pattern\nType: Peyote\nWidth: 4\nHeight: 4\nFinished size: 0.2 x 0.3"\nTotal beads: 16',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (2)A, (2)B\nRow 3 ( ) (2)A\nRow 4 ( ) (2)B\nWord Chart\nPage 1 of 2\nMy Pattern',
    'A\nM01\nCrystal\nCount: 8\nB\nM02\nBlack\nCount: 8\nColor List\nPage 2 of 2\nMy Pattern',
  ];
  const result = parseLoomerlyExport(pageTexts);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.colors, [
    { code: 'A', catalogNumber: 'M01', name: 'Crystal', count: 8 },
    { code: 'B', catalogNumber: 'M02', name: 'Black', count: 8 },
  ]);
});

test('rejects a non-Peyote pattern type with a clear error', () => {
  const pageTexts = ['Type: Brick\nWidth: 10\nHeight: 10\nTotal beads: 100'];
  const result = parseLoomerlyExport(pageTexts);
  assert.match(result.error, /only supports Peyote/);
});

test('rejects a multi-section pattern with a clear error', () => {
  const pageTexts = [
    'Type: Peyote\nWidth: 10\nHeight: 10\nTotal beads: 100',
    'Section 2 of 3 Page 1 of 5 Title',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (2)A',
    'A\nM01\nName\nCount: 100',
  ];
  const result = parseLoomerlyExport(pageTexts);
  assert.match(result.error, /single-section/);
});

test('does not reject a pattern whose "Section 1 of 1" text was not extractable', () => {
  // Confirmed against real samples: three of four gathered this session never printed
  // "Section 1 of 1" as extractable text at all (see the plan) — absence must not block.
  const pageTexts = [
    'Type: Peyote\nWidth: 10\nHeight: 10\nTotal beads: 100',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (2)A',
    'A\nM01\nName\nCount: 100',
  ];
  const result = parseLoomerlyExport(pageTexts);
  assert.equal(result.error, undefined);
});

test('returns a clear error when header stats are missing entirely', () => {
  const result = parseLoomerlyExport(['This is not a Loomerly export at all.']);
  assert.match(result.error, /header stats/);
});

test('returns a clear error when no word chart rows are found', () => {
  const pageTexts = ['Type: Peyote\nWidth: 10\nHeight: 10\nTotal beads: 100', 'Nothing else here.'];
  const result = parseLoomerlyExport(pageTexts);
  assert.match(result.error, /word chart rows/);
});

test('returns a clear error when no color list is found', () => {
  const pageTexts = [
    'Type: Peyote\nWidth: 10\nHeight: 10\nTotal beads: 100',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (2)A',
  ];
  const result = parseLoomerlyExport(pageTexts);
  assert.match(result.error, /color list/);
});
