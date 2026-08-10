// The canvas/tool/palette/grid wiring that used to live directly in main.js
// (Phases 1–3), lifted into mount()/unmount() so main.js can show/hide it as a
// second design is opened. Talks to the app shell only through injected hooks —
// never touches storage or the library list directly.
//
// hooks:
//   onCellsChanged()      — fired after any draw/erase/undo/redo mutates cells;
//                            main.js debounces the resulting autosave.
//   onImmediateSave()     — fired after a discrete, already-confirmed action
//                            (regenerate, Clear) that should save right away.
//   onPreferencesChanged(patch) — fired when regenerate or the units toggle
//                            should update the global preference defaults.
//   onBack()              — fired when "Back to Library" is tapped, after this
//                            module has finished its own cleanup.

import { BEAD_TYPES } from '../palette/beadSpecs.js';
import { COLOR_LIBRARIES } from '../palette/colorLibrary.js';
import { generatePeyoteGrid } from '../grid/peyote.js';
import { resizeCanvasForDisplay, drawPeyoteGrid } from '../render/canvasRenderer.js';
import { attachPointerRouter } from '../interaction/pointerRouter.js';
import { formatLength } from '../units/convert.js';
import { pushPatch, undo, redo, canUndo, canRedo, clearHistory } from '../state/historyStore.js';
import { mountPrintView } from './printView.js';

const CLEAR_CONFIRM_MESSAGE = 'This pattern has beads placed. Clear them?';

export function mountEditorView(appState, hooks) {
  const canvas = document.getElementById('pattern-canvas');
  const ctx = canvas.getContext('2d');

  const backButton = document.getElementById('back-to-library');
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
  const printExportButton = document.getElementById('print-export');

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
      resolveColor,
      BEAD_TYPES[appState.beadTypeKey].shape
    );
  }

  // Centers the grid's bounding box in the canvas at a scale that fits it with
  // margin — used on design open, on regenerate, and on "Reset View".
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

  function rebuildGridParams() {
    const bead = BEAD_TYPES[appState.beadTypeKey];
    appState.gridParams = generatePeyoteGrid({
      rows: appState.rows,
      cols: appState.cols,
      beadWidthMm: bead.widthMm,
      beadHeightMm: bead.heightMm,
    });
  }

  // Draws the grid for the design as currently loaded into appState (rows/cols/
  // beadTypeKey/cells already set by main.js before mount) — no clearing, no
  // confirm. Used once, right after a design opens.
  function deriveGridAndRender() {
    rebuildGridParams();
    fitViewportToGrid();
    updateSizeReadout();
    renderColorPalette();
    scheduleRedraw();
  }

  // Regenerating changes the grid geometry underneath any existing cell coordinates
  // (partial pattern migration across a geometry change is out of scope), so this
  // always clears cells — guarded by confirm() when there's something to lose,
  // consistent with prior-app pain point #4 (never lose state silently).
  function regenerateGrid() {
    if (appState.cells.size > 0 && !window.confirm(CLEAR_CONFIRM_MESSAGE)) return;

    appState.rows = Math.max(1, parseInt(rowsInput.value, 10) || 1);
    appState.cols = Math.max(1, parseInt(colsInput.value, 10) || 1);
    rebuildGridParams();
    appState.cells.clear();
    clearHistory(appState.history);
    updateHistoryButtons();
    fitViewportToGrid();
    updateSizeReadout();
    renderColorPalette();
    scheduleRedraw();
    hooks.onPreferencesChanged({
      defaultBeadTypeKey: appState.beadTypeKey,
      defaultRows: appState.rows,
      defaultCols: appState.cols,
    });
    hooks.onImmediateSave();
  }

  function handleBeadTypeChange() {
    appState.beadTypeKey = beadTypeSelect.value;
    regenerateGrid();
  }
  function handleResetView() {
    fitViewportToGrid();
    scheduleRedraw();
  }
  function handleUnitToggle() {
    appState.units = appState.units === 'mm' ? 'in' : 'mm';
    updateSizeReadout();
    hooks.onPreferencesChanged({ units: appState.units });
  }
  function handleToolDraw() {
    appState.tool = 'draw';
    updateToolButtons();
  }
  function handleToolErase() {
    appState.tool = 'erase';
    updateToolButtons();
  }
  function handleClear() {
    if (appState.cells.size === 0) return;
    if (!window.confirm(CLEAR_CONFIRM_MESSAGE)) return;
    appState.cells.clear();
    clearHistory(appState.history);
    updateHistoryButtons();
    scheduleRedraw();
    hooks.onImmediateSave();
  }
  function handleUndo() {
    if (undo(appState.history, appState.cells)) {
      scheduleRedraw();
      updateHistoryButtons();
      hooks.onCellsChanged();
    }
  }
  function handleRedo() {
    if (redo(appState.history, appState.cells)) {
      scheduleRedraw();
      updateHistoryButtons();
      hooks.onCellsChanged();
    }
  }
  function handleKeyDown(e) {
    const isTextInput = document.activeElement?.tagName === 'INPUT';
    if (isTextInput || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) handleRedo();
    else handleUndo();
  }
  function handleBack() {
    hooks.onBack();
  }
  function handlePrintExport() {
    mountPrintView(appState);
  }

  beadTypeSelect.addEventListener('change', handleBeadTypeChange);
  generateButton.addEventListener('click', regenerateGrid);
  resetViewButton.addEventListener('click', handleResetView);
  unitToggleButton.addEventListener('click', handleUnitToggle);
  toolDrawButton.addEventListener('click', handleToolDraw);
  toolEraseButton.addEventListener('click', handleToolErase);
  clearButton.addEventListener('click', handleClear);
  undoButton.addEventListener('click', handleUndo);
  redoButton.addEventListener('click', handleRedo);
  backButton.addEventListener('click', handleBack);
  printExportButton.addEventListener('click', handlePrintExport);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', scheduleRedraw);

  const detachPointerRouter = attachPointerRouter(canvas, appState.viewport, {
    getGridParams: () => appState.gridParams,
    getCells: () => appState.cells,
    getTool: () => appState.tool,
    getColorId: () => appState.selectedColorId,
    onViewportChange: scheduleRedraw,
    onCellsChanged: () => {
      scheduleRedraw();
      hooks.onCellsChanged();
    },
    onStrokeCommitted: (patch) => {
      if (pushPatch(appState.history, patch)) updateHistoryButtons();
    },
  });

  // Reflect the bead type/rows/cols the opened design already carries, and sync
  // the units toggle's readout — these controls don't fire their own change
  // events just from being set programmatically.
  beadTypeSelect.value = appState.beadTypeKey;
  rowsInput.value = String(appState.rows);
  colsInput.value = String(appState.cols);

  // Populate lastCssSize before fitViewportToGrid() divides by its dimensions.
  lastCssSize = resizeCanvasForDisplay(canvas, ctx);
  updateToolButtons();
  updateHistoryButtons();
  deriveGridAndRender();

  function unmount() {
    beadTypeSelect.removeEventListener('change', handleBeadTypeChange);
    generateButton.removeEventListener('click', regenerateGrid);
    resetViewButton.removeEventListener('click', handleResetView);
    unitToggleButton.removeEventListener('click', handleUnitToggle);
    toolDrawButton.removeEventListener('click', handleToolDraw);
    toolEraseButton.removeEventListener('click', handleToolErase);
    clearButton.removeEventListener('click', handleClear);
    undoButton.removeEventListener('click', handleUndo);
    redoButton.removeEventListener('click', handleRedo);
    backButton.removeEventListener('click', handleBack);
    printExportButton.removeEventListener('click', handlePrintExport);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('resize', scheduleRedraw);
    detachPointerRouter();
  }

  return { unmount };
}
