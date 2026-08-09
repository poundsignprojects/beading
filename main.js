import { BEAD_TYPES } from './src/palette/beadSpecs.js';
import { generatePeyoteGrid } from './src/grid/peyote.js';
import { resizeCanvasForDisplay, drawPeyoteGrid } from './src/render/canvasRenderer.js';
import { attachPanZoom } from './src/interaction/panZoom.js';
import { formatLength } from './src/units/convert.js';

// Central app state (CLAUDE.md: "one central app-state object; modules read/write
// through defined functions, not by reaching into each other's internals"). Small
// enough to stay inline for Phase 1 — extract to /src/state if it grows in Phase 2.
const appState = {
  beadTypeKey: 'delica11',
  rows: 20,
  cols: 20,
  units: 'mm',
  gridParams: null,
  viewport: { originXmm: 0, originYmm: 0, scalePxPerMm: 10 },
};

const canvas = document.getElementById('pattern-canvas');
const ctx = canvas.getContext('2d');

const beadTypeSelect = document.getElementById('bead-type');
const rowsInput = document.getElementById('rows');
const colsInput = document.getElementById('cols');
const generateButton = document.getElementById('generate');
const unitToggleButton = document.getElementById('unit-toggle');
const sizeReadout = document.getElementById('size-readout');
const resetViewButton = document.getElementById('reset-view');

let redrawScheduled = false;
let lastCssSize = { cssWidth: 0, cssHeight: 0 };

function scheduleRedraw() {
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => {
    redrawScheduled = false;
    render();
  });
}

function render() {
  lastCssSize = resizeCanvasForDisplay(canvas, ctx);
  drawPeyoteGrid(ctx, lastCssSize.cssWidth, lastCssSize.cssHeight, appState.gridParams, appState.viewport);
}

// Centers the grid's bounding box in the canvas at a scale that fits it with margin —
// used on generate and on "Reset View".
function fitViewportToGrid() {
  const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
  const FIT_MARGIN = 0.9;
  const scale = Math.min(lastCssSize.cssWidth / widthMm, lastCssSize.cssHeight / heightMm) * FIT_MARGIN;
  const paddingXmm = (lastCssSize.cssWidth / scale - widthMm) / 2;
  const paddingYmm = (lastCssSize.cssHeight / scale - heightMm) / 2;
  // Mutate in place, don't reassign — attachPanZoom closes over this object by
  // reference, so replacing it would desync interaction from what's rendered.
  Object.assign(appState.viewport, {
    scalePxPerMm: scale,
    originXmm: -paddingXmm,
    originYmm: -paddingYmm,
  });
}

function updateSizeReadout() {
  const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
  const width = formatLength(widthMm, appState.units);
  const height = formatLength(heightMm, appState.units);
  sizeReadout.textContent = `${width} x ${height}`;
}

function regenerateGrid() {
  const bead = BEAD_TYPES[appState.beadTypeKey];
  appState.rows = Math.max(1, parseInt(rowsInput.value, 10) || 1);
  appState.cols = Math.max(1, parseInt(colsInput.value, 10) || 1);
  appState.gridParams = generatePeyoteGrid({
    rows: appState.rows,
    cols: appState.cols,
    beadWidthMm: bead.widthMm,
    beadHeightMm: bead.heightMm,
  });
  fitViewportToGrid();
  updateSizeReadout();
  scheduleRedraw();
}

beadTypeSelect.addEventListener('change', () => {
  appState.beadTypeKey = beadTypeSelect.value;
  regenerateGrid();
});
generateButton.addEventListener('click', regenerateGrid);
resetViewButton.addEventListener('click', () => {
  fitViewportToGrid();
  scheduleRedraw();
});
unitToggleButton.addEventListener('click', () => {
  appState.units = appState.units === 'mm' ? 'in' : 'mm';
  updateSizeReadout();
});

window.addEventListener('resize', scheduleRedraw);

attachPanZoom(canvas, appState.viewport, scheduleRedraw);

// Populate lastCssSize before the first fitViewportToGrid() call inside
// regenerateGrid() — it divides by lastCssSize's dimensions.
lastCssSize = resizeCanvasForDisplay(canvas, ctx);
regenerateGrid();
