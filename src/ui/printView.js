// Ephemeral, output-only overlay: reads appState once at mount, writes nothing
// back, no hooks into main.js needed (unlike editorView.js/libraryView.js, which
// both round-trip through storage). Sits on top of the already-mounted editor —
// closing it just hides the overlay again, no re-mount of the editor.

import { findBeadType } from '../palette/beadSpecs.js';
import { stitchTypeDetailLabel } from '../grid/gridEngine.js';
import { formatLength } from '../units/convert.js';
import { buildWordChart, displayRuns, isRowReversed, UNASSIGNED, firstOccupiedRow, clampStartRow, primaryLabelForRow, rowForLabel, startsOnSecondLine, maxStartLabel, clampStartLabel } from '../export/wordChart.js';
import { assignColorCodes } from '../export/colorCodes.js';
import { buildPrintPdf } from '../export/printPdf.js';
import { deflateBytes } from '../export/pdfWriter.js';
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

// The PDF version of the printout (see handlePrint) places the reference image
// by physical size, so its pixels only set how sharp it prints.
const PDF_REFERENCE_IMAGE_DPI = 300;
const PT_PER_MM = 72 / 25.4;
const PT_PER_CSS_PX = 72 / 96;

// window.print() silently does nothing in an iOS/iPadOS 27 home-screen web app
// (no print sheet, no error) while the same page prints fine in a Safari tab.
// navigator.standalone is Safari's own flag for exactly that mode and is
// undefined everywhere else, so nothing changes for Safari tabs or the Mac.
function isIosHomeScreenApp() {
  return typeof navigator !== 'undefined' && navigator.standalone === true;
}

function pdfFileName(designName) {
  const safeName = designName.replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${safeName || 'Bead pattern'}.pdf`;
}

function resolveSwatch(customColors, colorId) {
  return customColors.find((swatch) => swatch.id === colorId);
}

// The two lines under the title. Shared with the PDF version of the printout
// (buildPrintPdf), like the other *Text helpers below.
function headerInfoLines(appState) {
  const bead = findBeadType(appState.beadCatalog, appState.beadTypeKey);
  const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
  return [
    `${bead.name}, ${stitchTypeDetailLabel(appState.stitchType, appState.dropCount)} — ${appState.rows} rows × ${appState.cols} cols`,
    `Finished size: ${formatLength(widthMm, 'mm')} × ${formatLength(heightMm, 'mm')} (${formatLength(widthMm, 'in')} × ${formatLength(heightMm, 'in')})`,
  ];
}

const NOTHING_PLACED_TEXT = 'No beads placed yet — nothing to print.';
const ONLY_HIDDEN_BEADS_TEXT = 'No visible beads to print — the only placed beads are on the hidden layer(s) above.';

function unassignedWarningText(chart) {
  return `${chart.unassignedCount} bead${chart.unassignedCount === 1 ? '' : 's'} in this colorway have no color assigned yet.`;
}

function buildHeader(appState, designName) {
  const [specText, sizeText] = headerInfoLines(appState);

  const header = document.createElement('header');
  header.id = 'print-header';

  // An unnamed design (see main.js's handleCreate) just skips the title line
  // rather than printing a blank <h2> or an "Untitled Pattern" placeholder.
  const title = designName ? document.createElement('h2') : null;
  if (title) title.textContent = designName;

  const specLine = document.createElement('p');
  specLine.textContent = specText;

  const sizeLine = document.createElement('p');
  sizeLine.textContent = sizeText;

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
    empty.textContent = NOTHING_PLACED_TEXT;
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
    empty.textContent = ONLY_HIDDEN_BEADS_TEXT;
    section.append(empty);
    return section;
  }

  if (chart.unassignedCount > 0) {
    const warning = document.createElement('p');
    warning.className = 'print-warning';
    warning.textContent = `⚠ ${unassignedWarningText(chart)}`;
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

// Keyed off the row's own number(s), not its position in the list — a
// combined line shifts every later line's position by one.
function isTenthRow(chartRow) {
  const rowNumbers = chartRow.rowLabel.match(/\d+/g) ?? [];
  return rowNumbers.some((n) => Number(n) % 10 === 0);
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
    if (chartRow.isStartRow) line.classList.add('word-chart-row-start');
    if (isTenthRow(chartRow)) line.classList.add('word-chart-row-tenth');
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

function layoutToggleLabel(layout) {
  return layout === 'landscape' ? 'Layout: Landscape, 2 Columns' : 'Layout: Portrait';
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

// The same content renderContent() puts on screen, as the plain model
// buildPrintPdf lays out. hiddenLayerNames only matters here for telling the
// two empty states apart — the hidden-layer warning itself is screen-only.
function buildPdfModel({ appState, designName, chart, codes, startsReversed, hiddenLayerNames, referenceImage }) {
  const isEmpty = chart.totalBeadCount === 0;
  return {
    title: designName,
    infoLines: headerInfoLines(appState),
    emptyMessage: isEmpty ? (hiddenLayerNames.length > 0 ? ONLY_HIDDEN_BEADS_TEXT : NOTHING_PLACED_TEXT) : null,
    warning: chart.unassignedCount > 0 ? unassignedWarningText(chart) : null,
    materials: chart.colorCounts.map(({ colorId, count }) => {
      const swatch = resolveSwatch(appState.customColors, colorId);
      return { code: codes.get(colorId), hex: swatch?.hex ?? MISSING_COLOR_FALLBACK_HEX, name: swatch?.name ?? String(colorId), count };
    }),
    totalBeadCount: chart.totalBeadCount,
    chartLines: isEmpty ? [] : chart.rows.map((chartRow) => ({
      label: chartRow.rowLabel,
      reversed: isRowReversed(chartRow, startsReversed),
      runs: displayRuns(chartRow, startsReversed).map((run) => formatRun(run, codes)),
      bold: isTenthRow(chartRow),
      isStart: chartRow.isStartRow,
    })),
    referenceImage,
  };
}

// The pattern snapshot as buildPrintPdf wants it: deflated RGB pixels plus the
// size to print it at — true physical size, capped like the on-screen version.
async function prepareReferenceImageForPdf(gridParams, cells, resolveColor, cornerRadiusFraction) {
  const { widthMm, heightMm } = gridParams.boundingBoxMm;
  const longerSidePt = Math.min(Math.max(widthMm, heightMm) * PT_PER_MM, PRINT_REFERENCE_IMAGE_MAX_SIZE_PX * PT_PER_CSS_PX);
  // renderThumbnailDataUrl multiplies its size by devicePixelRatio itself.
  const targetPx = (longerSidePt / 72) * PDF_REFERENCE_IMAGE_DPI / (window.devicePixelRatio || 1);
  const image = new Image();
  image.src = renderThumbnailDataUrl(gridParams, cells, resolveColor, targetPx, cornerRadiusFraction);
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }

  const ptPerPx = longerSidePt / Math.max(canvas.width, canvas.height);
  return {
    widthPx: canvas.width,
    heightPx: canvas.height,
    data: await deflateBytes(rgb),
    widthPt: canvas.width * ptPerPx,
    heightPt: canvas.height * ptPerPx,
  };
}

export function mountPrintView(appState, hooks) {
  const printViewEl = document.getElementById('print-view');
  const contentEl = document.getElementById('print-content');
  const closeButton = document.getElementById('print-close');
  const printButton = document.getElementById('print-now');
  const startRowInput = document.getElementById('print-start-row');
  const directionToggleButton = document.getElementById('print-start-direction-toggle');
  const referenceImageToggleButton = document.getElementById('print-reference-image-toggle');
  const layoutToggleButton = document.getElementById('print-layout-toggle');

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
  const resolveReferenceColor = (colorId) => resolveSwatchAppearance(appState.customColors, colorId);
  const referenceCornerRadiusFraction = findBeadType(appState.beadCatalog, appState.beadTypeKey)?.cornerRadiusFraction ?? 0;
  const referenceImageDataUrl = designHasContent
    ? renderThumbnailDataUrl(
        appState.gridParams,
        displayCells,
        resolveReferenceColor,
        referenceImageTargetSizePx(appState.gridParams.boundingBoxMm),
        referenceCornerRadiusFraction
      )
    : null;

  // Prepared now rather than when Print is tapped: navigator.share only works
  // while the tap still counts as a user gesture, and waiting on this inside
  // the tap handler can use that up. A failure just leaves the image out.
  let pdfReferenceImage = null;
  let pdfReferenceImageSettled = true;
  let pdfReferenceImagePromise = null;
  if (isIosHomeScreenApp() && designHasContent) {
    pdfReferenceImageSettled = false;
    pdfReferenceImagePromise = prepareReferenceImageForPdf(appState.gridParams, displayCells, resolveReferenceColor, referenceCornerRadiusFraction)
      .then((image) => { pdfReferenceImage = image; })
      .catch(() => {})
      .finally(() => { pdfReferenceImageSettled = true; });
  }

  // The field itself is read/shown against the chart's own fixed, unchanging
  // label numbers (primaryLabelForRow/rowForLabel), not a raw physical-row
  // count — a crafter looks at the default printout, spots the row they
  // actually mean to start at by whichever number is already printed there,
  // and types that in directly. The typed number is always the first line of
  // the combined start and joins the line after it ("13" gives "Row 13 & 14",
  // "14" gives "Row 14 & 15") — which is why the field stops one short of
  // the very last number, which has nothing after it to join. Never
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
  let startLabel = primaryLabelForRow(clampStartRow(firstOccupiedRow(displayCells) ?? 0, appState.rows), appState.stitchType);
  function buildChartForStartLabel() {
    return buildWordChart(
      displayCells, appState.rows, appState.cols, appState.stitchType, appState.staggerFlipped, appState.dropCount,
      rowForLabel(startLabel, appState.stitchType),
      startsOnSecondLine(startLabel, appState.stitchType)
    );
  }
  let chart = buildChartForStartLabel();
  let codes = assignColorCodes(chart.colorCounts);

  startRowInput.min = '1';
  startRowInput.max = String(maxStartLabel(appState.rows, appState.stitchType));

  function renderContent() {
    startRowInput.value = String(startLabel);

    const startsReversed = appState.preferences.printStartDirection === 'left';
    directionToggleButton.textContent = directionToggleLabel(startsReversed);

    // Only the PDF has a layout choice, and only the home-screen app prints
    // through the PDF — anywhere else the toggle would do nothing.
    layoutToggleButton.hidden = !isIosHomeScreenApp();
    layoutToggleButton.textContent = layoutToggleLabel(appState.preferences.printPdfLayout);

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
    if (isIosHomeScreenApp()) {
      sharePrintoutAsPdf();
    } else {
      window.print();
    }
  }
  // The home-screen app's route to a printer: the printout as a PDF, handed
  // to the iOS share sheet, which has Print in it. The file exists only in
  // memory — nothing is saved unless a share-sheet action saves it.
  async function sharePrintoutAsPdf() {
    const includeReferenceImage = designHasContent && appState.preferences.printIncludeReferenceImage !== false;
    // Only awaits in the rare case Print is tapped before the image is ready;
    // otherwise everything up to navigator.share runs inside the tap itself.
    if (includeReferenceImage && !pdfReferenceImageSettled) await pdfReferenceImagePromise;

    let file;
    try {
      const bytes = buildPrintPdf(buildPdfModel({
        appState,
        designName,
        chart,
        codes,
        startsReversed: appState.preferences.printStartDirection === 'left',
        hiddenLayerNames,
        referenceImage: includeReferenceImage ? pdfReferenceImage : null,
      }), { layout: appState.preferences.printPdfLayout === 'landscape' ? 'landscape' : 'portrait' });
      file = new File([bytes], pdfFileName(designName), { type: 'application/pdf' });
    } catch (err) {
      showToast(`Couldn't build the printout: ${err.message}`);
      return;
    }

    try {
      if (!navigator.canShare?.({ files: [file] })) throw new Error('File sharing is not available');
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err.name === 'AbortError') return; // share sheet dismissed
      if (err.name === 'NotAllowedError') {
        showToast('The share sheet did not open. Tap Print again.');
        return;
      }
      // No share sheet at all: hand the PDF over as a download instead, so it
      // can still be opened and printed from there.
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }
  function handleClose() {
    unmount();
  }
  function handleStartRowChange() {
    const raw = Number(startRowInput.value);
    const nextLabel = Number.isFinite(raw) ? clampStartLabel(raw, appState.rows, appState.stitchType) : startLabel;
    if (nextLabel === startLabel) {
      renderContent(); // still re-syncs the input if the entry was out of range
      return;
    }
    startLabel = nextLabel;
    chart = buildChartForStartLabel();
    codes = assignColorCodes(chart.colorCounts);
    renderContent();
  }
  async function handleDirectionToggle() {
    const next = appState.preferences.printStartDirection === 'left' ? 'right' : 'left';
    await hooks.onPreferencesChanged({ printStartDirection: next });
    renderContent();
  }
  async function handleLayoutToggle() {
    const next = appState.preferences.printPdfLayout === 'landscape' ? 'portrait' : 'landscape';
    await hooks.onPreferencesChanged({ printPdfLayout: next });
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
  layoutToggleButton.addEventListener('click', handleLayoutToggle);

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
    layoutToggleButton.removeEventListener('click', handleLayoutToggle);
  }

  return { unmount };
}
