// Row-length-encodes a design's cells into the run-based data a printable word
// chart is built from (see .work/phase-5-implementation-plan.md). Pure — no DOM,
// no appState — so printView.js is the only thing that has to know how a design
// gets turned into a printout.

import { getCell } from '../state/cellStore.js';

// Distinguishes "cell absent" (a genuinely blank run — colorId: null, unchanged
// meaning since Phase 5) from "cell present with colorId: null" (Phase 6: occupied
// in the shared shape, but this colorway hasn't assigned it a color yet) — a run
// type of its own so a colorway missing colors doesn't silently print as if those
// beads don't exist, or worse, print as blank/skip instructions a stitcher would
// follow literally.
export const UNASSIGNED = Symbol('unassigned-color');

export function buildWordChart(cells, rows, cols) {
  const chartRows = [];
  const colorCounts = new Map(); // colorId -> running total, insertion = first appearance
  let unassignedCount = 0;

  for (let row = 0; row < rows; row++) {
    const runs = [];
    let current = null; // { colorId, count } — colorId null means a blank run

    for (let col = 0; col < cols; col++) {
      const cell = getCell(cells, row, col);
      let colorId;
      if (!cell) {
        colorId = null; // genuinely empty
      } else if (cell.colorId === null) {
        colorId = UNASSIGNED;
        unassignedCount++;
      } else {
        colorId = cell.colorId;
        colorCounts.set(colorId, (colorCounts.get(colorId) ?? 0) + 1);
      }

      if (current && current.colorId === colorId) {
        current.count++;
      } else {
        if (current) runs.push(current);
        current = { colorId, count: 1 };
      }
    }
    if (current) runs.push(current);
    chartRows.push({ rowIndex: row, runs });
  }

  const colorCountList = Array.from(colorCounts.entries()).map(([colorId, count]) => ({ colorId, count }));
  const totalBeadCount = colorCountList.reduce((sum, entry) => sum + entry.count, 0) + unassignedCount;
  return { rows: chartRows, colorCounts: colorCountList, totalBeadCount, unassignedCount };
}

// Peyote is worked back-and-forth — that's *why* peyoteCellOriginMm offsets odd rows
// by half a bead-width in the first place. The printed chart mirrors that same
// row-parity alternation so a line reads in the direction the thread actually
// travels, rather than always left-to-right regardless of row. Runs stay stored
// canonically left-to-right in `rows`; only display order is affected.
export function displayRuns(chartRow) {
  return chartRow.rowIndex % 2 === 1 ? [...chartRow.runs].reverse() : chartRow.runs;
}
