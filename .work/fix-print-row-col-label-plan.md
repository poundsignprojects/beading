# Fix: print instructions grouped along the wrong axis + combine rows 1 & 2

**Supersedes two earlier versions of this plan.** v1 diagnosed this as a text-label-only regression (`Col` → `Row` in `printView.js`) — wrong. v2 fixed the real bug (`wordChart.js` grouping cells along the wrong axis) but stopped there. This version adds a second, related fix requested directly by the user: peyote's first two physical rows are strung together as one alternating sequence (they can't be worked as separate passes — row 2's beads lock row 1's in place), so the printout needs to present them as a single combined instruction, not two.

## Context

User reports: (1) printed word chart doesn't match what a stitcher would call a "row" (logged in `.work/feature-requests-and-bugs.md`); (2) rows 1 & 2 should print combined, since they're strung at the same time, not worked as separate passes.

## Root cause (unchanged from v2 — still accurate)

`peyoteCellOriginMm(row, col, beadWidthMm, beadHeightMm)` (`src/grid/peyote.js`) computes:

```js
xMm = row * beadHeightMm
yMm = col * beadWidthMm + (row is odd ? beadWidthMm / 2 : 0)
```

Holding `col` fixed and stepping `row` produces the half-bead zigzag that's a real physical peyote row. Holding `row` fixed and stepping `col` produces a straight, non-offset line. `buildWordChart` currently groups by the wrong (straight) axis. Confirmed two ways: `peyoteNeighbors()` treats same-`col`/adjacent-`row` cells as physically touching; and the editor's own (correct) UI labels put `appState.cols` — the count of distinct `col` values — next to "Rows," which only makes sense if `col` identifies which physical row a bead belongs to.

## Design: a stitch-type-agnostic "physical row" accessor

Rather than rename the raw `row`/`col` coordinate pair everywhere (rejected — see the conversation for why: it's an opaque address pair in every file except `wordChart.js`, and `appState.rows`/`appState.cols` are persisted IndexedDB field names, so a true rename means a data migration for no behavioral gain), add two small pure exports to `src/grid/peyote.js`:

```js
// Peyote's internal row/col do NOT follow the row=horizontal/col=vertical
// convention a spreadsheet or bitmap would use — `row` is a bead's position
// *along* a physical stitching row (the zigzag/offset axis), `col` identifies
// *which* physical row it belongs to. That inversion is peyote-specific (a
// consequence of how the half-bead stagger is expressed — see
// peyoteCellOriginMm above) and must not leak into code that needs to reason
// about "a physical row" as a stitch-type-agnostic concept. Any such code
// (wordChart.js, any future exporter) should go through these two functions
// instead of assuming row/col's roles directly — when brick/square/loom get
// built, only their own grid modules need to implement this contract
// correctly; consumers like wordChart.js won't need to change at all.
export function peyoteRowCount(cols) {
  return cols;
}

export function peyoteRowCells(rows, physicalRowIndex) {
  const cells = [];
  for (let row = 0; row < rows; row++) cells.push({ row, col: physicalRowIndex });
  return cells;
}
```

This is the concrete shape of "more generic so they can be switched at will" from the original question — not a rename, an interface boundary. `wordChart.js` is rewritten to consume it instead of hand-rolling row/col loop nesting.

## Fix: `src/export/wordChart.js`

Full rewrite of the build logic (return shape changes — see below):

```js
import { getCell } from '../state/cellStore.js';
import { peyoteRowCount, peyoteRowCells } from '../grid/peyote.js';

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
  let current = null;
  for (const { row, col } of cellList) {
    const cell = getCell(cells, row, col);
    let colorId;
    if (!cell) {
      colorId = null;
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
  const colorCounts = new Map();
  let unassignedCount = 0;
  const tallyUnassigned = () => { unassignedCount++; };

  const rowCount = peyoteRowCount(cols);
  let nextPhysicalRow = 0;

  if (rowCount >= 2) {
    const runs = buildRuns(
      cells,
      interleaveCells(peyoteRowCells(rows, 0), peyoteRowCells(rows, 1)),
      colorCounts, tallyUnassigned
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
// is what should drive this.
export function displayRuns(chartRow) {
  return chartRow.entryIndex % 2 === 1 ? [...chartRow.runs].reverse() : chartRow.runs;
}
```

`colorCounts`/`totalBeadCount`/`unassignedCount` aggregation is unaffected by any of this — order/grouping-independent, already correct.

**Return shape change**: each `chart.rows[i]` is now `{ entryIndex, rowNumbers, combined, runs }` instead of `{ rowIndex, runs }`. `rowNumbers` is `[1, 2]` for the combined entry, `[N]` otherwise. `combined` lets `printView.js` render the label differently.

**Edge case**: if `cols < 2` (a one-row-tall pattern), `rowCount < 2` and the combining branch is skipped entirely — nothing to combine.

## Fix: `src/ui/printView.js`

```js
function formatRowLabel(chartRow) {
  return chartRow.combined
    ? `Rows ${chartRow.rowNumbers[0]} & ${chartRow.rowNumbers[1]} (strung together)`
    : `Row ${chartRow.rowNumbers[0]}`;
}

// inside buildChart(), per chartRow — startsReversed comes from the print
// start direction preference, see below:
const reversed = isRowReversed(chartRow, startsReversed);
const direction = reversed ? '←' : '→';
const runText = displayRuns(chartRow, startsReversed).map((run) => formatRun(run, codes)).join(' ');
line.textContent = `${formatRowLabel(chartRow)} ${direction}: ${runText}`;
```

(`isRowReversed`/`startsReversed` are defined in the preference section immediately below — this snippet is completed there, not duplicated.)

## Global preference: print start direction (confirmed by user, default `'right'`)

Rather than hardcode which side the first printed instruction reads from, it's a global preference — same established pattern as `units`/`panelCollapsed`/`libraryViewMode` (`preferencesStore.js` field + the existing generic `onPreferencesChanged` hook already in `main.js`, reused as-is, zero new `main.js` code needed).

**`src/export/wordChart.js`** — `displayRuns` takes an explicit `startsReversed` param (default `false`) rather than reaching into `appState` itself, keeping the module pure/testable. Factor the reversed-check into its own export so `printView.js` can use the same source of truth for both the run order and the arrow:

```js
export function isRowReversed(chartRow, startsReversed = false) {
  return (chartRow.entryIndex % 2 === 1) !== startsReversed; // XOR
}

export function displayRuns(chartRow, startsReversed = false) {
  return isRowReversed(chartRow, startsReversed) ? [...chartRow.runs].reverse() : chartRow.runs;
}
```

**`src/storage/preferencesStore.js`** — `DEFAULT_PREFERENCES` gains `printStartDirection: 'right'`. `'right'` = first printed instruction is not reversed (`→`); `'left'` = first instruction reads `←` and every subsequent entry's direction flips accordingly (since alternation is XOR'd against this base, not recomputed independently).

**`src/ui/printView.js`** — `mountPrintView(appState, hooks)` gains a `hooks` param (currently none — plan v2 assumed print stays entirely hookless; that assumption no longer holds once anything in the print view needs to persist a change). Reads `appState.preferences.printStartDirection`, computes `startsReversed = preferences.printStartDirection === 'left'`, and passes it through `isRowReversed`/`displayRuns` when building each line. A new toggle button in `#print-toolbar` (`Start: Right` / `Start: Left`) flips the preference, calls `hooks.onPreferencesChanged({ printStartDirection: newValue })` (writes through immediately, same as every other preference toggle), and re-renders `#print-chart` in place — no need to close/reopen the print view to see the effect.

**`src/ui/editorView.js`** — `handlePrintExport()` (currently `mountPrintView(appState)`, line ~827) changes to `mountPrintView(appState, { onPreferencesChanged: hooks.onPreferencesChanged })`, reusing the exact same hook reference `editorView.js` already receives from `main.js` for its own preference writes (units, panel-collapse). `main.js`'s `handlePreferencesChanged` (a generic `{ ...appState.preferences, ...patch }` merge-and-save, `main.js:96`) needs no changes at all — confirmed by reading it directly, it already handles an arbitrary patch shape.

**`index.html`/`style.css`** — new `#print-start-direction-toggle` button added to `#print-toolbar`, styled consistent with the existing Close/Print buttons there.

**Deferred, logged separately**: the user's idea of consolidating this toggle (plus the existing units/panel-collapsed/library-view-mode toggles, currently scattered across the top bar and library header) into a single global preferences modal. Good idea, but real scope on its own — relocating three existing, working controls plus designing new modal chrome — and deserves its own plan rather than riding on this bug fix. Logged in `.work/feature-requests-and-bugs.md`. Moving this toggle into that modal later, if built, is cheap: relocate the button markup, keep the same `onPreferencesChanged` hook — no logic changes.

## Direction-alternation-after-combining — confirmed correct by user

The mechanically-derived logic (Row 3 reads `←` when starting `'right'`, not `→` — direction alternates per printed instruction, not per physical row, so combining rows 1 & 2 into one instruction shifts every subsequent row's direction by one step) is confirmed correct. No longer an open question.

## Status: plan approved, implementation not yet started

All open questions in this plan are resolved (axis fix, rows-1&2 combining/interleave order, direction-alternation-after-combining, print-start-direction preference default and scope). Ready to implement in a future session — user has explicitly requested implementation happen in a new chat, not this one.

## `src/test/export/wordChart.test.js`

Full rewrite required — the parameter meaning (`rows`=beads-per-row, `cols`=physical row count, matching the v2 fix) and the return shape (`entryIndex`/`rowNumbers`/`combined` instead of `rowIndex`) both changed, and the automatic rows-1&2 combining changes chart.rows' length for any `cols >= 2` fixture. Plan:
- Tests that want to exercise a single, uncombined row in isolation use `cols: 1` (so `rowCount < 2`, combining doesn't trigger), sidestepping combining entirely for run-collapsing coverage (single-color run, alternating cells, leading/trailing/interior blanks, mixed real/blank/unassigned — same coverage as today, just with `rows`/`cols` swapped to match the corrected axis).
- New dedicated tests for combining: a `cols: 3` (or more) fixture with distinct colors in rows 1, 2, and 3, asserting `chart.rows[0]` is `{ combined: true, rowNumbers: [1,2], runs: <hand-computed interleaved runs> }` and `chart.rows[1]` is the normal, uncombined row 3.
- A dedicated regression test for `peyoteRowCount`/`peyoteRowCells` in `src/test/grid/peyote.test.js`.
- `isRowReversed`/`displayRuns` tests updated for the new `(chartRow, startsReversed)` signature: default (`startsReversed` omitted/`false`) matches today's behavior (entryIndex 0 not reversed, entryIndex 1 reversed); `startsReversed: true` flips both.
- Keep the existing asymmetric regression fixture (2×3 design, distinct colors) from v2 to lock in the corrected grouping axis, adjusted for the new return shape.
- `colorCounts`/`totalBeadCount`/`unassignedCount` tests need no changes beyond parameter-order fixes — grouping-agnostic.

## Explicitly scoped out

- `buildHeader()`'s spec line (`` `${appState.rows} cols × ${appState.cols} rows` ``) — unaffected, already correct.
- No rename of `row`/`col` in `peyote.js`'s coordinate-pair parameters, `cellStore.js`, the tools, `canvasRenderer.js`, `appState.rows`/`cols`, or the IndexedDB schema.
- No generalized "drop size" parameter for multi-drop peyote — unscheduled, and the interleave function above is written specifically for the 2-row/1-bead case; generalizing it now would be building for a requirement that doesn't exist yet.
- Combining logic lives inline in `wordChart.js` (implicitly peyote-only, matching how the whole app is peyote-only today — no stitch-type dispatch exists anywhere yet). Not worth inventing a stitch-type abstraction layer for this one fix; that's real scope for whichever session actually builds brick/square/loom.
- No global preferences modal — the print-start-direction toggle uses the existing scattered-per-control pattern (same as units/panel-collapsed/library-view-mode today). Consolidating all of these into one modal is logged as its own backlog item in `.work/feature-requests-and-bugs.md`, not built here.

## Verification

1. `node:test` — full rewrite of `wordChart.test.js` per above, new `peyoteRowCount`/`peyoteRowCells` tests in `peyote.test.js`, run full suite (currently 131 passing) to confirm no regression elsewhere. `preferencesStore.js`/`printView.js` get no new `node:test` coverage — same precedent as their existing (lack of) coverage, DOM/IndexedDB-dependent — verified via Playwright instead.
2. Headless Chromium (Playwright): create a design with `rows ≠ cols` (e.g. 5 wide × 9 rows-tall) and at least 3 distinct-colored physical rows, paint cells with known expected output. Open Print/Export and assert:
   - First printed line reads `Rows 1 & 2 (strung together) →: ...` with hand-verified interleaved run content.
   - Second printed line reads `Row 3 ←: ...`, third `Row 4 →: ...`, confirming the shifted alternation.
   - Total printed line count is `appState.cols - 1` (one fewer than physical row count, since two collapsed into one).
3. Toggling `Start: Right` → `Start: Left` in the print toolbar, without closing the print view: first line flips to `←`, every subsequent line's arrow flips too, run order within each line reverses to match; closing and reopening Print/Export (same design) keeps the toggled value; a *reload* of the whole app also keeps it (confirms the write actually persisted via `savePreferences`, not just held in `printView.js`'s local closure state).
4. Re-run existing Phase 5/6/7 print-view Playwright checks (materials table, unassigned-color warning, empty-design message) — unaffected by grouping/combining/the new preference, but confirm no regression.
