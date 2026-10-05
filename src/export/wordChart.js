// Row-length-encodes a design's cells into the run-based data a printable word
// chart is built from (see .work/phase-5-implementation-plan.md). Pure — no DOM,
// no appState — so printView.js is the only thing that has to know how a design
// gets turned into a printout.

import { getCell } from '../state/cellStore.js';
import { isRaised } from '../grid/peyote.js';

// Distinguishes "cell absent" (a genuinely blank run — colorId: null, unchanged
// meaning since Phase 5) from "cell present with colorId: null" (Phase 6: occupied
// in the shared shape, but this colorway hasn't assigned it a color yet) — a run
// type of its own so a colorway missing colors doesn't silently print as if those
// beads don't exist, or worse, print as blank/skip instructions a stitcher would
// follow literally.
export const UNASSIGNED = Symbol('unassigned-color');

// A physical row holds every bead at that row index, across every col position
// (see peyoteCellOriginMm — row/col now mean what the UI's Rows/Cols labels
// already say, see .work/refactor-row-col-axis-naming-plan.md) — the right level
// of abstraction for drawing — but single-drop peyote can only actually populate
// a row that way via two alternating-position thread passes once past the
// foundation: the beads sit alternately at two real, half-bead-apart stitching
// levels within the row (peyoteCellOriginMm's `isRaised` rule — the same rule the
// canvas renderer uses to offset a cell), and each pass only ever touches one of
// those two levels — UNLESS a row is the one currently chosen to start a fresh
// thread at (see buildWordChart's startRow), in which case it's worked as one
// pass on its own instead, not split, printing as a single combined line.
//
// Numbering never changes based on which row that is. Every row has a fixed
// pair of numbers it's always known by — row 0 is "1"/"2", row 1 is "3"/"4",
// row r is "2r+1"/"2r+2" — regardless of whether that row happens to be
// combined or split right now. When split, its two numbers print as two
// separate lines ("Row 3", printed first since a row's lower/raised level
// sits immediately atop the previous row's higher/non-raised level in real
// stitching order — levels run 0, 0.5, 1, 1.5, ...; then "Row 4"). When
// combined (startRow's own row), both numbers print together on one line,
// joined with "&" ("Row 3 & 4"), built as one plain pass over every column
// (not divided by isRaised at all).
//
// startRow defaults to row 0 — which is why row 0 is "Row 1 & 2" by default,
// exactly matching this chart's own long-standing behavior before startRow
// existed — but row 0 is not hard-wired to combine. Choosing any OTHER row
// as startRow combines *that* row instead and un-combines row 0 right along
// with every other non-chosen row, printing it as ordinary separate "Row
// 1"/"Row 2" lines like any other row would (confirmed directly with the
// user across several rounds — a genuinely easy detail to get wrong, since
// "row 0 is always Row 1 & 2" and "row 0 always combines" sound like the
// same statement until you pick a different start row). The chosen row is
// flagged (see isStartRow) so printView.js can bold it, independent of the
// existing every-10th-row bold (a different, unrelated position-tracking
// aid for a long printout).
//
// The start doesn't have to sit inside one grid row, either (startOnSecondLine
// — direct user request: "if I choose 14, it will combine with 15"). A grid
// row's second line (non-raised, "Row 2r+2") and the NEXT grid row's first
// line (raised, "Row 2r+3") are consecutive half-bead-apart stitching levels
// too — exactly the same zigzag relationship a single grid row's own two
// lines have — so together they're just as valid a double row to start a
// thread on. That combined line takes each column's bead from whichever of
// the two grid rows that column belongs to on those levels (non-raised
// columns from row r, raised columns from row r+1), read in plain column
// order; row r's first line and row r+1's second line print as ordinary
// single lines on either side of it.
//
// Deliberately NOT bucketed by raw position (col-index) parity — whether
// even-numbered or odd-numbered positions are the "raised" ones flips depending on
// whether `cols` itself is odd or even (see isRaised's own derivation), so a
// position-parity split silently swaps which printed line is physically first
// whenever `cols` is even, producing a chart that's unstitchable in either
// direction. isRaised is the actual physical-level test and must be used directly.
//
// dropCount (see .work/feature-multi-drop-peyote-plan.md) needs no run-format
// change here — an N-drop group just means N consecutive columns share one
// isRaised bucket, so they land in the same printed line's run sequence
// automatically, and a run like "4A" already correctly reads as "4 same-
// colored beads in a row on this pass" whether picked up one at a time or N at
// a time. Only which columns land in which bucket changes, which is exactly
// what threading dropCount into isRaised already provides.

// Clamps a user-chosen "start row" (see buildWordChart's startRow param) into
// [0, rows) — it must name a real physical row for isStartRow to flag.
export function clampStartRow(startRow, rows) {
  if (!(rows > 0)) return 0;
  return Math.min(Math.max(Math.trunc(startRow) || 0, 0), rows - 1);
}

// The Start Row *field* on the print screen is read against the chart's own
// fixed, unchanging numbers (see buildWordChart) — a crafter looks at the
// default printout, spots the row they actually mean to start at by whatever
// number is already printed there, and types that in. They don't think in
// physical-row counts, so these two convert between a physical row (0-
// indexed, what buildWordChart's startRow actually takes) and that row's own
// fixed pair of printed numbers — for peyote, row r's pair is always
// "2r+1"/"2r+2" (row 0 is "1"/"2", same formula, no special case — either
// number names that row); for square stitch there's no doubling/combining at all,
// so a row's label is simply its own 1-indexed row number.
//
// WHICH of a peyote row's two numbers was typed matters, though (direct user
// request) — the typed number is always the FIRST line of the combined
// start, and it combines with the line right after it: "13" gives "Row 13 &
// 14" (one whole grid row), "14" gives "Row 14 & 15" (the second line of one
// grid row plus the first line of the next). See startsOnSecondLine and
// buildWordChart's startOnSecondLine.
export function primaryLabelForRow(row, stitchType = 'peyote') {
  if (stitchType === 'square') return row + 1;
  return row * 2 + 1;
}

export function rowForLabel(labelNumber, stitchType = 'peyote') {
  if (stitchType === 'square') return labelNumber - 1;
  return Math.floor((labelNumber - 1) / 2);
}

// True when a Start Row label names the SECOND of its grid row's two printed
// lines (peyote's even numbers) — the start then spans two grid rows instead
// of sitting inside one. Never true for square stitch (one line per row).
export function startsOnSecondLine(labelNumber, stitchType = 'peyote') {
  if (stitchType === 'square') return false;
  return labelNumber % 2 === 0;
}

// The highest label the Start Row field accepts. Peyote's very last number
// (2*rows, always even) has no line after it to combine with, so the field
// stops one short of it — the last valid start is "Row {2*rows-1} & {2*rows}".
export function maxStartLabel(rows, stitchType = 'peyote') {
  if (!(rows > 0)) return 1;
  return stitchType === 'square' ? rows : rows * 2 - 1;
}

export function clampStartLabel(labelNumber, rows, stitchType = 'peyote') {
  return Math.min(Math.max(Math.trunc(labelNumber) || 1, 1), maxStartLabel(rows, stitchType));
}

// The lowest occupied row across every cell actually placed — a reasonable
// default for startRow above (so a design with leading blank rows highlights
// the row that actually has beads, with no manual entry needed for the
// common case) without forcing that guess on the user, who can still
// override it on the print screen. Returns null for a completely empty
// design (nothing to default to).
export function firstOccupiedRow(cells) {
  let min = null;
  for (const key of cells.keys()) {
    const row = Number(key.slice(0, key.indexOf(',')));
    if (min === null || row < min) min = row;
  }
  return min;
}

function splitByPosition(rowCells, cols, flipped, dropCount) {
  const raised = [];
  const notRaised = [];
  for (const cell of rowCells) {
    (isRaised(cell.col, cols, flipped, dropCount) ? raised : notRaised).push(cell);
  }
  return { raised, notRaised };
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

// stitchType branches the row-grouping algorithm itself, not just the geometry
// underneath it — square stitch has no foundation-combining/raised-non-raised
// splitting structure at all (each physical row is one straight thread pass),
// unlike peyote's real stitching structure (see the file-level comment above).
// This can't be handled by the grid-engine abstraction (gridEngine.js) since
// it's specific to how a stitch type is actually worked, not its geometry.
//
// startRow (0-indexed, see clampStartRow) never changes numbering. For
// stitchType 'square' it only flags a row for bolding (isStartRow) — square
// has no combining concept to begin with. For peyote, the row it names gets
// the un-split, single-pass treatment (labeled with its own two numbers
// joined, "Row {2r+1} & {2r+2}") and every OTHER row — including row 0 when
// it isn't the chosen row — splits normally (see the file-level comment for
// the full reasoning). startRow: 0 (the default) reproduces this chart's
// original, startRow-unaware behavior exactly, since row 0 combining is just
// the ordinary case of "the chosen row combines," not a special rule.
//
// startOnSecondLine (peyote only) moves the combined start half a row later:
// instead of row startRow's own two lines, it joins row startRow's SECOND
// line with row startRow+1's FIRST ("Row {2r+2} & {2r+3}" — see the
// file-level comment). Ignored when startRow is the last row (nothing after
// it to combine with), falling back to that row's own pair.
export function buildWordChart(cells, rows, cols, stitchType = 'peyote', flipped = false, dropCount = 1, startRow = 0, startOnSecondLine = false) {
  const chartRows = [];
  const colorCounts = new Map(); // colorId -> running total, insertion = first appearance
  let unassignedCount = 0;
  const tallyUnassigned = () => { unassignedCount++; };
  const highlightRow = clampStartRow(startRow, rows);

  const spansTwoRows = stitchType !== 'square' && startOnSecondLine && highlightRow < rows - 1;

  function pushEntry(cellList, rowLabel, isStartRow) {
    const runs = buildRuns(cells, cellList, colorCounts, tallyUnassigned);
    chartRows.push({ entryIndex: chartRows.length, runs, rowLabel, isStartRow });
  }

  function rowCellsAt(row) {
    const cellList = [];
    for (let col = 0; col < cols; col++) cellList.push({ row, col });
    return cellList;
  }

  // Letter codes (colorCodes.js) follow colorCounts' first-appearance order,
  // so that order must NOT depend on which line is the combined start — a
  // combined line scans its columns in a different order than the two split
  // lines it replaces, which would otherwise swap two colors' letters (e.g.
  // E and F trading places) just from changing Start Row. Seed the order
  // once from the classic layout (row 0 as one plain pass, every later row
  // raised-then-non-raised); the real passes below only add to the counts.
  if (stitchType !== 'square') {
    for (let row = 0; row < rows; row++) {
      const rowCells = rowCellsAt(row);
      const { raised, notRaised } = splitByPosition(rowCells, cols, flipped, dropCount);
      for (const { col } of (row === 0 ? rowCells : [...raised, ...notRaised])) {
        const colorId = getCell(cells, row, col)?.colorId;
        if (colorId != null && !colorCounts.has(colorId)) colorCounts.set(colorId, 0);
      }
    }
  }

  if (stitchType === 'square') {
    // Each physical row is worked as one straight pass — no foundation
    // combining, no raised/non-raised split, one printed line per row.
    for (let row = 0; row < rows; row++) {
      pushEntry(rowCellsAt(row), `Row ${row + 1}`, row === highlightRow);
    }
  } else {
    // Row 0 is NOT hard-wired to always combine — it follows the exact same
    // rule as every other row (see below): whichever row is the chosen
    // startRow gets the un-split foundation-ladder treatment, and every
    // other row splits normally. Row 0 defaults to being that row
    // (startRow: 0), which is why it's always "Row 1 & 2" out of the box and
    // nothing needs to special-case it — but once a *different* row becomes
    // the chosen start, row 0 uncombines right along with every other
    // non-chosen row, printing as ordinary separate "Row 1"/"Row 2" lines
    // (direct user feedback: "Rows 1 and 2 get uncombined" once a different
    // start row is set — a real, missed requirement in an earlier version of
    // this feature, not just a labeling nuance).
    //
    // Numbered sequentially: grid row r contributes physical rows 2r+1
    // (raised, printed first) and 2r+2 (non-raised, printed second) when
    // split — matching how a stitcher actually counts real peyote rows —
    // or, when r is the chosen startRow, one combined line joining both of
    // those same numbers together (one plain pass over every column, not
    // divided by isRaised at all, mirroring exactly how row 0 has always
    // been built).
    for (let row = 0; row < rows; row++) {
      if (row === highlightRow && !spansTwoRows) {
        pushEntry(rowCellsAt(row), `Row ${row * 2 + 1} & ${row * 2 + 2}`, true);
        continue;
      }
      const { raised, notRaised } = splitByPosition(rowCellsAt(row), cols, flipped, dropCount);
      if (spansTwoRows && row === highlightRow) {
        // This row's first line prints alone; its second line joins the next
        // row's first line, column by column, as the combined start.
        pushEntry(raised, `Row ${row * 2 + 1}`, false);
        const nextRaised = splitByPosition(rowCellsAt(row + 1), cols, flipped, dropCount).raised;
        const joined = [...notRaised, ...nextRaised].sort((a, b) => a.col - b.col);
        pushEntry(joined, `Row ${row * 2 + 2} & ${row * 2 + 3}`, true);
        continue;
      }
      if (spansTwoRows && row === highlightRow + 1) {
        // First line already printed as part of the combined start above.
        pushEntry(notRaised, `Row ${row * 2 + 2}`, false);
        continue;
      }
      pushEntry(raised, `Row ${row * 2 + 1}`, false);
      pushEntry(notRaised, `Row ${row * 2 + 2}`, false);
    }
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
