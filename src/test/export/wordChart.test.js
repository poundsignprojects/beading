import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCell } from '../../state/cellStore.js';
import { buildWordChart, displayRuns, isRowReversed, UNASSIGNED, clampStartRow, firstOccupiedRow, primaryLabelForRow, rowForLabel } from '../../export/wordChart.js';

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
    rowLabel: 'Row 1 & 2',
    isStartRow: true, // row 0 is the default startRow
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
    rowLabel: 'Row 3',
    isStartRow: false,
  });
  assert.deepEqual(chart.rows[2], {
    entryIndex: 2,
    runs: [{ colorId: 'A', count: 2 }],
    rowLabel: 'Row 4',
    isStartRow: false,
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
  assert.deepEqual(chart.rows[0], { entryIndex: 0, runs: [{ colorId: 'red', count: 1 }], rowLabel: 'Row 1 & 2', isStartRow: true });
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
    rowLabel: 'Row 1 & 2',
    isStartRow: true,
  });
  // Row 1 (chart.rows[1] & [2]): raised (col 1,3) is B,B; non-raised (col 0,2) is A,A.
  assert.deepEqual(chart.rows[1], { entryIndex: 1, runs: [{ colorId: 'B', count: 2 }], rowLabel: 'Row 3', isStartRow: false });
  assert.deepEqual(chart.rows[2], { entryIndex: 2, runs: [{ colorId: 'A', count: 2 }], rowLabel: 'Row 4', isStartRow: false });
  // Row 9, the last one (chart.rows[17] & [18]), follows the identical pattern.
  assert.deepEqual(chart.rows[17], { entryIndex: 17, runs: [{ colorId: 'B', count: 2 }], rowLabel: 'Row 19', isStartRow: false });
  assert.deepEqual(chart.rows[18], { entryIndex: 18, runs: [{ colorId: 'A', count: 2 }], rowLabel: 'Row 20', isStartRow: false });
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
  const unflipped = buildWordChart(cells, 2, 4, 'peyote', false);
  const flipped = buildWordChart(cells, 2, 4, 'peyote', true);
  assert.deepEqual(unflipped.rows[1].runs, [{ colorId: 'Q', count: 1 }, { colorId: 'S', count: 1 }]);
  assert.deepEqual(flipped.rows[1].runs, [{ colorId: 'P', count: 1 }, { colorId: 'R', count: 1 }]);
  assert.deepEqual(flipped.rows[2].runs, unflipped.rows[1].runs);
});

// Square stitch has no foundation-combining/raised-non-raised splitting
// structure at all — each physical row is one straight thread pass, so it
// gets its own dedicated branch inside buildWordChart (see the file's own
// comment). These fixtures deliberately reuse row/col counts and cell layouts
// from the peyote tests above where useful, so the difference in output shape
// is directly attributable to stitchType, not a different fixture.

test('buildWordChart: stitchType "square" produces one line per physical row, not combined/split like peyote', () => {
  const cells = new Map();
  for (let col = 0; col < 3; col++) {
    setCell(cells, 0, col, 'red');
    setCell(cells, 1, col, 'blue');
  }
  const chart = buildWordChart(cells, 2, 3, 'square');

  assert.equal(chart.rows.length, 2); // one line per row, not 1 + 2*(rows-1) like peyote
  assert.deepEqual(chart.rows[0], { entryIndex: 0, runs: [{ colorId: 'red', count: 3 }], rowLabel: 'Row 1', isStartRow: true });
  assert.deepEqual(chart.rows[1], { entryIndex: 1, runs: [{ colorId: 'blue', count: 3 }], rowLabel: 'Row 2', isStartRow: false });
});

test('buildWordChart: stitchType "square" total line count equals rows, unlike peyote\'s 1 + 2*(rows-1)', () => {
  const cells = new Map();
  const chart = buildWordChart(cells, 10, 4, 'square');
  assert.equal(chart.rows.length, 10);
});

test('buildWordChart: stitchType "square" ignores the flipped param entirely (no raised/non-raised concept to flip)', () => {
  const cells = new Map();
  setCell(cells, 1, 0, 'P');
  setCell(cells, 1, 1, 'Q');
  setCell(cells, 1, 2, 'R');
  setCell(cells, 1, 3, 'S');
  const unflipped = buildWordChart(cells, 2, 4, 'square', false);
  const flipped = buildWordChart(cells, 2, 4, 'square', true);
  assert.deepEqual(unflipped, flipped);
  assert.deepEqual(unflipped.rows[1].runs, [
    { colorId: 'P', count: 1 },
    { colorId: 'Q', count: 1 },
    { colorId: 'R', count: 1 },
    { colorId: 'S', count: 1 },
  ]);
});

test('buildWordChart: stitchType defaults to "peyote" when omitted, matching every pre-square-stitch test above', () => {
  const cells = new Map();
  for (let col = 0; col < 3; col++) setCell(cells, 0, col, 'red');
  const withDefault = buildWordChart(cells, 1, 3);
  const withExplicit = buildWordChart(cells, 1, 3, 'peyote');
  assert.deepEqual(withDefault, withExplicit);
});

// dropCount (.work/feature-multi-drop-peyote-plan.md) — needs no run-format
// change, only which columns land in the raised vs. non-raised bucket. With
// cols=4, dropCount=2: dropGroup is 0,0,1,1 for cols 0,1,2,3 — group {0,1} has
// dropGroup=0 (even) so it's the NON-raised half-pass (chart.rows[2]); group
// {2,3} has dropGroup=1 (odd) so it's the RAISED half-pass (chart.rows[1]),
// printed first — same isRaised rule as ever, just keyed by group instead of
// column.

test('buildWordChart: dropCount=2 merges a same-colored group of columns into one run, not one run per column', () => {
  const cells = new Map();
  // Group {2,3} (raised) is uniformly blue; group {0,1} (non-raised) is
  // uniformly red. At dropCount=1 these same per-column colors would split
  // into two separate 1-length runs per half-pass (col1/col3 alternate raised,
  // col0/col2 alternate non-raised, each pair genuinely red-then-blue or
  // blue-then-red) — only dropCount=2's grouping merges each half-pass's own
  // pair into a single run of 2.
  setCell(cells, 1, 0, 'red');
  setCell(cells, 1, 1, 'red');
  setCell(cells, 1, 2, 'blue');
  setCell(cells, 1, 3, 'blue');
  const chart = buildWordChart(cells, 2, 4, 'peyote', false, 2);
  assert.deepEqual(chart.rows[1].runs, [{ colorId: 'blue', count: 2 }]); // raised: group {2,3}
  assert.deepEqual(chart.rows[2].runs, [{ colorId: 'red', count: 2 }]); // non-raised: group {0,1}
});

test('buildWordChart: dropCount=1 with the identical per-column colors does NOT merge — confirms the dropCount=2 merge above is genuinely grouping-driven', () => {
  const cells = new Map();
  setCell(cells, 1, 0, 'red');
  setCell(cells, 1, 1, 'red');
  setCell(cells, 1, 2, 'blue');
  setCell(cells, 1, 3, 'blue');
  const chart = buildWordChart(cells, 2, 4, 'peyote', false, 1);
  // dropCount=1: raised bucket is col1,col3 = red,blue; non-raised is col0,col2 = red,blue.
  assert.deepEqual(chart.rows[1].runs, [{ colorId: 'red', count: 1 }, { colorId: 'blue', count: 1 }]);
  assert.deepEqual(chart.rows[2].runs, [{ colorId: 'red', count: 1 }, { colorId: 'blue', count: 1 }]);
});

test('buildWordChart: dropCount=2 still produces two separate runs for two differently-colored beads within one group', () => {
  const cells = new Map();
  // cols=2, dropCount=2: the single group {0,1} has dropGroup=0 (even), so
  // it's entirely the non-raised half-pass. Different colors within that one
  // group must still print as two separate 1-length runs, proving color
  // independence survives grouping — a drop group shares a stagger level, not
  // a color.
  setCell(cells, 1, 0, 'red');
  setCell(cells, 1, 1, 'blue');
  const chart = buildWordChart(cells, 2, 2, 'peyote', false, 2);
  assert.deepEqual(chart.rows[1].runs, []); // raised half-pass: no columns in it
  assert.deepEqual(chart.rows[2].runs, [{ colorId: 'red', count: 1 }, { colorId: 'blue', count: 1 }]);
});

test('buildWordChart: dropCount defaults to 1, matching every pre-multi-drop test above', () => {
  const cells = new Map();
  setCell(cells, 1, 0, 'P');
  setCell(cells, 1, 1, 'Q');
  setCell(cells, 1, 2, 'R');
  setCell(cells, 1, 3, 'S');
  const withDefault = buildWordChart(cells, 2, 4, 'peyote', false);
  const withExplicit = buildWordChart(cells, 2, 4, 'peyote', false, 1);
  assert.deepEqual(withDefault, withExplicit);
});

// startRow (.work/feature-requests-and-bugs.md: "my start row ends up being
// partway into the pattern" for designs with leading blank rows) — NEVER
// changes numbering (confirmed directly with the user after two rejected
// designs — see buildWordChart's own comment). Row 0 is always "Row 1 & 2";
// every other row's label is always its own fixed pair ("Row 3"/"Row 4",
// "Row 5"/"Row 6", ...) UNLESS that row is the chosen startRow, in which case
// it switches from split to combined — the same un-split treatment row 0
// always gets — and is flagged via isStartRow for bolding.

test('clampStartRow: clamps into [0, rows), truncates, and treats a non-finite/negative rows as 0', () => {
  assert.equal(clampStartRow(0, 10), 0);
  assert.equal(clampStartRow(3, 10), 3);
  assert.equal(clampStartRow(9, 10), 9);
  assert.equal(clampStartRow(10, 10), 9); // past the last valid index
  assert.equal(clampStartRow(-5, 10), 0); // negative clamps to 0
  assert.equal(clampStartRow(3.9, 10), 3); // truncated, not rounded
  assert.equal(clampStartRow(5, 0), 0); // no rows at all
});

test('firstOccupiedRow: returns the lowest row across every occupied cell, regardless of col', () => {
  const cells = new Map();
  setCell(cells, 4, 2, 'red');
  setCell(cells, 2, 0, 'blue');
  setCell(cells, 7, 1, 'red');
  assert.equal(firstOccupiedRow(cells), 2);
});

test('firstOccupiedRow: returns null for a completely empty design', () => {
  assert.equal(firstOccupiedRow(new Map()), null);
});

test('buildWordChart: the chosen startRow (peyote, row>=1) combines into one un-split line, labeled with its own two numbers', () => {
  const cells = new Map();
  // cols=4 (even): isRaised(col,4) is true for col indices 1,3 — a classic
  // split would group Q,S (raised) and P,R (non-raised) into two separate
  // lines. Combining must instead scan the whole row in plain column order.
  setCell(cells, 2, 0, 'P');
  setCell(cells, 2, 1, 'Q');
  setCell(cells, 2, 2, 'R');
  setCell(cells, 2, 3, 'S');
  const chart = buildWordChart(cells, 4, 4, 'peyote', false, 1, 2); // startRow: row 2

  // Line count never changes — the chosen row contributes 1 line instead of
  // its usual 2, but row 0 (uncombined now that it isn't the chosen row)
  // contributes its usual 2 instead of the foundation's usual 1, netting out
  // to the exact same classic total (1 + 2*(4-1) = 7).
  assert.equal(chart.rows.length, 7);
  const combined = chart.rows.filter((r) => r.isStartRow);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].rowLabel, 'Row 5 & 6');
  assert.deepEqual(combined[0].runs, [
    { colorId: 'P', count: 1 },
    { colorId: 'Q', count: 1 },
    { colorId: 'R', count: 1 },
    { colorId: 'S', count: 1 },
  ]);
});

test('buildWordChart: row 0 uncombines into ordinary "Row 1"/"Row 2" lines once a DIFFERENT row is chosen as startRow', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 0, 1, 'blue');
  const chart = buildWordChart(cells, 4, 2, 'peyote', false, 1, 2); // startRow: row 2, not row 0

  // Row 0 is no longer special-cased — cols=2 means col 1 is raised, col 0
  // is not, so it splits exactly like any other row would: "Row 1" (raised,
  // col 1 = blue) printed first, "Row 2" (non-raised, col 0 = red) second.
  assert.equal(chart.rows.some((r) => r.rowLabel === 'Row 1 & 2'), false);
  const row1 = chart.rows.find((r) => r.rowLabel === 'Row 1');
  const row2 = chart.rows.find((r) => r.rowLabel === 'Row 2');
  assert.ok(row1 && row2);
  assert.deepEqual(row1.runs, [{ colorId: 'blue', count: 1 }]);
  assert.deepEqual(row2.runs, [{ colorId: 'red', count: 1 }]);
  assert.equal(row1.isStartRow, false);
  assert.equal(row2.isStartRow, false);
});

test('buildWordChart: every OTHER row keeps its exact classic label/content regardless of which row is combined', () => {
  const cells = new Map();
  for (let row = 1; row < 4; row++) {
    for (let col = 0; col < 2; col++) setCell(cells, row, col, `R${row}C${col}`);
  }
  const classic = buildWordChart(cells, 4, 2, 'peyote', false, 1, 0); // row 0, no-op combine
  const combinedAtRow2 = buildWordChart(cells, 4, 2, 'peyote', false, 1, 2);

  const byLabel = (chart) => Object.fromEntries(chart.rows.map((r) => [r.rowLabel, r.runs]));
  const classicByLabel = byLabel(classic);
  const combinedByLabel = byLabel(combinedAtRow2);
  for (const label of ['Row 3', 'Row 4', 'Row 7', 'Row 8']) {
    assert.deepEqual(combinedByLabel[label], classicByLabel[label], label);
  }
  // Row 2's own classic pair ("Row 5"/"Row 6") no longer exists as two
  // separate lines — replaced by one combined "Row 5 & 6" line instead.
  assert.equal(combinedByLabel['Row 5'], undefined);
  assert.equal(combinedByLabel['Row 6'], undefined);
  assert.ok(combinedByLabel['Row 5 & 6']);
});

test('buildWordChart: startRow 0 (the default) reproduces this chart\'s original, startRow-unaware behavior exactly', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  const withDefault = buildWordChart(cells, 3, 1);
  const explicitZero = buildWordChart(cells, 3, 1, 'peyote', false, 1, 0);
  assert.deepEqual(withDefault, explicitZero);
  assert.equal(withDefault.rows[0].rowLabel, 'Row 1 & 2');
  assert.equal(withDefault.rows[0].isStartRow, true);
  assert.equal(withDefault.rows.length, 1 + 2 * (3 - 1)); // unchanged line count
});

test('buildWordChart: an out-of-range startRow clamps to a real row and still combines it correctly, with the classic total line count preserved', () => {
  const cells = new Map();
  setCell(cells, 4, 0, 'red');
  const tooHigh = buildWordChart(cells, 5, 1, 'peyote', false, 1, 99);
  // Clamps to row 4 (the last row) — its own pair ("Row 9"/"Row 10") combines
  // into one line instead of the usual two, while row 0 (no longer chosen)
  // splits into its own "Row 1"/"Row 2" pair instead, so the total is
  // unchanged from the classic 9 (1 + 2*(5-1)).
  assert.equal(tooHigh.rows.length, 1 + 2 * (5 - 1));
  const combined = tooHigh.rows.filter((r) => r.isStartRow);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].rowLabel, 'Row 9 & 10');
  assert.deepEqual(combined[0].runs, [{ colorId: 'red', count: 1 }]);
  assert.equal(tooHigh.rows.some((r) => r.rowLabel === 'Row 1 & 2'), false);
  assert.ok(tooHigh.rows.some((r) => r.rowLabel === 'Row 1'));
  assert.ok(tooHigh.rows.some((r) => r.rowLabel === 'Row 2'));

  const negative = buildWordChart(cells, 5, 1, 'peyote', false, 1, -3);
  const zero = buildWordChart(cells, 5, 1, 'peyote', false, 1, 0);
  assert.deepEqual(negative, zero);
});

test('buildWordChart: total printed line count is always 1 + 2*(rows-1), regardless of which row is chosen as startRow', () => {
  const cells = new Map();
  for (let row = 0; row < 6; row++) setCell(cells, row, 0, `C${row}`);
  for (let startRow = 0; startRow < 6; startRow++) {
    const chart = buildWordChart(cells, 6, 2, 'peyote', false, 1, startRow);
    assert.equal(chart.rows.length, 1 + 2 * (6 - 1), `startRow: ${startRow}`);
  }
});

test('buildWordChart: startRow defaults to 0 when omitted, matching every pre-startRow test above', () => {
  const cells = new Map();
  for (let col = 0; col < 3; col++) setCell(cells, 0, col, 'red');
  const withDefault = buildWordChart(cells, 1, 3);
  const withExplicit = buildWordChart(cells, 1, 3, 'peyote', false, 1, 0);
  assert.deepEqual(withDefault, withExplicit);
});

test('buildWordChart: stitchType "square" has no combining concept — startRow only bolds the row, labels stay one-per-row', () => {
  const cells = new Map();
  for (let row = 0; row < 4; row++) setCell(cells, row, 0, `C${row}`);
  const chart = buildWordChart(cells, 4, 1, 'square', false, 1, 2); // highlight row 2
  assert.equal(chart.rows.length, 4); // no combining, always one line per row
  assert.deepEqual(chart.rows.map((r) => r.rowLabel), ['Row 1', 'Row 2', 'Row 3', 'Row 4']);
  assert.deepEqual(chart.rows.map((r) => r.isStartRow), [false, false, true, false]);
});

// primaryLabelForRow / rowForLabel — the Start Row *field*'s own conversion
// between a physical row and the chart's fixed, unchanging label number(s)
// for it (see printView.js and buildWordChart's own comments). A crafter
// reads the default printout's own numbers and types one in directly.

test('primaryLabelForRow: peyote — row 0 is always "1", row r>=1 is its raised (odd) label', () => {
  assert.equal(primaryLabelForRow(0), 1);
  assert.equal(primaryLabelForRow(1), 3);
  assert.equal(primaryLabelForRow(2), 5);
  assert.equal(primaryLabelForRow(6), 13);
});

test('primaryLabelForRow: square — a row\'s own 1-indexed number, no doubling', () => {
  assert.equal(primaryLabelForRow(0, 'square'), 1);
  assert.equal(primaryLabelForRow(3, 'square'), 4);
});

test('rowForLabel: peyote — either of a row\'s two labels (odd or even) resolves to the same physical row', () => {
  assert.equal(rowForLabel(1), 0);
  assert.equal(rowForLabel(2), 0);
  assert.equal(rowForLabel(3), 1);
  assert.equal(rowForLabel(4), 1);
  assert.equal(rowForLabel(13), 6);
  assert.equal(rowForLabel(14), 6);
});

test('rowForLabel: square — a row\'s own 1-indexed number, no doubling', () => {
  assert.equal(rowForLabel(1, 'square'), 0);
  assert.equal(rowForLabel(4, 'square'), 3);
});

test('primaryLabelForRow/rowForLabel round-trip for every row in a realistic range (peyote)', () => {
  for (let row = 0; row < 40; row++) {
    const label = primaryLabelForRow(row);
    assert.equal(rowForLabel(label), row);
    // The row's *other* label (the even one) must also resolve back to the
    // same row, matching how either half of a split pair names one row.
    if (row > 0) assert.equal(rowForLabel(label + 1), row);
  }
});
