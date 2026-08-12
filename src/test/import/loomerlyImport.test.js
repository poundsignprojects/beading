import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLoomerlyExport } from '../../import/loomerlyParser.js';
import { buildGridFromLoomerly, guessBeadType, computeImportWarnings } from '../../import/loomerlyImport.js';

function parse(pageTexts) {
  const result = parseLoomerlyExport(pageTexts);
  assert.equal(result.error, undefined, `fixture failed to parse: ${result.error}`);
  return result;
}

// Ground truth for this fixture: a real 4-wide x 10-tall, 2-color Loomerly sample with
// genuine readable arrows (gathered this session specifically to nail down direction —
// see .work/fix-wordchart-half-pass-splitting-plan.md for how it was used) and a picture
// chart confirming the exact expected per-band layout by hand.
const TINY_SAMPLE_PAGES = [
  'Pattern\nType: Peyote\nWidth: 4\nHeight: 10\nFinished size: 0.2 x 0.8"\nTotal beads: 40',
  [
    'Word Chart',
    'Starting bead: Top Right',
    'Row 1&2 (←) (1)B, (1)A, (1)B, (1)A',
    'Row 3 (→) (2)A',
    'Row 4 (←) (2)B',
    'Row 5 (→) (2)A',
    'Row 6 (←) (2)B',
    'Row 7 (→) (2)A',
    'Row 8 (←) (2)B',
    'Row 9 (→) (2)A',
    'Row 10 (←) (2)B',
    'Row 11 (→) (2)A',
    'Row 12 (←) (2)B',
    'Row 13 (→) (2)A',
    'Row 14 (←) (2)B',
    'Row 15 (→) (2)A',
    'Row 16 (←) (2)B',
    'Row 17 (→) (2)A',
    'Row 18 (←) (2)B',
    'Row 19 (→) (2)B',
    'Row 20 (←) (2)B',
  ].join('\n'),
  'Miyuki Rocailles 11/0 (M)\nA\nM01\nSilver Lined Crystal\nCount: 18\nB\nM401\nBlack\nCount: 22',
];

test('buildGridFromLoomerly reconstructs the tiny ground-truth sample exactly', () => {
  const parsed = parse(TINY_SAMPLE_PAGES);
  const grid = buildGridFromLoomerly(parsed);
  assert.equal(grid.error, undefined);
  assert.equal(grid.rows, 4);
  assert.equal(grid.cols, 10);
  assert.equal(grid.bandCount, 10);
  assert.equal(grid.shapeEntries.length, 40);

  // band 0 (foundation, "Row 1&2 (←) (1)B, (1)A, (1)B, (1)A") is printed *reversed*
  // relative to canonical order -- it's printed line 0 (even index), same direction
  // convention as every other even-indexed line (Row 4, Row 6, ...) -- so rows 0-3 of
  // column 0 read A,B,A,B (reverse of the raw printed text), matching the sample's own
  // picture-chart page exactly, and matching every other band's own A,B,A,B pattern
  // (see band 1 below) rather than standing out as a mirrored first band.
  const band0 = new Map(grid.colorEntries.filter(([key]) => key.endsWith(',0')));
  assert.equal(band0.get('0,0'), 'A');
  assert.equal(band0.get('1,0'), 'B');
  assert.equal(band0.get('2,0'), 'A');
  assert.equal(band0.get('3,0'), 'B');

  // band 1 (Row 3 "(2)A" + Row 4 "(2)B") interleaves to B,A,B,A -- canonB (Row 4, reversed)
  // lands first/leftmost, canonA (Row 3) second. This was originally hand-read against
  // this sample's own tiny picture chart as A,B,A,B (the opposite push order) -- that
  // reading turned out to be a mistake, found and corrected in a later session via a much
  // stronger ground truth: a different real sample's PDF embeds an exact per-bead text
  // grid, independently confirming B-before-A across 10 real consecutive bands (see
  // bandFromPair's header comment in loomerlyImport.js for the full derivation).
  const band1 = new Map(grid.colorEntries.filter(([key]) => key.endsWith(',1')));
  assert.equal(band1.get('0,1'), 'B');
  assert.equal(band1.get('1,1'), 'A');
  assert.equal(band1.get('2,1'), 'B');
  assert.equal(band1.get('3,1'), 'A');

  // last band ("Row 19 (2)B" + "Row 20 (2)B") is solid B, matching the picture's tip
  const band9 = new Map(grid.colorEntries.filter(([key]) => key.endsWith(',9')));
  assert.equal(band9.get('0,9'), 'B');
  assert.equal(band9.get('1,9'), 'B');
  assert.equal(band9.get('2,9'), 'B');
  assert.equal(band9.get('3,9'), 'B');
});

test('buildGridFromLoomerly centers a shaped row within the full band width', () => {
  // Real excerpt (see .work/samples/'s lattice sample): Row 3 and Row 4 are shorter than
  // the piece's full band capacity (55) -- the leftover must land as symmetric padding at
  // both ends, not left- or right-aligned.
  const pages = [
    'Title\nType: Peyote\nWidth: 55\nHeight: 89\nFinished size: 3.0 x 5.9"\nTotal beads: 4496',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (3)B, (31)-, (3)B\nRow 3 ( ) (3)B, (14)-, (3)B\nRow 4 ( ) (4)B, (13)-, (4)B',
    'A\nDB1\nName\nCount: 1',
  ];
  const parsed = parse(pages);
  const grid = buildGridFromLoomerly(parsed);
  const band1Rows = grid.shapeEntries
    .filter((k) => k.endsWith(',1'))
    .map((k) => Number(k.split(',')[0]))
    .sort((a, b) => a - b);
  // verified independently against the real module before being hardcoded here (updated
  // for bandFromPair's corrected push order -- see its header comment; centering itself,
  // i.e. this band's overall 7..47 span, is unaffected, only which interior offset within
  // that span ends up null shifts by one)
  assert.deepEqual(band1Rows, [7, 8, 9, 10, 11, 12, 13, 41, 42, 43, 44, 45, 46, 47]);
});

test('buildGridFromLoomerly interleaves unequal-length pair halves (a genuine shaping row)', () => {
  const pages = [
    'Title\nType: Peyote\nWidth: 10\nHeight: 4\nFinished size: 0.4 x 0.4"\nTotal beads: 30',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (4)A\nRow 3 ( ) (1)B, (1)C\nRow 4 ( ) (3)D',
    'A\nM1\nName\nCount: 1\nB\nM2\nName\nCount: 1\nC\nM3\nName\nCount: 1\nD\nM4\nName\nCount: 1',
  ];
  const parsed = parse(pages);
  const grid = buildGridFromLoomerly(parsed);
  // canonA = [B,C] as-is; canonB = reverse([D,D,D]) = [D,D,D]; interleave (B pushed
  // first, per bandFromPair's corrected push order) -> D,B,D,C,D
  const band1 = new Map(grid.colorEntries.filter(([key]) => key.endsWith(',1')));
  const rows = grid.shapeEntries.filter((k) => k.endsWith(',1')).map((k) => Number(k.split(',')[0])).sort((a, b) => a - b);
  assert.deepEqual(rows, [2, 3, 4, 5, 6]); // 10-wide capacity, 5-bead band centered: start=floor((10-5)/2)=2
  assert.equal(band1.get('2,1'), 'D');
  assert.equal(band1.get('3,1'), 'B');
  assert.equal(band1.get('4,1'), 'D');
  assert.equal(band1.get('5,1'), 'C');
  assert.equal(band1.get('6,1'), 'D');
});

test('buildGridFromLoomerly leaves a fully blank pass ("-" alone) contributing nothing to its band', () => {
  const pages = [
    'Title\nType: Peyote\nWidth: 4\nHeight: 3\nFinished size: 0.2 x 0.2"\nTotal beads: 6',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (2)A, (2)A\nRow 3 ( ) (2)A\nRow 4 ( ) -',
    'A\nM1\nName\nCount: 1',
  ];
  const parsed = parse(pages);
  const grid = buildGridFromLoomerly(parsed);
  const band1 = grid.shapeEntries.filter((k) => k.endsWith(',1'));
  assert.equal(band1.length, 2); // only Row 3's 2 beads -- Row 4 contributed nothing
});

test('buildGridFromLoomerly reports an error for an odd number of rows after the foundation', () => {
  const parsed = {
    meta: { width: 4, height: 3, totalBeads: 10, finishedSizeIn: null },
    rowEntries: [
      { rowNumbers: [1, 2], runs: ['A', 'A', 'A', 'A'] },
      { rowNumbers: [3], runs: ['A', 'A'] },
    ],
  };
  const grid = buildGridFromLoomerly(parsed);
  assert.match(grid.error, /odd number of rows/);
});

// Regression for the real bug report this session: a user-reported "the upper bead is on
// the right in the PDF, on the left after import" traced to bandFromPair pushing the
// wrong row first for every pair beyond the combined foundation row (see bandFromPair's
// header comment). This fixture is a real excerpt (Rows 1&2 through Row 10) of a real,
// solid/untapered 20-wide sample PDF ("Pattern copy.pdf") whose own page also embeds an
// exact per-bead text grid alongside its picture chart — independent, exact ground truth
// for every position below (not hand-read off a picture), used to derive the fix.
test('buildGridFromLoomerly matches a real sample\'s own per-bead ground truth across 5 consecutive bands', () => {
  const pages = [
    'Title\nType: Peyote\nWidth: 20\nHeight: 5\nFinished size: 1.1 x 0.3"\nTotal beads: 100',
    [
      'Word Chart',
      'Starting bead: Top Right',
      'Row 1&2 (←) (1)A, (5)D, (2)B, (5)D, (1)A, (6)C',
      'Row 3 (→) (3)C, (1)A, (1)D, (1)B, (1)A, (2)D, (1)B',
      'Row 4 (←) (1)B, (1)D, (1)A, (2)B, (2)A, (3)C',
      'Row 5 (→) (3)C, (1)A, (2)B, (2)A, (2)B',
      'Row 6 (←) (2)B, (1)A, (2)B, (2)A, (3)C',
      'Row 7 (→) (3)C, (1)A, (2)B, (2)A, (2)B',
      'Row 8 (←) (2)B, (1)A, (1)C, (1)B, (1)A, (4)C',
      'Row 9 (→) (4)C, (1)B, (2)C, (1)A, (1)B, (1)C',
      'Row 10 (←) (1)C, (1)B, (8)C',
    ].join('\n'),
    'Miyuki Delica 11/0 (DB)\nA\nDB133\nName\nCount: 1\nB\nDB353\nName\nCount: 1\nC\nDB769\nName\nCount: 1\nD\nDB2281\nName\nCount: 1',
  ];
  const parsed = parse(pages);
  const grid = buildGridFromLoomerly(parsed);
  assert.equal(grid.bandCount, 5);

  const expectedBands = [
    'C,C,C,C,C,C,A,D,D,D,D,D,B,B,D,D,D,D,D,A',
    'C,C,C,C,C,C,A,A,A,D,B,B,B,A,A,D,D,D,B,B',
    'C,C,C,C,C,C,A,A,A,B,B,B,B,A,A,A,B,B,B,B',
    'C,C,C,C,C,C,C,A,A,B,B,B,C,A,A,A,B,B,B,B',
    'C,C,C,C,C,C,C,C,C,B,C,C,C,C,C,A,B,B,C,C',
  ];
  expectedBands.forEach((expected, col) => {
    const band = new Map(grid.colorEntries.filter(([key]) => key.endsWith(`,${col}`)));
    const actual = Array.from({ length: 20 }, (_, row) => band.get(`${row},${col}`)).join(',');
    assert.equal(actual, expected, `band ${col} mismatch`);
  });
});

test('guessBeadType prefers the color list header line when present', () => {
  const parsed = parse(TINY_SAMPLE_PAGES);
  const guess = guessBeadType(parsed);
  assert.equal(guess.beadTypeKey, 'rocaille11');
  assert.equal(guess.source, 'header');
});

test('guessBeadType falls back to a finished-size comparison when there is no header line', () => {
  // Real excerpt (see .work/samples/'s white-rectangle sample) with no bead-type header --
  // confirmed in the geometry spike that Delica is the closer size match here.
  const pages = [
    'Title\nType: Peyote\nWidth: 30\nHeight: 40\nFinished size: 1.6 x 2.7"\nTotal beads: 1200',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (30)A',
    '01\nA\nWhite\nCount: 1200',
  ];
  const parsed = parse(pages);
  const guess = guessBeadType(parsed);
  assert.equal(guess.beadTypeKey, 'delica11');
  assert.equal(guess.source, 'size-guess');
});

test('computeImportWarnings is empty for a clean, fully-matching reconstruction', () => {
  const parsed = parse(TINY_SAMPLE_PAGES);
  const grid = buildGridFromLoomerly(parsed);
  const warnings = computeImportWarnings(parsed, grid, 'rocaille11');
  assert.deepEqual(warnings, []);
});

test('computeImportWarnings flags a total-bead-count mismatch without blocking', () => {
  const parsed = parse(TINY_SAMPLE_PAGES);
  const grid = buildGridFromLoomerly(parsed);
  const tamperedParsed = { ...parsed, meta: { ...parsed.meta, totalBeads: 999 } };
  const warnings = computeImportWarnings(tamperedParsed, grid, 'rocaille11');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Total beads: 999/);
});

test('computeImportWarnings flags a per-color count mismatch', () => {
  const parsed = parse(TINY_SAMPLE_PAGES);
  const grid = buildGridFromLoomerly(parsed);
  const tamperedParsed = {
    ...parsed,
    colors: parsed.colors.map((c) => (c.code === 'A' ? { ...c, count: 999 } : c)),
  };
  const warnings = computeImportWarnings(tamperedParsed, grid, 'rocaille11');
  assert.ok(warnings.some((w) => w.includes('Color A') && w.includes('Count: 999')));
});

test('computeImportWarnings flags an unconfirmed starting-bead value without blocking', () => {
  const parsed = parse(TINY_SAMPLE_PAGES);
  const grid = buildGridFromLoomerly(parsed);
  const tamperedParsed = { ...parsed, startingBead: 'Top Left' };
  const warnings = computeImportWarnings(tamperedParsed, grid, 'rocaille11');
  assert.ok(warnings.some((w) => w.includes('Top Left') && w.includes('mirrored')));
});

test('computeImportWarnings flags a bead-type guess whose predicted size is way off', () => {
  // Real excerpt (see .work/samples/'s white-rectangle sample): the correct guess here is
  // Delica (confirmed in the geometry spike) -- forcing Rocaille should trip the warning.
  const pages = [
    'Title\nType: Peyote\nWidth: 30\nHeight: 40\nFinished size: 1.6 x 2.7"\nTotal beads: 1200',
    'Word Chart\nStarting bead: Top Right\nRow 1&2 ( ) (30)A',
    '01\nA\nWhite\nCount: 1200',
  ];
  const parsed = parse(pages);
  const grid = buildGridFromLoomerly(parsed);
  const warnings = computeImportWarnings(parsed, grid, 'rocaille11');
  assert.ok(warnings.some((w) => w.includes('differs noticeably')));
});
