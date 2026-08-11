// Row-length-encodes a design's cells into the run-based data a printable word
// chart is built from (see .work/phase-5-implementation-plan.md). Pure — no DOM,
// no appState — so printView.js is the only thing that has to know how a design
// gets turned into a printout.

import { getCell } from '../state/cellStore.js';
import { peyoteRowCount, peyoteRowCells } from '../grid/peyote.js';

// Distinguishes "cell absent" (a genuinely blank run — colorId: null, unchanged
// meaning since Phase 5) from "cell present with colorId: null" (Phase 6: occupied
// in the shared shape, but this colorway hasn't assigned it a color yet) — a run
// type of its own so a colorway missing colors doesn't silently print as if those
// beads don't exist, or worse, print as blank/skip instructions a stitcher would
// follow literally.
export const UNASSIGNED = Symbol('unassigned-color');

// Rows 1 & 2 can't be worked as separate thread passes — row 2's beads lock
// row 1's in place, so both are strung onto the thread together in one
// alternating sequence (row1-bead0, row2-bead0, row1-bead1, row2-bead1, ...)
// before any weaving happens. This is strict single-bead alternation because
// it's single-drop peyote; multi-drop (2+ beads alternating per stitch) would
// need this generalized, but that's an unscheduled future stitch variant, not
// built here.
function interleaveCells(rowACells, rowBCells) {
  const interleaved = [];
  for (let i = 0; i < rowACells.length; i++) {
    interleaved.push(rowACells[i], rowBCells[i]);
  }
  return interleaved;
}

function buildRuns(cells, cellList, colorCounts, tallyUnassigned) {
  const runs = [];
  let current = null; // { colorId, count } — colorId null means a blank run

  for (const { row, col } of cellList) {
    const cell = getCell(cells, row, col);
    let colorId;
    if (!cell) {
      colorId = null; // genuinely empty
    } else if (cell.colorId === null) {
      colorId = UNASSIGNED;
      tallyUnassigned();
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
  return runs;
}

export function buildWordChart(cells, rows, cols) {
  const chartRows = [];
  const colorCounts = new Map(); // colorId -> running total, insertion = first appearance
  let unassignedCount = 0;
  const tallyUnassigned = () => { unassignedCount++; };

  const rowCount = peyoteRowCount(cols);
  let nextPhysicalRow = 0;

  // Rows 1 & 2 (physical row index 0 & 1) are strung together as one
  // alternating sequence — see interleaveCells above — so they print as a
  // single combined instruction rather than two separate ones.
  if (rowCount >= 2) {
    const runs = buildRuns(
      cells,
      interleaveCells(peyoteRowCells(rows, 0), peyoteRowCells(rows, 1)),
      colorCounts,
      tallyUnassigned
    );
    chartRows.push({ entryIndex: 0, rowNumbers: [1, 2], combined: true, runs });
    nextPhysicalRow = 2;
  }

  for (let physicalRowIndex = nextPhysicalRow; physicalRowIndex < rowCount; physicalRowIndex++) {
    const runs = buildRuns(cells, peyoteRowCells(rows, physicalRowIndex), colorCounts, tallyUnassigned);
    chartRows.push({ entryIndex: chartRows.length, rowNumbers: [physicalRowIndex + 1], combined: false, runs });
  }

  const colorCountList = Array.from(colorCounts.entries()).map(([colorId, count]) => ({ colorId, count }));
  const totalBeadCount = colorCountList.reduce((sum, entry) => sum + entry.count, 0) + unassignedCount;
  return { rows: chartRows, colorCounts: colorCountList, totalBeadCount, unassignedCount };
}

// Direction alternates per *printed instruction*, not per physical row —
// after any instruction (whether it covers one row or, for the combined
// rows-1&2 case, two), the thread ends on the opposite side from where that
// instruction started, so the next one reads in the opposite direction.
// entryIndex (the printed line's own position), not a physical row number,
// is what drives this. startsReversed (from the printStartDirection global
// preference) flips which side the very first instruction reads from, and
// every later instruction's direction is XOR'd against that same base rather
// than recomputed independently.
export function isRowReversed(chartRow, startsReversed = false) {
  return (chartRow.entryIndex % 2 === 1) !== startsReversed;
}

// Peyote is worked back-and-forth — that's *why* peyoteCellOriginMm offsets odd rows
// by half a bead-width in the first place. The printed chart mirrors that same
// alternation so a line reads in the direction the thread actually travels, rather
// than always left-to-right regardless of row. Runs stay stored canonically
// left-to-right in `rows`; only display order is affected.
export function displayRuns(chartRow, startsReversed = false) {
  return isRowReversed(chartRow, startsReversed) ? [...chartRow.runs].reverse() : chartRow.runs;
}
