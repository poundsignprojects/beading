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

// A physical row (one full finished band, per peyoteRowCells) holds every bead in
// that band — the right level of abstraction for drawing — but single-drop peyote
// can only actually populate a band that way via two alternating-position thread
// passes once past the foundation: the beads sit alternately at even/odd positions
// within the band, and each pass only ever touches one of those two interleaved
// sets. Physical row 0 (the foundation ladder) is the exception — it's worked as
// one pass on its own, not split — so it prints as a single line. Every row after
// that splits into its even-position beads (0, 2, 4, ...) as one printed line and
// its odd-position beads (1, 3, 5, ...) as the next. Position within a band is
// peyoteRowCells' own `row` field, which is already emitted in ascending order, so
// its index in the returned array doubles as the position.
function splitByPosition(rowCells) {
  const even = [];
  const odd = [];
  rowCells.forEach((cell, position) => {
    (position % 2 === 0 ? even : odd).push(cell);
  });
  return { even, odd };
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

  function pushEntry(cellList) {
    const runs = buildRuns(cells, cellList, colorCounts, tallyUnassigned);
    chartRows.push({ entryIndex: chartRows.length, runs });
  }

  const rowCount = peyoteRowCount(cols);

  // Physical row 0 is the foundation ladder — worked as one pass, not split.
  if (rowCount >= 1) {
    pushEntry(peyoteRowCells(rows, 0));
  }

  // Every band after the foundation splits into its two alternating thread
  // passes — see splitByPosition above.
  for (let physicalRowIndex = 1; physicalRowIndex < rowCount; physicalRowIndex++) {
    const { even, odd } = splitByPosition(peyoteRowCells(rows, physicalRowIndex));
    pushEntry(even);
    pushEntry(odd);
  }

  const colorCountList = Array.from(colorCounts.entries()).map(([colorId, count]) => ({ colorId, count }));
  const totalBeadCount = colorCountList.reduce((sum, entry) => sum + entry.count, 0) + unassignedCount;
  return { rows: chartRows, colorCounts: colorCountList, totalBeadCount, unassignedCount };
}

// Direction alternates per *printed instruction*, not per physical row/band —
// after any instruction (the foundation pass, or one half-pass of a later
// band), the thread ends on the opposite side from where that instruction
// started, so the next one reads in the opposite direction. entryIndex (the
// printed line's own sequential position), not a physical row number, is what
// drives this. startsReversed (from the printStartDirection global
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
