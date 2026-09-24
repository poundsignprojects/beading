// Ephemeral, output-only overlay: reads appState once at mount, writes nothing
// back, no hooks into main.js needed (unlike editorView.js/libraryView.js, which
// both round-trip through storage). Sits on top of the already-mounted editor —
// closing it just hides the overlay again, no re-mount of the editor.

import { findBeadType } from '../palette/beadSpecs.js';
import { stitchTypeDetailLabel } from '../grid/gridEngine.js';
import { formatLength } from '../units/convert.js';
import { buildWordChart, displayRuns, isRowReversed, UNASSIGNED, firstOccupiedRow, clampStartRow, primaryLabelForRow, rowForLabel } from '../export/wordChart.js';
import { assignColorCodes } from '../export/colorCodes.js';
import { MISSING_COLOR_FALLBACK_HEX, resolveSwatchAppearance } from '../palette/colorLibrary.js';
import { findStashShortfalls } from '../palette/stashCheck.js';
import { renderThumbnailDataUrl } from '../render/thumbnailRenderer.js';
import { composeVisibleLayers } from '../state/colorwaySync.js';
import { showToast } from './toast.js';

// Deliberately bigger than the library's own THUMBNAIL_MAX_SIZE_PX (200, main.js)
// — a printout is read from further away / at lower effective DPI than a UI
// thumbnail — but still small on purpose (CLAUDE.md's Phase 5 status notes
// explicitly deferred a full-detail rendered picture chart as a separate, unbuilt
// feature; this is a quick-glance reference, not a substitute for the word chart).
// Acts as an upper bound on the reference image's longer side, not a fixed size —
// see referenceImageTargetSizePx below.
const PRINT_REFERENCE_IMAGE_MAX_SIZE_PX = 360;

// Same "CSS spec's fixed reference pixel" assumption editorView.js's own Actual
// Size view and rulerRenderer.js already rely on (1in = 96 CSS px, 1in = 25.4mm)
// — accurate relative to the pattern's own bead dimensions when printed at the
// browser/OS print dialog's 100% scale, not guaranteed laser-precise. Deliberately
// NOT multiplied by preferences.actualSizeCalibration: that factor corrects for
// one specific screen's own DPI quirks and has no bearing on a printed page, which
// goes through the printer/OS's own scale settings instead.
const CSS_PX_PER_MM = 96 / 25.4;

// The reference image renders at true physical size (so it can be held up
// against real beadwork at true scale) unless that would make it bigger than
// PRINT_REFERENCE_IMAGE_MAX_SIZE_PX on its longer side, in which case it's
// capped down to that instead — a large pattern shouldn't blow up the page, but
// a small one shouldn't be artificially scaled up past its own true size either.
function referenceImageTargetSizePx(boundingBoxMm) {
  const longerSideMm = Math.max(boundingBoxMm.widthMm, boundingBoxMm.heightMm);
  const actualSizePx = longerSideMm * CSS_PX_PER_MM;
  return Math.min(actualSizePx, PRINT_REFERENCE_IMAGE_MAX_SIZE_PX);
}

function resolveSwatch(customColors, colorId) {
  return customColors.find((swatch) => swatch.id === colorId);
}

function buildHeader(appState, designName) {
  const bead = findBeadType(appState.beadCatalog, appState.beadTypeKey);
  const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;

  const header = document.createElement('header');
  header.id = 'print-header';

  // An unnamed design (see main.js's handleCreate) just skips the title line
  // rather than printing a blank <h2> or an "Untitled Pattern" placeholder.
  const title = designName ? document.createElement('h2') : null;
  if (title) title.textContent = designName;

  const specLine = document.createElement('p');
  specLine.textContent = `${bead.name}, ${stitchTypeDetailLabel(appState.stitchType, appState.dropCount)} — ${appState.rows} rows × ${appState.cols} cols`;

  const sizeLine = document.createElement('p');
  sizeLine.textContent = `Finished size: ${formatLength(widthMm, 'mm')} × ${formatLength(heightMm, 'mm')} (${formatLength(widthMm, 'in')} × ${formatLength(heightMm, 'in')})`;

  // .append(null) would stringify to a literal "null" text node, so filter
  // out the title when there isn't one instead of passing it through.
  header.append(...[title, specLine, sizeLine].filter(Boolean));
  return header;
}

// hiddenLayerNames: names of every currently-hidden layer that still has at
// least one occupied cell — checked conservatively (regardless of whether
// that content would have been covered by a layer above it anyway, since a
// false-positive warning is harmless and a missed one isn't). See
// .work/feature-layers-plan.md — print/export mirrors exactly what the canvas
// currently shows (visible layers only), so this is the "something you can't
// see here still exists" notice.
function buildMaterials(chart, codes, customColors, hiddenLayerNames) {
  const section = document.createElement('section');
  section.id = 'print-materials';

  if (chart.totalBeadCount === 0 && hiddenLayerNames.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'print-empty-message';
    empty.textContent = 'No beads placed yet — nothing to print.';
    section.append(empty);
    return section;
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Materials';
  section.append(heading);

  if (hiddenLayerNames.length > 0) {
    const hiddenWarning = document.createElement('p');
    // print-warning-screen-only: an on-screen heads-up before printing, not
    // part of the actual printout — see the @media print rule in style.css.
    // The warning's whole point (know before you print) is satisfied once
    // it's been seen here; nobody wants "some content isn't shown" spelled
    // out on the physical page they're stitching from.
    hiddenWarning.className = 'print-warning print-warning-screen-only';
    hiddenWarning.textContent = `⚠ ${hiddenLayerNames.length} layer${hiddenLayerNames.length === 1 ? ' is' : 's are'} hidden and not included in this printout: ${hiddenLayerNames.join(', ')}.`;
    section.append(hiddenWarning);
  }

  if (chart.totalBeadCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'print-empty-message';
    empty.textContent = 'No visible beads to print — the only placed beads are on the hidden layer(s) above.';
    section.append(empty);
    return section;
  }

  if (chart.unassignedCount > 0) {
    const warning = document.createElement('p');
    warning.className = 'print-warning';
    warning.textContent = `⚠ ${chart.unassignedCount} bead${chart.unassignedCount === 1 ? '' : 's'} in this colorway have no color assigned yet.`;
    section.append(warning);
  }

  const table = document.createElement('table');
  table.className = 'print-materials-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Code</th><th>Color</th><th>Name</th><th>Count</th></tr>';

  const tbody = document.createElement('tbody');
  for (const { colorId, count } of chart.colorCounts) {
    const swatch = resolveSwatch(customColors, colorId);
    const row = document.createElement('tr');

    const codeCell = document.createElement('td');
    codeCell.textContent = codes.get(colorId);

    const swatchCell = document.createElement('td');
    const swatchEl = document.createElement('span');
    swatchEl.className = 'print-color-swatch';
    swatchEl.style.background = swatch?.hex ?? MISSING_COLOR_FALLBACK_HEX;
    swatchCell.append(swatchEl);

    const nameCell = document.createElement('td');
    nameCell.textContent = swatch?.name ?? colorId;

    const countCell = document.createElement('td');
    countCell.textContent = String(count);

    row.append(codeCell, swatchCell, nameCell, countCell);
    tbody.append(row);
  }

  const totalRow = document.createElement('tr');
  totalRow.className = 'print-total-row';
  totalRow.innerHTML = `<td colspan="3">Total beads</td><td>${chart.totalBeadCount}</td>`;
  tbody.append(totalRow);

  table.append(thead, tbody);
  section.append(table);
  return section;
}

function formatRun(run, codes) {
  if (run.colorId === null) return `${run.count}-`;
  if (run.colorId === UNASSIGNED) return `${run.count} ??`;
  return `${run.count}${codes.get(run.colorId)}`;
}

function buildChart(chart, codes, startsReversed) {
  const section = document.createElement('section');
  section.id = 'print-chart';

  if (chart.totalBeadCount === 0) return section;

  const heading = document.createElement('h3');
  heading.textContent = 'Word chart';
  section.append(heading);

  for (const chartRow of chart.rows) {
    const direction = isRowReversed(chartRow, startsReversed) ? '←' : '→';
    const runText = displayRuns(chartRow, startsReversed).map((run) => formatRun(run, codes)).join(' ');
    const line = document.createElement('div');
    line.className = chartRow.isStartRow ? 'word-chart-row word-chart-row-start' : 'word-chart-row';
    line.textContent = `${chartRow.rowLabel} ${direction}: ${runText}`;
    section.append(line);
  }

  return section;
}

// Non-blocking — a dismissible toast, not a confirm(), so it never stands
// between the user and the Print button (they can always print anyway,
// exactly as asked). Only shown once, at mount, not re-triggered by the
// direction/reference-image toggles' own renderContent() calls, since
// nothing about the shortfall changes when those are flipped.
function buildStashShortfallMessage(shortfalls) {
  const lines = shortfalls.map((s) => `${s.name}: need ${s.needed}, have ${s.stashCount}`);
  const label = shortfalls.length === 1 ? 'color needs' : 'colors need';
  return `⚠ Not enough beads in stash — ${shortfalls.length} ${label} more than you have on hand:\n${lines.join('\n')}`;
}

function directionToggleLabel(startsReversed) {
  return startsReversed ? 'Start: Left' : 'Start: Right';
}

function referenceImageToggleLabel(included) {
  return included ? 'Reference Image: On' : 'Reference Image: Off';
}

// A small rendered snapshot of the pattern itself (real bead colors, via the same
// renderThumbnailDataUrl the library's own thumbnails use) — not the Photo Trace
// reference photo (a separate, distinct feature per Decision #10). Data URLs need
// no cleanup/revocation the way an object URL would, so this is a pure function
// with no lifecycle to manage.
function buildReferenceImageSection(dataUrl) {
  const section = document.createElement('section');
  section.id = 'print-reference-image';

  const heading = document.createElement('h3');
  heading.textContent = 'Reference Image';

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Small rendered preview of the pattern';

  section.append(heading, img);
  return section;
}

export function mountPrintView(appState, hooks) {
  const printViewEl = document.getElementById('print-view');
  const contentEl = document.getElementById('print-content');
  const closeButton = document.getElementById('print-close');
  const printButton = document.getElementById('print-now');
  const startRowInput = document.getElementById('print-start-row');
  const directionToggleButton = document.getElementById('print-start-direction-toggle');
  const referenceImageToggleButton = document.getElementById('print-reference-image-toggle');

  const designName = appState.designs.find((d) => d.id === appState.currentDesignId)?.name ?? '';

  // Composited from every *visible* layer only (see .work/feature-layers-
  // plan.md — "what you see is what prints," matching how the live canvas
  // already renders, with zero separate print-only toggle to keep in sync).
  // overrideLayerId/overrideCells substitute the active layer's live,
  // not-yet-saved cells in place of what's actually persisted for it.
  // appState.layers is already scoped to the currently open colorway (see
  // .work/feature-per-colorway-layers-plan.md) — no colorway lookup needed.
  const displayCells = composeVisibleLayers(appState.layers, {
    overrideLayerId: appState.activeLayerId,
    overrideCells: appState.cells,
  });

  // Every currently-hidden layer that still has at least one occupied cell —
  // checked conservatively (see buildMaterials' own comment on this param).
  const hiddenLayerNames = appState.layers
    .filter((layer) => {
      if (layer.visible) return false;
      const shapeEntries = layer.id === appState.activeLayerId ? Array.from(appState.cells.keys()) : layer.shapeEntries;
      return shapeEntries.length > 0;
    })
    .map((layer) => layer.name);

  // Independent of startRow below — the reference image is a full-pattern
  // snapshot, not scoped to whichever rows the printed instructions start at.
  const designHasContent = displayCells.size > 0;
  const referenceImageDataUrl = designHasContent
    ? renderThumbnailDataUrl(
        appState.gridParams,
        displayCells,
        (colorId) => resolveSwatchAppearance(appState.customColors, colorId),
        referenceImageTargetSizePx(appState.gridParams.boundingBoxMm),
        findBeadType(appState.beadCatalog, appState.beadTypeKey)?.cornerRadiusFraction ?? 0
      )
    : null;

  // The field itself is read/shown against the chart's own fixed, unchanging
  // label numbers (primaryLabelForRow/rowForLabel), not a raw physical-row
  // count — a crafter looks at the default printout, spots the row they
  // actually mean to start at by whichever number is already printed there
  // (e.g. "13" or "14" for the same row), and types that in directly. Never
  // changes the printed numbering itself (see buildWordChart's own comment —
  // direct user feedback was that renumbering relative to the chosen row
  // made the chart "weird") — it only switches that one row from split to
  // combined (matching row 0's own treatment) and bolds it, independent of
  // the pre-existing every-10th-row bold (a different, unrelated
  // position-tracking aid).
  //
  // Defaults to the first occupied row — for a design with a leading run of
  // blank rows (see .work/feature-requests-and-bugs.md), this already lands
  // on the row that actually has beads, with no manual entry needed for the
  // common case.
  let startRowIndex = clampStartRow(firstOccupiedRow(displayCells) ?? 0, appState.rows);
  let chart = buildWordChart(displayCells, appState.rows, appState.cols, appState.stitchType, appState.staggerFlipped, appState.dropCount, startRowIndex);
  let codes = assignColorCodes(chart.colorCounts);

  startRowInput.min = '1';
  startRowInput.max = String(primaryLabelForRow(Math.max(appState.rows - 1, 0), appState.stitchType));

  function renderContent() {
    startRowInput.value = String(primaryLabelForRow(startRowIndex, appState.stitchType));

    const startsReversed = appState.preferences.printStartDirection === 'left';
    directionToggleButton.textContent = directionToggleLabel(startsReversed);

    referenceImageToggleButton.hidden = !designHasContent;
    const includeReferenceImage = designHasContent && appState.preferences.printIncludeReferenceImage !== false;
    referenceImageToggleButton.textContent = referenceImageToggleLabel(includeReferenceImage);
    referenceImageToggleButton.setAttribute('aria-pressed', String(includeReferenceImage));

    const sections = [
      buildHeader(appState, designName),
      buildMaterials(chart, codes, appState.customColors, hiddenLayerNames),
      buildChart(chart, codes, startsReversed),
    ];
    if (includeReferenceImage) {
      sections.push(buildReferenceImageSection(referenceImageDataUrl));
    }
    contentEl.replaceChildren(...sections);
  }

  function handlePrint() {
    window.print();
  }
  function handleClose() {
    unmount();
  }
  function handleStartRowChange() {
    const raw = Number(startRowInput.value);
    const nextIndex = Number.isFinite(raw) ? clampStartRow(rowForLabel(raw, appState.stitchType), appState.rows) : startRowIndex;
    if (nextIndex === startRowIndex) {
      renderContent(); // still re-syncs the input if the entry was out of range
      return;
    }
    startRowIndex = nextIndex;
    chart = buildWordChart(displayCells, appState.rows, appState.cols, appState.stitchType, appState.staggerFlipped, appState.dropCount, startRowIndex);
    codes = assignColorCodes(chart.colorCounts);
    renderContent();
  }
  async function handleDirectionToggle() {
    const next = appState.preferences.printStartDirection === 'left' ? 'right' : 'left';
    await hooks.onPreferencesChanged({ printStartDirection: next });
    renderContent();
  }
  async function handleReferenceImageToggle() {
    const next = !(appState.preferences.printIncludeReferenceImage !== false);
    await hooks.onPreferencesChanged({ printIncludeReferenceImage: next });
    renderContent();
  }

  closeButton.addEventListener('click', handleClose);
  printButton.addEventListener('click', handlePrint);
  startRowInput.addEventListener('change', handleStartRowChange);
  directionToggleButton.addEventListener('click', handleDirectionToggle);
  referenceImageToggleButton.addEventListener('click', handleReferenceImageToggle);

  renderContent();
  printViewEl.hidden = false;

  const stashShortfalls = findStashShortfalls(chart.colorCounts, appState.customColors);
  if (stashShortfalls.length > 0) {
    showToast(buildStashShortfallMessage(stashShortfalls));
  }

  function unmount() {
    printViewEl.hidden = true;
    contentEl.replaceChildren();
    closeButton.removeEventListener('click', handleClose);
    printButton.removeEventListener('click', handlePrint);
    startRowInput.removeEventListener('change', handleStartRowChange);
    directionToggleButton.removeEventListener('click', handleDirectionToggle);
    referenceImageToggleButton.removeEventListener('click', handleReferenceImageToggle);
  }

  return { unmount };
}
