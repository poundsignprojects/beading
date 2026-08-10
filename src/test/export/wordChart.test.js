import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCell } from '../../state/cellStore.js';
import { buildWordChart, displayRuns, UNASSIGNED } from '../../export/wordChart.js';

test('buildWordChart: a row of all one color collapses to a single run', () => {
  const cells = new Map();
  for (let col = 0; col < 5; col++) setCell(cells, 0, col, 'red');
  const chart = buildWordChart(cells, 1, 5);
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
  // cols: [blank, blank, red, red, blank, blue, blank, blank, blank]
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

test('buildWordChart: an entirely empty design returns totalBeadCount 0 and full-width blank rows', () => {
  const chart = buildWordChart(new Map(), 3, 4);
  assert.equal(chart.totalBeadCount, 0);
  assert.deepEqual(chart.colorCounts, []);
  for (const row of chart.rows) {
    assert.deepEqual(row.runs, [{ colorId: null, count: 4 }]);
  }
});

test('buildWordChart: a row mixing real-color, blank, and unassigned cells produces three distinct run types', () => {
  const cells = new Map();
  // cols: [red, red, blank, unassigned, unassigned, blank]
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
  setCell(cells, 0, 1, null); // unassigned
  setCell(cells, 1, 0, null); // unassigned
  setCell(cells, 1, 1, null); // unassigned
  const chart = buildWordChart(cells, 2, 2);
  assert.equal(chart.unassignedCount, 3);
  assert.equal(chart.totalBeadCount, 4);
  assert.deepEqual(chart.colorCounts, [{ colorId: 'red', count: 1 }]);
});

test('displayRuns: even rowIndex returns runs unchanged', () => {
  const chartRow = {
    rowIndex: 0,
    runs: [
      { colorId: 'red', count: 1 },
      { colorId: 'blue', count: 2 },
      { colorId: 'green', count: 3 },
    ],
  };
  assert.deepEqual(displayRuns(chartRow), chartRow.runs);
});

test('displayRuns: odd rowIndex returns runs reversed', () => {
  const chartRow = {
    rowIndex: 1,
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
