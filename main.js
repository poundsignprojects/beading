import { BEAD_TYPES } from './src/palette/beadSpecs.js';
import { COLOR_LIBRARIES } from './src/palette/colorLibrary.js';
import { generatePeyoteGrid } from './src/grid/peyote.js';
import { resizeCanvasForDisplay, drawPeyoteGrid } from './src/render/canvasRenderer.js';
import { attachPointerRouter } from './src/interaction/pointerRouter.js';
import { formatLength } from './src/units/convert.js';
import { createHistory, pushPatch, undo, redo, canUndo, canRedo, clearHistory } from './src/state/historyStore.js';

const CLEAR_CONFIRM_MESSAGE = 'This pattern has beads placed. Clear them?';

// Central app state (CLAUDE.md: "one central app-state object; modules read/write
// through defined functions, not by reaching into each other's internals"). Small
// enough to stay inline for Phase 2 — extract to /src/state if it grows further.
const appState = {
  beadTypeKey: 'delica11',
  rows: 20,
  cols: 20,
  units: 'mm',
  gridParams: null,
  viewport: { originXmm: 0, originYmm: 0, scalePxPerMm: 10 },
  tool: 'draw',
  selectedColorId: COLOR_LIBRARIES.delica11[0].id,
  cells: new Map(), // row,col -> { colorId } — see src/state/cellStore.js
  history: createHistory(),
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
const toolDrawButton = document.getElementById('tool-draw');
const toolEraseButton = document.getElementById('tool-erase');
const clearButton = document.getElementById('clear-pattern');
const colorPalette = document.getElementById('color-palette');
const undoButton = document.getElementById('undo-button');
const redoButton = document.getElementById('redo-button');

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

function resolveColor(colorId) {
  const library = COLOR_LIBRARIES[appState.beadTypeKey];
  return library.find((swatch) => swatch.id === colorId)?.hex ?? '#ff00ff';
}

function render() {
  lastCssSize = resizeCanvasForDisplay(canvas, ctx);
  drawPeyoteGrid(
    ctx,
    lastCssSize.cssWidth,
    lastCssSize.cssHeight,
    appState.gridParams,
    appState.viewport,
    appState.cells,
    resolveColor
  );
}

// Centers the grid's bounding box in the canvas at a scale that fits it with margin —
// used on generate and on "Reset View".
function fitViewportToGrid() {
  const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
  const FIT_MARGIN = 0.9;
  const scale = Math.min(lastCssSize.cssWidth / widthMm, lastCssSize.cssHeight / heightMm) * FIT_MARGIN;
  const paddingXmm = (lastCssSize.cssWidth / scale - widthMm) / 2;
  const paddingYmm = (lastCssSize.cssHeight / scale - heightMm) / 2;
  // Mutate in place, don't reassign — attachPointerRouter closes over this object by
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

function renderColorPalette() {
  const library = COLOR_LIBRARIES[appState.beadTypeKey];
  if (!library.some((swatch) => swatch.id === appState.selectedColorId)) {
    appState.selectedColorId = library[0].id;
  }
  colorPalette.replaceChildren(
    ...library.map((swatch) => {
      const button = document.createElement('button');
      button.className = 'color-swatch';
      button.type = 'button';
      button.title = swatch.name;
      button.style.background = swatch.hex;
      button.setAttribute('aria-pressed', String(swatch.id === appState.selectedColorId));
      button.addEventListener('click', () => {
        appState.selectedColorId = swatch.id;
        appState.tool = 'draw';
        updateToolButtons();
        renderColorPalette();
      });
      return button;
    })
  );
}

function updateToolButtons() {
  toolDrawButton.setAttribute('aria-pressed', String(appState.tool === 'draw'));
  toolEraseButton.setAttribute('aria-pressed', String(appState.tool === 'erase'));
}

function updateHistoryButtons() {
  undoButton.disabled = !canUndo(appState.history);
  redoButton.disabled = !canRedo(appState.history);
}

// Regenerating changes the grid geometry underneath any existing cell coordinates
// (Phase 2 plan: partial pattern migration across a geometry change is out of scope),
// so this always clears cells — guarded by confirm() when there's something to lose,
// consistent with prior-app pain point #4 (never lose state silently).
function regenerateGrid() {
  if (appState.cells.size > 0 && !window.confirm(CLEAR_CONFIRM_MESSAGE)) return;

  const bead = BEAD_TYPES[appState.beadTypeKey];
  appState.rows = Math.max(1, parseInt(rowsInput.value, 10) || 1);
  appState.cols = Math.max(1, parseInt(colsInput.value, 10) || 1);
  appState.gridParams = generatePeyoteGrid({
    rows: appState.rows,
    cols: appState.cols,
    beadWidthMm: bead.widthMm,
    beadHeightMm: bead.heightMm,
  });
  appState.cells.clear();
  clearHistory(appState.history);
  updateHistoryButtons();
  fitViewportToGrid();
  updateSizeReadout();
  renderColorPalette();
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

toolDrawButton.addEventListener('click', () => {
  appState.tool = 'draw';
  updateToolButtons();
});
toolEraseButton.addEventListener('click', () => {
  appState.tool = 'erase';
  updateToolButtons();
});
clearButton.addEventListener('click', () => {
  if (appState.cells.size === 0) return;
  if (!window.confirm(CLEAR_CONFIRM_MESSAGE)) return;
  appState.cells.clear();
  clearHistory(appState.history);
  updateHistoryButtons();
  scheduleRedraw();
});

undoButton.addEventListener('click', () => {
  if (undo(appState.history, appState.cells)) {
    scheduleRedraw();
    updateHistoryButtons();
  }
});
redoButton.addEventListener('click', () => {
  if (redo(appState.history, appState.cells)) {
    scheduleRedraw();
    updateHistoryButtons();
  }
});

window.addEventListener('keydown', (e) => {
  const isTextInput = document.activeElement?.tagName === 'INPUT';
  if (isTextInput || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  const applied = e.shiftKey
    ? redo(appState.history, appState.cells)
    : undo(appState.history, appState.cells);
  if (applied) {
    scheduleRedraw();
    updateHistoryButtons();
  }
});

window.addEventListener('resize', scheduleRedraw);

attachPointerRouter(canvas, appState.viewport, {
  getGridParams: () => appState.gridParams,
  cells: appState.cells,
  getTool: () => appState.tool,
  getColorId: () => appState.selectedColorId,
  onViewportChange: scheduleRedraw,
  onCellsChanged: scheduleRedraw,
  onStrokeCommitted: (patch) => {
    if (pushPatch(appState.history, patch)) updateHistoryButtons();
  },
});

// Populate lastCssSize before the first fitViewportToGrid() call inside
// regenerateGrid() — it divides by lastCssSize's dimensions.
lastCssSize = resizeCanvasForDisplay(canvas, ctx);
updateToolButtons();
updateHistoryButtons();
regenerateGrid();
