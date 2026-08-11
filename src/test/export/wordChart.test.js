import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCell } from '../../state/cellStore.js';
import { buildWordChart, displayRuns, isRowReversed, UNASSIGNED } from '../../export/wordChart.js';

// Below, `rows` is beads-per-physical-row and `cols` is the physical row
// count (peyoteRowCount(cols) === cols) — the corrected axis mapping. Using
// cols: 1 keeps a fixture to a single physical row, so rowCount < 2 and the
// rows-1&2 combining branch never triggers, isolating run-collapsing
// behavior from combining behavior.

test('buildWordChart: a row of all one color collapses to a single run', () => {
  const cells = new Map();
  for (let row = 0; row < 5; row++) setCell(cells, row, 0, 'red');
  const chart = buildWordChart(cells, 5, 1);
  assert.equal(chart.rows.length, 1);
  assert.deepEqual(chart.rows[0].runs, [{ colorId: 'red', count: 5 }]);
});

test('buildWordChart: alternating single cells produce one run per cell', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  setCell(cells, 1, 0, 'blue');
  setCell(cells, 2, 0, 'red');
  const chart = buildWordChart(cells, 3, 1);
  assert.deepEqual(chart.rows[0].runs, [
    { colorId: 'red', count: 1 },
    { colorId: 'blue', count: 1 },
    { colorId: 'red', count: 1 },
  ]);
});

test('buildWordChart: leading/trailing/interior blanks produce correctly-positioned blank runs', () => {
  const cells = new Map();
  // beads along the row: [blank, blank, red, red, blank, blue, blank, blank, blank]
  setCell(cells, 2, 0, 'red');
  setCell(cells, 3, 0, 'red');
  setCell(cells, 5, 0, 'blue');
  const chart = buildWordChart(cells, 9, 1);
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
  setCell(cells, 0, 1, 'red');
  setCell(cells, 1, 0, 'blue');
  setCell(cells, 1, 1, 'red');
  const chart = buildWordChart(cells, 2, 2);
  assert.deepEqual(chart.colorCounts, [
    { colorId: 'red', count: 3 },
    { colorId: 'blue', count: 1 },
  ]);
  assert.equal(chart.totalBeadCount, 4);
});

test('buildWordChart: an entirely empty, single-physical-row design returns totalBeadCount 0 and a full-width blank run', () => {
  const chart = buildWordChart(new Map(), 4, 1);
  assert.equal(chart.totalBeadCount, 0);
  assert.deepEqual(chart.colorCounts, []);
  assert.equal(chart.rows.length, 1);
  assert.deepEqual(chart.rows[0].runs, [{ colorId: null, count: 4 }]);
});

test('buildWordChart: a row mixing real-color, blank, and unassigned cells produces three distinct run types', () => {
  const cells = new Map();
  // beads along the row: [red, red, blank, unassigned, unassigned, blank]
  setCell(cells, 0, 0, 'red');
  setCell(cells, 1, 0, 'red');
  setCell(cells, 3, 0, null);
  setCell(cells, 4, 0, null);
  const chart = buildWordChart(cells, 6, 1);
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
  setCell(cells, 0, 1, null); // unassigned
  setCell(cells, 1, 0, null); // unassigned
  setCell(cells, 1, 1, null); // unassigned
  const chart = buildWordChart(cells, 2, 2);
  assert.equal(chart.unassignedCount, 3);
  assert.equal(chart.totalBeadCount, 4);
  assert.deepEqual(chart.colorCounts, [{ colorId: 'red', count: 1 }]);
});

test('buildWordChart: physical rows 1 & 2 combine into one interleaved entry; row 3 stays separate', () => {
  const cells = new Map();
  // Physical row 1 (col 0) is all red, physical row 2 (col 1) is all blue,
  // physical row 3 (col 2) is all green. If rows 1&2 were merely concatenated
  // instead of truly interleaved bead-by-bead, this would collapse to
  // [{red,3},{blue,3}] instead of six alternating single-count runs.
  for (let row = 0; row < 3; row++) {
    setCell(cells, row, 0, 'red');
    setCell(cells, row, 1, 'blue');
    setCell(cells, row, 2, 'green');
  }
  const chart = buildWordChart(cells, 3, 3);

  assert.equal(chart.rows.length, 2);
  assert.deepEqual(chart.rows[0], {
    entryIndex: 0,
    rowNumbers: [1, 2],
    combined: true,
    runs: [
      { colorId: 'red', count: 1 },
      { colorId: 'blue', count: 1 },
      { colorId: 'red', count: 1 },
      { colorId: 'blue', count: 1 },
      { colorId: 'red', count: 1 },
      { colorId: 'blue', count: 1 },
    ],
  });
  assert.deepEqual(chart.rows[1], {
    entryIndex: 1,
    rowNumbers: [3],
    combined: false,
    runs: [{ colorId: 'green', count: 3 }],
  });
});

test('buildWordChart: a single-physical-row design (cols: 1) never combines', () => {
  const cells = new Map();
  setCell(cells, 0, 0, 'red');
  const chart = buildWordChart(cells, 1, 1);
  assert.equal(chart.rows.length, 1);
  assert.equal(chart.rows[0].combined, false);
  assert.deepEqual(chart.rows[0].rowNumbers, [1]);
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
