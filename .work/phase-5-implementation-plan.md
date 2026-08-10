# Phase 5 Implementation Plan — Print / Export Instructions

## Context

Phases 1–4 built the grid engine, draw/erase, undo/redo, and save/load + library — a design can now be created, drawn, and persisted, but there's no way to get it out of the screen and into a stitcher's hands. Per CLAUDE.md's Phase Plan, Phase 5 is: "Row-by-row word chart generation, printable layout." This is also the last of Decision #12's v1 must-have tools (draw, erase, undo/redo, print/export) — everything after this phase (fill, color-replace, cut/copy, mirror, colorways, remaining tools) is v1.x/Phase 6+, not required for the app to be usable end-to-end.

"Word chart" is bead-weaving jargon, not a made-up term: it's the row-by-row *textual* recipe ("3 black, 1 red, 2 white, ...") a stitcher reads while working, as opposed to a "picture chart" (the colored grid graphic, which this app already renders live on canvas). CLAUDE.md names only the word chart, not a picture chart export — see "Scope boundary" below.

No Phase 5 code is written yet.

## Decisions confirmed for this plan

- **Word chart data is fully derived, nothing new is persisted.** It's computed from the current design's `cells`/`rows`/`cols`/`beadTypeKey` — already live in `appState` — at the moment the user opens the print view. No new IndexedDB store, no new design field.
- **This is not Decision #5's JSON export/import.** CLAUDE.md's "Later / optional" backlog item (manual export/import of a design as a JSON file, for backup/portability) is a different feature — moving *data* in and out of the app. Phase 5 is about producing a human-readable *stitching reference*, output-only, meant to be printed or saved as a PDF via the OS print dialog. Worth stating plainly so the two "export" ideas don't get conflated, same reasoning CLAUDE.md already applies to duplicate-vs-colorway.
- **Printing uses the browser's native print pipeline (`window.print()` + `@media print` CSS), not a PDF-generation library.** Consistent with Decision #2 (no dependencies beyond what's needed) — iPad Safari's print flow already offers "Save to Files" as PDF from the print preview / share sheet, so there's no missing capability to fill with a library. All net-new work is a printable DOM structure and print stylesheet.
- **Word chart rows are grouped by run, not printed as one character per bead.** Each row is walked left-to-right (`col` 0 → `cols - 1`) to build its canonical run list; consecutive cells of the same `colorId` collapse into a single `{colorId, count}` run, matching how real word charts are written ("3B 1R 2W", not "BBBRWW"). A run of empty cells collapses the same way, printed as a blank/skip count — this app's grids can already be non-rectangular in effect (unfilled cells at a row's edges or interior), so blanks need their own run type rather than being assumed away.
- **Printed rows alternate reading direction, matching peyote's actual back-and-forth thread path — confirmed by the user over the simpler always-left-to-right default.** Row 1 = grid row 0, read left-to-right; Row 2 = grid row 1, read right-to-left; and so on. This isn't arbitrary alternation — it lines up exactly with the row-parity offset `src/grid/peyote.js`'s `peyoteCellOriginMm` already uses (`row % 2 === 1` shifts a row by half a bead-width), since that offset exists *because* peyote is worked back-and-forth in the first place. `wordChart.js` still stores each row's runs in canonical left-to-right order (useful if anything else ever consumes this data, and simpler to test); a separate `displayRuns()` helper reverses odd rows only at render time, and `printView.js` prefixes each line with a direction indicator (→ / ←) so the alternation is visually obvious, not something the stitcher has to track by parity.
- **Colors get short, pattern-local codes (A, B, C, ..., Z, AA, AB, ...) for the chart and legend, not the raw `colorId` or full color name.** Only colors actually used in the pattern are assigned a code, most-used color first (shortest code), so every printed row stays compact regardless of what the underlying id looks like. This matters because `COLOR_LIBRARIES` is still placeholder data (CLAUDE.md's Bead Specs gap) — once real Miyuki DB/RR catalog numbers land, those ids could be longer strings, and the word chart shouldn't need to change when that happens.
- **A materials/legend table (code → swatch → name → count) is included alongside the row-by-row chart**, plus a total bead count. Not explicitly named in CLAUDE.md's one-line Phase 5 summary, but it's the same aggregation the per-row runs are already built from (near-zero extra cost) and is what makes the printout actually useful for restocking beads before a project — same category of "small, clearly-in-spirit addition" as Phase 2's Clear button or Phase 4's duplicate.
- **Print/Export is only available from an open design in the editor, not from the library list.** Printing a design not currently loaded into `appState` would mean re-deriving cells from `design.cellEntries` outside the normal open flow for no real benefit — a personal-use app doesn't need bulk/background printing. If that's wanted later it's an easy addition once this phase's `wordChart.js` exists, since that module doesn't care where its `cells` argument came from.
- **No picture-chart graphic on the printout in v1** — confirmed by the user; matches CLAUDE.md's Phase 5 line literally ("row-by-row word chart generation, printable layout," no picture chart named). See "Scope boundary."

## Scope boundary

Not in this phase: JSON design export/import (Decision #5, later/optional), a rendered picture-chart image on the printout (not named in CLAUDE.md's Phase 5 line; the live canvas already serves that purpose on-screen, and adding a print-resolution second renderer is real scope beyond "word chart + printable layout" — worth revisiting as a Phase 5.x if the word-chart-only printout proves insufficient in practice), colorways (Phase 6), fill/color-replace/cut/copy/mirror/photo-trace (Phase 7), any change to draw/erase/undo/save behavior.

## File-by-file breakdown

```
/src
  /export
    wordChart.js        — NEW: buildWordChart(cells, rows, cols) — pure. Row-length-
                           encodes each row into color/blank runs, and aggregates
                           per-color totals across the whole pattern.
    colorCodes.js        — NEW: assignColorCodes(colorCounts) — pure. Spreadsheet-
                           style A, B, ..., Z, AA, AB, ... codes, most-used color
                           first, only for colors actually present in the pattern.

  /ui
    printView.js          — NEW: mountPrintView(appState) / unmount(). Builds the
                             #print-view DOM (header, materials/legend table,
                             row-by-row chart) from the current design's live
                             appState, wires Print (window.print()) and Close.
                             Ephemeral — reads appState once at mount, writes nothing
                             back, no hooks into main.js needed.

  /test
    export/wordChart.test.js    — NEW
    export/colorCodes.test.js   — NEW

src/ui/editorView.js       — ADD: "Print / Export" button, opens printView as an
                              overlay above the editor (canvas/tools stay mounted
                              underneath; closing the overlay returns to them as-is)
index.html                  — ADD: #print-view container (header/materials/chart
                              placeholders + a small #print-toolbar with Close/Print,
                              itself hidden under @media print), a "Print / Export"
                              button in #controls
style.css                    — ADD: @media print rules (hide #library-view/
                              #editor-view/#print-toolbar, show #print-view),
                              word-chart row list styling (break-inside: avoid so a
                              run of text never splits across a page), legend table
                              styling, every-10th-row emphasis for keeping place on
                              a long printout
```

## Data model

```js
// buildWordChart(cells, rows, cols) return shape — nothing here is persisted
{
  rows: [
    {
      rowIndex: number,
      runs: [
        { colorId: string, count: number } |   // a run of one color
        { colorId: null, count: number }        // a run of empty cells ("skip")
      ]
    },
    // ...one entry per row, 0..rows-1
  ],
  colorCounts: [
    { colorId: string, count: number },  // total beads of this color across the whole design
    // ...in first-appearance order (row 0 → row N, left to right)
  ],
  totalBeadCount: number,
}
```

```js
// src/export/wordChart.js
import { getCell } from '../state/cellStore.js';

export function buildWordChart(cells, rows, cols) {
  const chartRows = [];
  const colorCounts = new Map(); // colorId -> running total, insertion = first appearance

  for (let row = 0; row < rows; row++) {
    const runs = [];
    let current = null; // { colorId, count } — colorId null means a blank run

    for (let col = 0; col < cols; col++) {
      const cell = getCell(cells, row, col);
      const colorId = cell ? cell.colorId : null;
      if (colorId) colorCounts.set(colorId, (colorCounts.get(colorId) ?? 0) + 1);

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
  const totalBeadCount = colorCountList.reduce((sum, entry) => sum + entry.count, 0);
  return { rows: chartRows, colorCounts: colorCountList, totalBeadCount };
}

// Peyote is worked back-and-forth — that's *why* peyoteCellOriginMm offsets odd rows
// by half a bead-width in the first place. The printed chart mirrors that same
// row-parity alternation so a line reads in the direction the thread actually
// travels, rather than always left-to-right regardless of row. Runs stay stored
// canonically left-to-right in `rows`; only display order is affected.
export function displayRuns(chartRow) {
  return chartRow.rowIndex % 2 === 1 ? [...chartRow.runs].reverse() : chartRow.runs;
}
```

```js
// src/export/colorCodes.js
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Spreadsheet-column-style codes: 0->A, 25->Z, 26->AA, 27->AB, ...
function codeForIndex(index) {
  let n = index;
  let code = '';
  do {
    code = ALPHABET[n % 26] + code;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return code;
}

// colorCounts: buildWordChart's colorCounts list. Sorted most-used-first so the
// shortest codes go to the colors that appear most on the printout; ties keep
// first-appearance order via Array#sort's stability.
export function assignColorCodes(colorCounts) {
  const sorted = [...colorCounts].sort((a, b) => b.count - a.count);
  const codes = new Map();
  sorted.forEach((entry, index) => codes.set(entry.colorId, codeForIndex(index)));
  return codes;
}
```

Both are pure and take plain data in — no DOM, no `appState`, no canvas — so they're fully covered by `node:test` with no headless-browser step, same category as `strokePatch.js`/`historyStore.js` in Phase 3.

## Print view

`printView.js` reads, at mount time: `appState.cells`, `appState.rows`, `appState.cols`, `appState.beadTypeKey`, `appState.units`, and the current design's `name` — which isn't in `appState` directly (Phase 4 never needed it in the editor), so it's looked up as `appState.designs.find(d => d.id === appState.currentDesignId)?.name`.

Rendered content, top to bottom:
1. **Header** — pattern name, bead type + size (`BEAD_TYPES[beadTypeKey].name`), `rows × cols`, finished size in both mm and in (reuses `formatLength`, same as the editor's size readout, so the two never drift).
2. **Materials** — one row per entry in `colorCounts`: code (from `assignColorCodes`), a small swatch, the color's `name`, and its count; a final total-beads row. This is the shopping/restock list.
3. **Word chart** — one line per grid row: `Row {rowIndex + 1} {→|←}: {displayRuns(row) rendered as "{count}{code}" or "{count} blank", space-separated}`. Row 1 = grid row 0, printed top-to-bottom in the same order the canvas already shows. The `→`/`←` prefix reflects `displayRuns`' alternation (even `rowIndex` → `→`, odd → `←`) so the reading-direction switch every other line is visually explicit rather than something to infer from row parity.
4. If `totalBeadCount === 0`, replace 2–3 with a single "No beads placed yet — nothing to print." message rather than an empty table and an all-blank chart.

Overlay behavior: `#print-view` is a fixed, full-screen panel (`position: fixed; inset: 0`) shown/hidden via the `hidden` attribute, same toggle pattern `index.html` already uses for `#library-view`/`#editor-view`. It sits on top of the mounted editor rather than replacing it in `appState.view` — closing it is just hiding the overlay again, no re-mount of the editor needed. `#print-toolbar` (Close, Print) lives inside `#print-view` but is hidden via `@media print` so it never appears in the actual printout.

```css
#print-view { position: fixed; inset: 0; background: #fff; overflow-y: auto; z-index: 10; }

@media print {
  #library-view, #editor-view, #print-toolbar { display: none !important; }
  #print-view { position: static; inset: auto; }
}

.word-chart-row { break-inside: avoid; }        /* a run of text never splits across pages */
.word-chart-row:nth-child(10n) { font-weight: 600; }  /* every 10th row, easier to keep place on a long printout */
```

## Build order + verification

1. **`wordChart.js`** + tests. *Verify* (`node --test`): a row of all one color collapses to a single run; alternating single cells produce one run per cell; a row with leading/trailing/interior blanks produces correctly-positioned blank runs; `colorCounts`/`totalBeadCount` match a hand-counted small fixture; an entirely empty design (`cells.size === 0`) returns `totalBeadCount: 0` and every row as one full-width blank run; `displayRuns` returns a row's runs unchanged for even `rowIndex` and reversed (same run objects, reverse order) for odd `rowIndex`, confirmed against a fixture row with 3+ distinct runs so reversal order is unambiguous.
2. **`colorCodes.js`** + tests. *Verify* (`node --test`): most-used color gets `'A'`; a 30-color fixture rolls over into `AA`, `AB`, ...; a color with zero uses (not present in `colorCounts`) never gets a code; output is a plain `Map` keyed by `colorId`.
3. **`index.html`/`style.css`**: add the empty `#print-view` skeleton + `@media print` rules, no JS wiring yet. *Verify*: manually clear the `hidden` attribute in devtools, confirm the overlay covers the screen correctly and that toggling Chrome's "Print" preview shows only `#print-view` content (empty at this point) with the toolbar hidden.
4. **`printView.js`**: build the header/materials/chart DOM from `wordChart.js`/`colorCodes.js` output (rows rendered via `displayRuns`, with the `→`/`←` prefix), wire Print (`window.print()`) and Close. *Verify* (Playwright, same local-`http.server` approach as prior phases): draw a small known pattern spanning at least 3 rows in two colors plus a gap, open Print/Export, assert the rendered row text (including direction and per-row reversal on odd rows) and materials counts match the hand-computed expected chart exactly.
5. **Wire the "Print / Export" button into `editorView.js`**. *Verify*: button opens the overlay over the currently-open design; Close returns to a still-intact, still-interactive editor (draw/undo/etc. all still work afterward — the overlay approach means the editor was never unmounted).
6. **Edge cases** (Playwright): a design with zero beads placed shows the empty-state message instead of an empty table/chart; a large grid (reuse Phase 2/3's ~300×200 perf fixture) builds and renders its word chart without a noticeable stall, confirming cost scales with cells touched, not a pathological blowup from run-splitting; `page.emulateMedia({ media: 'print' })` confirms `#editor-view`/`#library-view`/`#print-toolbar` are actually hidden and don't leak into the print rendering.
7. **Real iPad pass**: tapping Print/Export opens the overlay comfortably (readable at iPad screen size before printing); tapping Print surfaces iPad Safari's native print/share flow; from there, "Save to Files" (or a physical printer, if available) produces a legible multi-page PDF for a longer pattern — row text, codes, and swatch colors all still readable at whatever the OS's default print scale is; confirm a very long pattern paginates without a row's text splitting across the page break (the `break-inside: avoid` rule from step 3).

## Open questions — resolved

Both were raised as open questions in the first draft of this plan and have since been confirmed by the user:

1. **Row order and direction: alternating, not always left-to-right.** Row 1 = grid row 0, printed top-to-bottom same as the canvas, but each row's reading direction alternates (Row 1 left-to-right, Row 2 right-to-left, ...) to match peyote's actual back-and-forth thread path — see the `displayRuns`/direction-indicator decisions above and in "Word chart rows are grouped by run..." This is more faithful to real stitching than the simpler always-left-to-right default this plan originally recommended, at the cost of a small amount of extra logic (`displayRuns`) and a direction indicator in the UI so the alternation isn't left implicit.
2. **No picture-chart graphic on the printout in v1** — confirmed as scoped out. Still a contained follow-up (reusing `canvasRenderer.js` against an offscreen canvas) if the word-chart-only printout proves hard to follow without visual cross-reference.

## Next step after this plan

Both open questions are resolved; implementation follows the build order above. No code has been written for this phase yet.
