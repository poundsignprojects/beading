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
import { COLOR_LIBRARIES, UNASSIGNED_SWATCH } from '../palette/colorLibrary.js';
import { generatePeyoteGrid } from '../grid/peyote.js';
import { resizeCanvasForDisplay, drawPeyoteGrid } from '../render/canvasRenderer.js';
import { attachPointerRouter } from '../interaction/pointerRouter.js';
import { formatLength } from '../units/convert.js';
import { pushPatch, undo, redo, canUndo, canRedo, clearHistory } from '../state/historyStore.js';
import { resizeCells, resizeColorEntries } from '../state/resizeGrid.js';
import { materializeColorwayCells, decomposeCellsForSave, pruneColorwaysToShape } from '../state/colorwaySync.js';
import { generateId } from '../storage/id.js';
import { mountPrintView } from './printView.js';
import { promptResizeOptions } from './resizeDialog.js';

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
  const colorwaySelect = document.getElementById('colorway-select');
  const colorwayNewButton = document.getElementById('colorway-new');
  const colorwayRenameButton = document.getElementById('colorway-rename');
  const colorwayDeleteButton = document.getElementById('colorway-delete');

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
    if (colorId === null) return UNASSIGNED_SWATCH.hex;
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

  function updateColorwaySelect() {
    colorwaySelect.replaceChildren(
      ...appState.colorways.map((cw) => {
        const option = document.createElement('option');
        option.value = cw.id;
        option.textContent = cw.name;
        option.selected = cw.id === appState.activeColorwayId;
        return option;
      })
    );
    colorwayDeleteButton.disabled = appState.colorways.length <= 1;
  }

  // Clearing/regenerating wipes every colorway's colors, not just the one visible —
  // say so explicitly when there's more than one to lose (Phase 6 plan), otherwise
  // this is a silent scope change from what "Clear" meant in Phases 2-5.
  function confirmClearMessage() {
    return appState.colorways.length > 1
      ? `This will clear beads across all ${appState.colorways.length} colorways. Continue?`
      : CLEAR_CONFIRM_MESSAGE;
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
    updateColorwaySelect();
    scheduleRedraw();
  }

  // Regenerating changes the grid geometry underneath any existing cell coordinates
  // (partial pattern migration across a geometry change is out of scope), so this
  // always clears cells — guarded by confirm() when there's something to lose,
  // consistent with prior-app pain point #4 (never lose state silently).
  function regenerateGrid() {
    if (appState.cells.size > 0 && !window.confirm(confirmClearMessage())) return;

    appState.rows = Math.max(1, parseInt(rowsInput.value, 10) || 1);
    appState.cols = Math.max(1, parseInt(colsInput.value, 10) || 1);
    rebuildGridParams();
    appState.cells.clear();
    // A geometry change invalidates every colorway's colors, not just the active
    // one — the colorway list itself (names/count) survives, only contents clear.
    appState.colorways = appState.colorways.map((cw) => ({ ...cw, colorEntries: [] }));
    clearHistory(appState.history);
    updateHistoryButtons();
    fitViewportToGrid();
    updateSizeReadout();
    renderColorPalette();
    updateColorwaySelect();
    scheduleRedraw();
    hooks.onPreferencesChanged({
      defaultBeadTypeKey: appState.beadTypeKey,
      defaultRows: appState.rows,
      defaultCols: appState.cols,
    });
    hooks.onImmediateSave();
  }

  // Applies a resolved rows/cols change: remaps existing cells per the chosen
  // anchors (see resizeGrid.js) instead of discarding them, since — unlike a bead
  // type change — the stitch structure the cells were drawn against still applies,
  // just with a different row/col count.
  function applyResize(newRows, newCols, rowAnchor, colAnchor) {
    appState.cells = resizeCells(appState.cells, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor);
    // Every colorway's stored colors get the identical anchor offsets applied, not
    // just the active cells Map — otherwise switching to an untouched colorway
    // after a resize would show colors at pre-resize coordinates that no longer
    // line up with the new shape.
    appState.colorways = appState.colorways.map((cw) => ({
      ...cw,
      colorEntries: resizeColorEntries(cw.colorEntries, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor),
    }));
    appState.rows = newRows;
    appState.cols = newCols;
    rebuildGridParams();
    clearHistory(appState.history); // old patches reference now-invalid coordinates
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

  // Rows/Cols field changes go through here (not regenerateGrid) so existing
  // beads are preserved by default. Only prompts for which side(s) absorb the
  // change — and only requires confirmation — when there's a pattern to lose;
  // an empty design just resizes straight away.
  async function handleResizeClick() {
    const newRows = Math.max(1, parseInt(rowsInput.value, 10) || 1);
    const newCols = Math.max(1, parseInt(colsInput.value, 10) || 1);
    if (newRows === appState.rows && newCols === appState.cols) return;

    if (appState.cells.size === 0) {
      applyResize(newRows, newCols, 'start', 'start');
      return;
    }

    const result = await promptResizeOptions({
      cells: appState.cells,
      oldRows: appState.rows,
      oldCols: appState.cols,
      newRows,
      newCols,
    });
    if (!result) {
      // Cancelled — revert the inputs to the design's actual current size.
      rowsInput.value = String(appState.rows);
      colsInput.value = String(appState.cols);
      return;
    }
    applyResize(newRows, newCols, result.rowAnchor, result.colAnchor);
  }

  // Fold whatever's currently drawn back into the colorway list before leaving it,
  // then materialize the target colorway against the (now up to date) shared
  // shape. No design remount — canvas/tools/palette stay mounted, only
  // cells/history/the select's value change.
  function switchColorway(newColorwayId) {
    if (newColorwayId === appState.activeColorwayId) return;

    const { shapeEntries, colorEntries } = decomposeCellsForSave(appState.cells);
    appState.colorways = pruneColorwaysToShape(appState.colorways, shapeEntries).map((cw) =>
      cw.id === appState.activeColorwayId ? { ...cw, colorEntries, updatedAt: Date.now() } : cw
    );

    const target = appState.colorways.find((cw) => cw.id === newColorwayId);
    appState.cells = materializeColorwayCells(shapeEntries, target.colorEntries);
    appState.activeColorwayId = newColorwayId;

    // Old undo/redo patches' before/after colors belong to the colorway that was
    // just left — a patch's meaning is only valid against the context it was
    // recorded under (same reasoning design switches and resize already apply).
    clearHistory(appState.history);
    updateHistoryButtons();

    updateColorwaySelect();
    scheduleRedraw();
    hooks.onImmediateSave();
  }

  function handleColorwaySelectChange() {
    switchColorway(colorwaySelect.value);
  }

  // Creating a colorway always seeds it as a copy of the currently active
  // colorway's colors (never a blank slate) — so there's no separate "duplicate"
  // action, create is duplicate, scoped to one pattern.
  function handleColorwayNew() {
    const { colorEntries } = decomposeCellsForSave(appState.cells);
    const now = Date.now();
    const newColorway = {
      id: generateId(),
      name: `Colorway ${appState.colorways.length + 1}`,
      colorEntries,
      createdAt: now,
      updatedAt: now,
    };
    appState.colorways = [...appState.colorways, newColorway];
    switchColorway(newColorway.id);
  }

  function handleColorwayRename() {
    const current = appState.colorways.find((cw) => cw.id === appState.activeColorwayId);
    const newName = window.prompt('Rename colorway', current.name);
    if (!newName || !newName.trim()) return;
    appState.colorways = appState.colorways.map((cw) =>
      cw.id === current.id ? { ...cw, name: newName.trim(), updatedAt: Date.now() } : cw
    );
    updateColorwaySelect();
    hooks.onImmediateSave();
  }

  // A design always has at least one colorway; deleting the last one is blocked
  // (button is disabled in that case — see updateColorwaySelect). Deleting the
  // active colorway switches to the first remaining one.
  function handleColorwayDelete() {
    if (appState.colorways.length <= 1) return;
    if (!window.confirm('Delete this colorway? This cannot be undone.')) return;

    const shapeEntries = Array.from(appState.cells.keys());
    appState.colorways = appState.colorways.filter((cw) => cw.id !== appState.activeColorwayId);
    const next = appState.colorways[0];
    appState.cells = materializeColorwayCells(shapeEntries, next.colorEntries);
    appState.activeColorwayId = next.id;

    clearHistory(appState.history);
    updateHistoryButtons();
    updateColorwaySelect();
    scheduleRedraw();
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
    if (!window.confirm(confirmClearMessage())) return;
    appState.cells.clear();
    appState.colorways = appState.colorways.map((cw) => ({ ...cw, colorEntries: [] }));
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
  generateButton.addEventListener('click', handleResizeClick);
  resetViewButton.addEventListener('click', handleResetView);
  unitToggleButton.addEventListener('click', handleUnitToggle);
  toolDrawButton.addEventListener('click', handleToolDraw);
  toolEraseButton.addEventListener('click', handleToolErase);
  clearButton.addEventListener('click', handleClear);
  undoButton.addEventListener('click', handleUndo);
  redoButton.addEventListener('click', handleRedo);
  backButton.addEventListener('click', handleBack);
  printExportButton.addEventListener('click', handlePrintExport);
  colorwaySelect.addEventListener('change', handleColorwaySelectChange);
  colorwayNewButton.addEventListener('click', handleColorwayNew);
  colorwayRenameButton.addEventListener('click', handleColorwayRename);
  colorwayDeleteButton.addEventListener('click', handleColorwayDelete);
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
    generateButton.removeEventListener('click', handleResizeClick);
    resetViewButton.removeEventListener('click', handleResetView);
    unitToggleButton.removeEventListener('click', handleUnitToggle);
    toolDrawButton.removeEventListener('click', handleToolDraw);
    toolEraseButton.removeEventListener('click', handleToolErase);
    clearButton.removeEventListener('click', handleClear);
    undoButton.removeEventListener('click', handleUndo);
    redoButton.removeEventListener('click', handleRedo);
    backButton.removeEventListener('click', handleBack);
    printExportButton.removeEventListener('click', handlePrintExport);
    colorwaySelect.removeEventListener('change', handleColorwaySelectChange);
    colorwayNewButton.removeEventListener('click', handleColorwayNew);
    colorwayRenameButton.removeEventListener('click', handleColorwayRename);
    colorwayDeleteButton.removeEventListener('click', handleColorwayDelete);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('resize', scheduleRedraw);
    detachPointerRouter();
  }

  return { unmount };
}
