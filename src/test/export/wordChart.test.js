import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCell } from '../../state/cellStore.js';
import { buildWordChart, displayRuns, isRowReversed, UNASSIGNED } from '../../export/wordChart.js';

// Below, `rows` is the physical row count (height-driving) and `cols` is
// beads-per-row (width-driving) — row/col now mean what the UI's Rows/Cols
// labels already say (see .work/refactor-row-col-axis-naming-plan.md). Using
// rows: 1 keeps a fixture to a single physical row, so rows < 2 and the
// row-0&1-splitting branch never triggers, isolating run-collapsing behavior
// from splitting behavior.

test('buildWordChart: a row of all one color collapses to a single run', () => {
  const cells = new Map();
  for (let col = 0; col < 5; col++) setCell(cells, 0, col, 'red');
  const chart = buildWordChart(cells, 1, 5);
  assert.equal(chart.rows.length, 1);
  assert.deepEqual(chart.rows[0].runs, [{ colorId: 'red', count: 5 }]);
});

test('buildWordChart: alternating single cells produce one run per cell', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 1, 'blue');
  setCell(cells, 0, 2, 'red');
  const chart = buildWordChart(cells, 1, 3);
  assert.deepEqual(chart.rows[0].runs, [
    { colorId: 'red', count: 1 },
    { colorId: 'blue', count: 1 },
    { colorId: 'red', count: 1 },
  ]);
});

test('buildWordChart: leading/trailing/interior blanks produce correctly-positioned blank runs', () => {
  const cells = new Map();
  // beads along the row: [blank, blank, red, red, blank, blue, blank, blank, blank]
  setCell(cells, 0, 2, 'red');
  setCell(cells, 0, 3, 'red');
  setCell(cells, 0, 5, 'blue');
  const chart = buildWordChart(cells, 1, 9);
  assert.deepEqual(chart.rows[0].runs, [
    { colorId: null, count: 2 },
    { colorId: 'red', count: 2 },
    { colorId: null, count: 1 },
    { colorId: 'blue', count: 1 },
    { colorId: null, count: 3 },
  ]);
});

test('buildWordChart: colorCounts/totalBeadCount match a hand-counted fixture', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 1, 0, 'red');
  setCell(cells, 0, 1, 'blue');
  setCell(cells, 1, 1, 'red');
  const chart = buildWordChart(cells, 2, 2);
  assert.deepEqual(chart.colorCounts, [
    { colorId: 'red', count: 3 },
    { colorId: 'blue', count: 1 },
  ]);
  assert.equal(chart.totalBeadCount, 4);
});

test('buildWordChart: an entirely empty, single-physical-row design returns totalBeadCount 0 and a full-width blank run', () => {
  const chart = buildWordChart(new Map(), 1, 4);
  assert.equal(chart.totalBeadCount, 0);
  assert.deepEqual(chart.colorCounts, []);
  assert.equal(chart.rows.length, 1);
  assert.deepEqual(chart.rows[0].runs, [{ colorId: null, count: 4 }]);
});

test('buildWordChart: a row mixing real-color, blank, and unassigned cells produces three distinct run types', () => {
  const cells = new Map();
  // beads along the row: [red, red, blank, unassigned, unassigned, blank]
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 1, 'red');
  setCell(cells, 0, 3, null);
  setCell(cells, 0, 4, null);
  const chart = buildWordChart(cells, 1, 6);
  assert.deepEqual(chart.rows[0].runs, [
    { colorId: 'red', count: 2 },
    { colorId: null, count: 1 },
    { colorId: UNASSIGNED, count: 2 },
    { colorId: null, count: 1 },
  ]);
});

test('buildWordChart: unassignedCount matches a hand-counted fixture and is folded into totalBeadCount', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 1, 0, null); // unassigned
  setCell(cells, 0, 1, null); // unassigned
  setCell(cells, 1, 1, null); // unassigned
  const chart = buildWordChart(cells, 2, 2);
  assert.equal(chart.unassignedCount, 3);
  assert.equal(chart.totalBeadCount, 4);
  assert.deepEqual(chart.colorCounts, [{ colorId: 'red', count: 1 }]);
});

test('buildWordChart: row 0 (the foundation) prints as its own single, unsplit line — not merged with row 1', () => {
  const cells = new Map();
  // Row 0 is all red, row 1 is all blue. If row 0 were still being
  // interleaved with row 1 (the old, wrong behavior), the first entry would
  // carry all 6 beads (3 red + 3 blue) instead of the foundation's own 3 red
  // alone.
  for (let col = 0; col < 3; col++) {
    setCell(cells, 0, col, 'red');
    setCell(cells, 1, col, 'blue');
  }
  const chart = buildWordChart(cells, 2, 3);

  assert.deepEqual(chart.rows[0], {
    entryIndex: 0,
    runs: [{ colorId: 'red', count: 3 }],
  });
});

test('buildWordChart: a row past the foundation splits into a raised-level half-pass (printed first) and a non-raised-level half-pass (printed second)', () => {
  const cells = new Map();
  // Row 1, cols=4 (even): positions 0-3 are A,B,A,B.
  // isRaised(col,4) is true for odd col indices (1,3) — see peyote.js's
  // isRaised derivation — so the raised half-pass (printed first, entry 1)
  // is B,B and the non-raised half-pass (printed second, entry 2) is A,A.
  // Getting this backwards prints the physically-later real row before the
  // physically-earlier one — exactly the historical bug, where a raw
  // position-parity split only happened to agree with isRaised when `cols`
  // is odd, and silently inverted for an even `cols` like this one.
  setCell(cells, 1, 0, 'A');
  setCell(cells, 1, 1, 'B');
  setCell(cells, 1, 2, 'A');
  setCell(cells, 1, 3, 'B');
  const chart = buildWordChart(cells, 2, 4);

  // Entry 0 is the (empty) foundation; entries 1 & 2 are row 1's two halves.
  assert.equal(chart.rows.length, 3);
  assert.deepEqual(chart.rows[1], {
    entryIndex: 1,
    runs: [{ colorId: 'B', count: 2 }],
  });
  assert.deepEqual(chart.rows[2], {
    entryIndex: 2,
    runs: [{ colorId: 'A', count: 2 }],
  });
});

test('buildWordChart: raised/non-raised split order is correct for an even `cols` value, with distinct colors ruling out a coincidental pass', () => {
  const cells = new Map();
  // cols=4 (even): isRaised(col,4) is true for col indices 1,3.
  setCell(cells, 1, 0, 'P');
  setCell(cells, 1, 1, 'Q');
  setCell(cells, 1, 2, 'R');
  setCell(cells, 1, 3, 'S');
  const chart = buildWordChart(cells, 2, 4);
  assert.deepEqual(chart.rows[1].runs, [{ colorId: 'Q', count: 1 }, { colorId: 'S', count: 1 }]);
  assert.deepEqual(chart.rows[2].runs, [{ colorId: 'P', count: 1 }, { colorId: 'R', count: 1 }]);
});

test('buildWordChart: raised/non-raised split order is correct for an odd `cols` value', () => {
  const cells = new Map();
  // cols=5 (odd): isRaised(col) is true for col indices 1,3 — same rule as the even
  // case above, since isRaised no longer depends on cols at all (see peyote.js).
  setCell(cells, 1, 0, 'P');
  setCell(cells, 1, 1, 'Q');
  setCell(cells, 1, 2, 'R');
  setCell(cells, 1, 3, 'S');
  setCell(cells, 1, 4, 'T');
  const chart = buildWordChart(cells, 2, 5);
  assert.deepEqual(chart.rows[1].runs, [
    { colorId: 'Q', count: 1 },
    { colorId: 'S', count: 1 },
  ]);
  assert.deepEqual(chart.rows[2].runs, [
    { colorId: 'P', count: 1 },
    { colorId: 'R', count: 1 },
    { colorId: 'T', count: 1 },
  ]);
});

test('buildWordChart: total printed line count is 1 + 2 * (rows - 1)', () => {
  const cells = new Map();
  const chart = buildWordChart(cells, 10, 4);
  assert.equal(chart.rows.length, 1 + 2 * (10 - 1));
});

test('buildWordChart: a single-physical-row design (rows: 1) produces exactly one unsplit line', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  const chart = buildWordChart(cells, 1, 1);
  assert.equal(chart.rows.length, 1);
  assert.deepEqual(chart.rows[0], { entryIndex: 0, runs: [{ colorId: 'red', count: 1 }] });
});

test('buildWordChart: 10-tall x 4-wide regression fixture — foundation alone, then each later row split raised/non-raised', () => {
  const cells = new Map();
  // Every row (0-9) alternates A,B,A,B across its 4 positions — a simple,
  // uniform stand-in for the ground-truth sample compared against Loomerly's
  // own printout (see fix-wordchart-half-pass-splitting-plan.md). What's
  // under test is the shape of the output (1 foundation line, then two
  // half-pass lines per later row, 19 lines total for 10 rows), not this
  // fixture's specific colors. cols=4 is even, so isRaised(col,4) is true
  // for col indices 1,3 — the raised (printed-first) half-pass is B,B, and
  // the non-raised (printed-second) half-pass is A,A.
  for (let row = 0; row < 10; row++) {
    setCell(cells, row, 0, 'A');
    setCell(cells, row, 1, 'B');
    setCell(cells, row, 2, 'A');
    setCell(cells, row, 3, 'B');
  }
  const chart = buildWordChart(cells, 10, 4);

  assert.equal(chart.rows.length, 19);
  assert.deepEqual(chart.rows[0], {
    entryIndex: 0,
    runs: [
      { colorId: 'A', count: 1 },
      { colorId: 'B', count: 1 },
      { colorId: 'A', count: 1 },
      { colorId: 'B', count: 1 },
    ],
  });
  // Row 1 (chart.rows[1] & [2]): raised (col 1,3) is B,B; non-raised (col 0,2) is A,A.
  assert.deepEqual(chart.rows[1], { entryIndex: 1, runs: [{ colorId: 'B', count: 2 }] });
  assert.deepEqual(chart.rows[2], { entryIndex: 2, runs: [{ colorId: 'A', count: 2 }] });
  // Row 9, the last one (chart.rows[17] & [18]), follows the identical pattern.
  assert.deepEqual(chart.rows[17], { entryIndex: 17, runs: [{ colorId: 'B', count: 2 }] });
  assert.deepEqual(chart.rows[18], { entryIndex: 18, runs: [{ colorId: 'A', count: 2 }] });
});

test('isRowReversed: default (startsReversed omitted) matches entryIndex parity — even not reversed, odd reversed', () => {
  assert.equal(isRowReversed({ entryIndex: 0 }), false);
  assert.equal(isRowReversed({ entryIndex: 1 }), true);
  assert.equal(isRowReversed({ entryIndex: 2 }), false);
});

test('isRowReversed: startsReversed true flips every entry\'s parity', () => {
  assert.equal(isRowReversed({ entryIndex: 0 }, true), true);
  assert.equal(isRowReversed({ entryIndex: 1 }, true), false);
  assert.equal(isRowReversed({ entryIndex: 2 }, true), true);
});

test('displayRuns: even entryIndex returns runs unchanged by default', () => {
  const chartRow = {
    entryIndex: 0,
    runs: [
      { colorId: 'red', count: 1 },
      { colorId: 'blue', count: 2 },
      { colorId: 'green', count: 3 },
    ],
  };
  assert.deepEqual(displayRuns(chartRow), chartRow.runs);
});

test('displayRuns: odd entryIndex returns runs reversed by default', () => {
  const chartRow = {
    entryIndex: 1,
    runs: [
      { colorId: 'red', count: 1 },
      { colorId: 'blue', count: 2 },
      { colorId: 'green', count: 3 },
    ],
  };
  assert.deepEqual(displayRuns(chartRow), [
    { colorId: 'green', count: 3 },
    { colorId: 'blue', count: 2 },
    { colorId: 'red', count: 1 },
  ]);
});

test('displayRuns: startsReversed true flips both the even and odd cases', () => {
  const runs = [
    { colorId: 'red', count: 1 },
    { colorId: 'blue', count: 2 },
  ];
  assert.deepEqual(displayRuns({ entryIndex: 0, runs }, true), [...runs].reverse());
  assert.deepEqual(displayRuns({ entryIndex: 1, runs }, true), runs);
});

// flipped — a per-design constant restoring an earlier stagger convention for
// odd-cols designs (see peyote.js's isRaised / migrateDesign.js's
// migrateStaggerFlip). Confirms buildWordChart's raised/non-raised split
// genuinely inverts under flipped=true, using the same fixture shape as the
// unflipped "raised/non-raised split order" cases above.
test('buildWordChart: flipped=true inverts which half-pass prints first, for the same cells', () => {
  const cells = new Map();
  setCell(cells, 1, 0, 'P');
  setCell(cells, 1, 1, 'Q');
  setCell(cells, 1, 2, 'R');
  setCell(cells, 1, 3, 'S');
  const unflipped = buildWordChart(cells, 2, 4, false);
  const flipped = buildWordChart(cells, 2, 4, true);
  assert.deepEqual(unflipped.rows[1].runs, [{ colorId: 'Q', count: 1 }, { colorId: 'S', count: 1 }]);
  assert.deepEqual(flipped.rows[1].runs, [{ colorId: 'P', count: 1 }, { colorId: 'R', count: 1 }]);
  assert.deepEqual(flipped.rows[2].runs, unflipped.rows[1].runs);
});
