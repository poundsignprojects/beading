// Ephemeral, output-only overlay: reads appState once at mount, writes nothing
// back, no hooks into main.js needed (unlike editorView.js/libraryView.js, which
// both round-trip through storage). Sits on top of the already-mounted editor —
// closing it just hides the overlay again, no re-mount of the editor.

import { BEAD_TYPES } from '../palette/beadSpecs.js';
import { COLOR_LIBRARIES } from '../palette/colorLibrary.js';
import { formatLength } from '../units/convert.js';
import { buildWordChart, displayRuns } from '../export/wordChart.js';
import { assignColorCodes } from '../export/colorCodes.js';

function resolveSwatch(beadTypeKey, colorId) {
  const library = COLOR_LIBRARIES[beadTypeKey];
  return library.find((swatch) => swatch.id === colorId);
}

function buildHeader(appState, designName) {
  const bead = BEAD_TYPES[appState.beadTypeKey];
  const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;

  const header = document.createElement('header');
  header.id = 'print-header';

  const title = document.createElement('h2');
  title.textContent = designName;

  const specLine = document.createElement('p');
  specLine.textContent = `${bead.name} — ${appState.rows} rows × ${appState.cols} cols`;

  const sizeLine = document.createElement('p');
  sizeLine.textContent = `Finished size: ${formatLength(widthMm, 'mm')} × ${formatLength(heightMm, 'mm')} (${formatLength(widthMm, 'in')} × ${formatLength(heightMm, 'in')})`;

  header.append(title, specLine, sizeLine);
  return header;
}

function buildMaterials(chart, codes, beadTypeKey) {
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

  const table = document.createElement('table');
  table.className = 'print-materials-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Code</th><th>Color</th><th>Name</th><th>Count</th></tr>';

  const tbody = document.createElement('tbody');
  for (const { colorId, count } of chart.colorCounts) {
    const swatch = resolveSwatch(beadTypeKey, colorId);
    const row = document.createElement('tr');

    const codeCell = document.createElement('td');
    codeCell.textContent = codes.get(colorId);

    const swatchCell = document.createElement('td');
    const swatchEl = document.createElement('span');
    swatchEl.className = 'print-color-swatch';
    swatchEl.style.background = swatch?.hex ?? '#ff00ff';
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
  return run.colorId === null ? `${run.count} blank` : `${run.count}${codes.get(run.colorId)}`;
}

function buildChart(chart, codes) {
  const section = document.createElement('section');
  section.id = 'print-chart';

  if (chart.totalBeadCount === 0) return section;

  const heading = document.createElement('h3');
  heading.textContent = 'Word chart';
  section.append(heading);

  for (const chartRow of chart.rows) {
    const direction = chartRow.rowIndex % 2 === 1 ? '←' : '→';
    const runText = displayRuns(chartRow).map((run) => formatRun(run, codes)).join(' ');
    const line = document.createElement('div');
    line.className = 'word-chart-row';
    line.textContent = `Row ${chartRow.rowIndex + 1} ${direction}: ${runText}`;
    section.append(line);
  }

  return section;
}

export function mountPrintView(appState) {
  const printViewEl = document.getElementById('print-view');
  const contentEl = document.getElementById('print-content');
  const closeButton = document.getElementById('print-close');
  const printButton = document.getElementById('print-now');

  const designName = appState.designs.find((d) => d.id === appState.currentDesignId)?.name ?? 'Untitled Pattern';
  const chart = buildWordChart(appState.cells, appState.rows, appState.cols);
  const codes = assignColorCodes(chart.colorCounts);

  contentEl.replaceChildren(
    buildHeader(appState, designName),
    buildMaterials(chart, codes, appState.beadTypeKey),
    buildChart(chart, codes)
  );

  function handlePrint() {
    window.print();
  }
  function handleClose() {
    unmount();
  }

  closeButton.addEventListener('click', handleClose);
  printButton.addEventListener('click', handlePrint);

  printViewEl.hidden = false;

  function unmount() {
    printViewEl.hidden = true;
    contentEl.replaceChildren();
    closeButton.removeEventListener('click', handleClose);
    printButton.removeEventListener('click', handlePrint);
  }

  return { unmount };
}
