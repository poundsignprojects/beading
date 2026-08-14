// Ephemeral, output-only overlay: reads appState once at mount, writes nothing
// back, no hooks into main.js needed (unlike editorView.js/libraryView.js, which
// both round-trip through storage). Sits on top of the already-mounted editor —
// closing it just hides the overlay again, no re-mount of the editor.

import { findBeadType } from '../palette/beadSpecs.js';
import { formatLength } from '../units/convert.js';
import { buildWordChart, displayRuns, isRowReversed, UNASSIGNED } from '../export/wordChart.js';
import { assignColorCodes } from '../export/colorCodes.js';
import { MISSING_COLOR_FALLBACK_HEX, resolveSwatchHex } from '../palette/colorLibrary.js';
import { renderThumbnailDataUrl } from '../render/thumbnailRenderer.js';

// Deliberately bigger than the library's own THUMBNAIL_MAX_SIZE_PX (200, main.js)
// — a printout is read from further away / at lower effective DPI than a UI
// thumbnail — but still small on purpose (CLAUDE.md's Phase 5 status notes
// explicitly deferred a full-detail rendered picture chart as a separate, unbuilt
// feature; this is a quick-glance reference, not a substitute for the word chart).
const PRINT_REFERENCE_IMAGE_MAX_SIZE_PX = 360;

function resolveSwatch(customColors, colorId) {
  return customColors.find((swatch) => swatch.id === colorId);
}

function buildHeader(appState, designName) {
  const bead = findBeadType(appState.beadCatalog, appState.beadTypeKey);
  const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;

  const header = document.createElement('header');
  header.id = 'print-header';

  const title = document.createElement('h2');
  title.textContent = designName;

  const specLine = document.createElement('p');
  specLine.textContent = `${bead.name} — ${appState.rows} cols × ${appState.cols} rows`;

  const sizeLine = document.createElement('p');
  sizeLine.textContent = `Finished size: ${formatLength(widthMm, 'mm')} × ${formatLength(heightMm, 'mm')} (${formatLength(widthMm, 'in')} × ${formatLength(heightMm, 'in')})`;

  header.append(title, specLine, sizeLine);
  return header;
}

function buildMaterials(chart, codes, customColors) {
  const section = document.createElement('section');
  section.id = 'print-materials';

  if (chart.totalBeadCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'print-empty-message';
    empty.textContent = 'No beads placed yet — nothing to print.';
    section.append(empty);
    return section;
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Materials';

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
  section.append(heading, table);
  return section;
}

function formatRun(run, codes) {
  if (run.colorId === null) return `${run.count} blank`;
  if (run.colorId === UNASSIGNED) return `${run.count} ??`;
  return `${run.count}${codes.get(run.colorId)}`;
}

// The first printed line is the foundation — physical rows 1 & 2, strung
// together (see wordChart.js's buildWordChart) — so it's labeled "Row 1 & 2"
// rather than "Row 1", matching how a stitcher actually counts real peyote
// rows. Every printed line after that is its own single real row, so once the
// foundation's two rows are accounted for, they number sequentially starting
// at 3 (entryIndex 1 -> Row 3, entryIndex 2 -> Row 4, ...) rather than restarting
// from the printed line's own sequential position — matching Loomerly's
// convention of numbering by real stitching row, not by printed line.
function formatRowLabel(chartRow) {
  if (chartRow.entryIndex === 0) return 'Row 1 & 2';
  return `Row ${chartRow.entryIndex + 2}`;
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
    line.className = 'word-chart-row';
    line.textContent = `${formatRowLabel(chartRow)} ${direction}: ${runText}`;
    section.append(line);
  }

  return section;
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
  const directionToggleButton = document.getElementById('print-start-direction-toggle');
  const referenceImageToggleButton = document.getElementById('print-reference-image-toggle');

  const designName = appState.designs.find((d) => d.id === appState.currentDesignId)?.name ?? 'Untitled Pattern';
  const chart = buildWordChart(appState.cells, appState.rows, appState.cols);
  const codes = assignColorCodes(chart.colorCounts);

  // Rendered once at mount, not per renderContent() call — appState.cells can't
  // change while this read-only overlay is open (see the file-level comment
  // above), so there's nothing to gain by re-drawing the canvas on every toggle
  // click. Only actually built when there's something to show it for.
  const hasContent = chart.totalBeadCount > 0;
  const referenceImageDataUrl = hasContent
    ? renderThumbnailDataUrl(
        appState.gridParams,
        appState.cells,
        (colorId) => resolveSwatchHex(appState.customColors, colorId),
        PRINT_REFERENCE_IMAGE_MAX_SIZE_PX,
        findBeadType(appState.beadCatalog, appState.beadTypeKey)?.cornerRadiusFraction ?? 0
      )
    : null;

  function renderContent() {
    const startsReversed = appState.preferences.printStartDirection === 'left';
    directionToggleButton.textContent = directionToggleLabel(startsReversed);

    referenceImageToggleButton.hidden = !hasContent;
    const includeReferenceImage = hasContent && appState.preferences.printIncludeReferenceImage !== false;
    referenceImageToggleButton.textContent = referenceImageToggleLabel(includeReferenceImage);
    referenceImageToggleButton.setAttribute('aria-pressed', String(includeReferenceImage));

    const sections = [
      buildHeader(appState, designName),
      buildMaterials(chart, codes, appState.customColors),
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
  directionToggleButton.addEventListener('click', handleDirectionToggle);
  referenceImageToggleButton.addEventListener('click', handleReferenceImageToggle);

  renderContent();
  printViewEl.hidden = false;

  function unmount() {
    printViewEl.hidden = true;
    contentEl.replaceChildren();
    closeButton.removeEventListener('click', handleClose);
    printButton.removeEventListener('click', handlePrint);
    directionToggleButton.removeEventListener('click', handleDirectionToggle);
    referenceImageToggleButton.removeEventListener('click', handleReferenceImageToggle);
  }

  return { unmount };
}
