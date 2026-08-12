// Ephemeral, output-only overlay: reads appState once at mount, writes nothing
// back, no hooks into main.js needed (unlike editorView.js/libraryView.js, which
// both round-trip through storage). Sits on top of the already-mounted editor —
// closing it just hides the overlay again, no re-mount of the editor.

import { BEAD_TYPES } from '../palette/beadSpecs.js';
import { formatLength } from '../units/convert.js';
import { buildWordChart, displayRuns, isRowReversed, UNASSIGNED } from '../export/wordChart.js';
import { assignColorCodes } from '../export/colorCodes.js';
import { MISSING_COLOR_FALLBACK_HEX } from '../palette/colorLibrary.js';

function resolveSwatch(customColors, colorId) {
  return customColors.find((swatch) => swatch.id === colorId);
}

function buildHeader(appState, designName) {
  const bead = BEAD_TYPES[appState.beadTypeKey];
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

// A physical row/band no longer maps 1:1 to a printed line (see wordChart.js's
// buildWordChart — a band past the foundation splits into two half-pass
// entries), so there's no single "row number" left to derive a label from.
// Numbering printed lines sequentially instead, matching Loomerly's own
// convention, which also makes cross-referencing a Loomerly-originated
// pattern more natural.
function formatRowLabel(chartRow) {
  return `Row ${chartRow.entryIndex + 1}`;
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

export function mountPrintView(appState, hooks) {
  const printViewEl = document.getElementById('print-view');
  const contentEl = document.getElementById('print-content');
  const closeButton = document.getElementById('print-close');
  const printButton = document.getElementById('print-now');
  const directionToggleButton = document.getElementById('print-start-direction-toggle');

  const designName = appState.designs.find((d) => d.id === appState.currentDesignId)?.name ?? 'Untitled Pattern';
  const chart = buildWordChart(appState.cells, appState.rows, appState.cols);
  const codes = assignColorCodes(chart.colorCounts);

  function renderContent() {
    const startsReversed = appState.preferences.printStartDirection === 'left';
    directionToggleButton.textContent = directionToggleLabel(startsReversed);
    contentEl.replaceChildren(
      buildHeader(appState, designName),
      buildMaterials(chart, codes, appState.customColors),
      buildChart(chart, codes, startsReversed)
    );
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

  closeButton.addEventListener('click', handleClose);
  printButton.addEventListener('click', handlePrint);
  directionToggleButton.addEventListener('click', handleDirectionToggle);

  renderContent();
  printViewEl.hidden = false;

  function unmount() {
    printViewEl.hidden = true;
    contentEl.replaceChildren();
    closeButton.removeEventListener('click', handleClose);
    printButton.removeEventListener('click', handlePrint);
    directionToggleButton.removeEventListener('click', handleDirectionToggle);
  }

  return { unmount };
}
