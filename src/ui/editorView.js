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
//   onPhotoTraceChanged() — fired after a photo trace load/move/scale/opacity
//                            change; main.js debounces the resulting save to
//                            photoTraceStore (a separate debounce from cells,
//                            since it targets a different store).
//   onPhotoTraceRemoved() — fired after Remove Photo; main.js deletes the
//                            persisted record immediately (not debounced).
//   onBeadTypeChanged(beadTypeKey) — fired before a bead-type change's own
//                            regenerateGrid() runs; main.js refreshes
//                            appState.customColors for the new bead type and
//                            this module awaits it so the palette that
//                            regenerateGrid() renders is already correct.
//   onCustomColorAdded({name, hex}) — fired from the palette's "+" tile;
//                            main.js persists and pushes onto appState.customColors.
//   onCustomColorRenamed(id, name) — Manage Colors list rename.
//   onCustomColorDeleted(id)       — Manage Colors list delete.
//   onCustomColorReordered(id, newOrder) — Manage Colors list drag-reorder.
//   onBack()              — fired when "Back to Library" is tapped, after this
//                            module has finished its own cleanup.

import { BEAD_TYPES } from '../palette/beadSpecs.js';
import { resolveSwatchHex } from '../palette/colorLibrary.js';
import { generatePeyoteGrid, peyoteCellAtPointClamped } from '../grid/peyote.js';
import { resizeCanvasForDisplay, drawPeyoteGrid } from '../render/canvasRenderer.js';
import { drawSelectionOverlay } from '../render/selectionOverlay.js';
import { drawPastePreviewOverlay } from '../render/pastePreviewOverlay.js';
import { screenToWorld } from '../render/viewport.js';
import { attachPointerRouter } from '../interaction/pointerRouter.js';
import { formatLength } from '../units/convert.js';
import { pushPatch, undo, redo, canUndo, canRedo, clearHistory } from '../state/historyStore.js';
import { resizeCells, resizeColorEntries } from '../state/resizeGrid.js';
import { materializeColorwayCells, decomposeCellsForSave, pruneColorwaysToShape } from '../state/colorwaySync.js';
import { defaultPhotoPlacement } from '../state/photoTrace.js';
import { orderForInsertAt } from '../state/designOrder.js';
import { generateId } from '../storage/id.js';
import { buildClipboard, applyEraseRegion, applyPaste } from '../tools/cutCopyTool.js';
import { applyMirror } from '../tools/mirrorTool.js';
import { mountPrintView } from './printView.js';
import { promptResizeOptions } from './resizeDialog.js';

const CLEAR_CONFIRM_MESSAGE = 'This pattern has beads placed. Clear them?';
const REMOVE_PHOTO_CONFIRM_MESSAGE = 'Remove the reference photo?';
const DEFAULT_PHOTO_OPACITY_PERCENT = 60;

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
  const toolFillButton = document.getElementById('tool-fill');
  const toolReplaceButton = document.getElementById('tool-replace');
  const toolSelectButton = document.getElementById('tool-select');
  const clearButton = document.getElementById('clear-pattern');
  const panelToggleButton = document.getElementById('panel-toggle');
  const sidePanel = document.getElementById('side-panel');
  const colorPalette = document.getElementById('color-palette');
  const colorPaletteEmptyMessage = document.getElementById('color-palette-empty');
  const colorManageToggleButton = document.getElementById('color-manage-toggle');
  const colorManageList = document.getElementById('color-manage-list');
  const colorPickerInput = document.getElementById('color-picker-input');
  const pendingColorCard = document.getElementById('pending-color-card');
  const pendingColorSwatch = document.getElementById('pending-color-swatch');
  const pendingColorNameInput = document.getElementById('pending-color-name-input');
  const pendingColorCancelButton = document.getElementById('pending-color-cancel');
  const pendingColorAddButton = document.getElementById('pending-color-add');
  const undoButton = document.getElementById('undo-button');
  const redoButton = document.getElementById('redo-button');
  const printExportButton = document.getElementById('print-export');
  const colorwaySelect = document.getElementById('colorway-select');
  const colorwayNewButton = document.getElementById('colorway-new');
  const colorwayRenameButton = document.getElementById('colorway-rename');
  const colorwayDeleteButton = document.getElementById('colorway-delete');
  const selectionCopyButton = document.getElementById('selection-copy');
  const selectionCutButton = document.getElementById('selection-cut');
  const selectionPasteButton = document.getElementById('selection-paste');
  const selectionMirrorHButton = document.getElementById('selection-mirror-h');
  const selectionMirrorVButton = document.getElementById('selection-mirror-v');
  const selectionDeselectButton = document.getElementById('selection-deselect');
  const pasteControlsEl = document.getElementById('paste-controls');
  const pasteModeFrontButton = document.getElementById('paste-mode-front');
  const pasteModeBehindButton = document.getElementById('paste-mode-behind');
  const pasteCancelButton = document.getElementById('paste-cancel');
  const pasteConfirmButton = document.getElementById('paste-confirm');
  const photoTraceFileInput = document.getElementById('photo-trace-file');
  const photoTraceLoadButton = document.getElementById('photo-trace-load');
  const photoTraceOpacityLabel = document.getElementById('photo-trace-opacity-label');
  const photoTraceOpacityInput = document.getElementById('photo-trace-opacity');
  const photoTraceMoveButton = document.getElementById('photo-trace-move');
  const photoTraceRemoveButton = document.getElementById('photo-trace-remove');

  let redrawScheduled = false;
  let lastCssSize = { cssWidth: 0, cssHeight: 0 };
  let manageMode = false; // Manage Colors list vs. swatch grid — ephemeral UI state, not persisted
  let colorDrag = null; // { pointerId, rowEl, colorId } or null, mirrors libraryView.js's drag shape

  function scheduleRedraw() {
    if (redrawScheduled) return;
    redrawScheduled = true;
    requestAnimationFrame(() => {
      redrawScheduled = false;
      render();
    });
  }

  function resolveColor(colorId) {
    return resolveSwatchHex(appState.customColors, colorId);
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
      BEAD_TYPES[appState.beadTypeKey].shape,
      appState.photoTrace
    );
    drawSelectionOverlay(ctx, appState.viewport, appState.gridParams, appState.selection);
    drawPastePreviewOverlay(ctx, appState.viewport, appState.gridParams, appState.clipboard, appState.pastePreview, resolveColor);
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

  // Manage mode and the swatch grid share the same panel real estate — only one
  // is visible at a time (Phase 8 plan's "not two views open at once").
  function updatePaletteSectionVisibility() {
    const hasColors = appState.customColors.length > 0;
    colorPalette.hidden = manageMode;
    colorPaletteEmptyMessage.hidden = manageMode || hasColors;
    colorManageList.hidden = !manageMode;
  }

  function renderColorPalette() {
    const colors = appState.customColors;
    if (colors.length === 0) {
      appState.selectedColorId = null;
    } else if (!colors.some((swatch) => swatch.id === appState.selectedColorId)) {
      appState.selectedColorId = colors[0].id;
    }

    // A <label for="color-picker-input"> rather than a button that calls
    // colorPickerInput.click() — iOS Safari does not reliably open the native
    // color picker from a programmatic .click(), only from a real tap on the
    // input itself or its associated label.
    const addTile = document.createElement('label');
    addTile.htmlFor = 'color-picker-input';
    addTile.className = 'color-swatch-add';
    addTile.title = 'Add color';
    addTile.setAttribute('aria-label', 'Add color');
    addTile.textContent = '+';

    colorPalette.replaceChildren(
      ...colors.map((swatch) => {
        const button = document.createElement('button');
        button.className = 'color-swatch';
        button.type = 'button';
        button.title = swatch.name;
        button.style.background = swatch.hex;
        button.setAttribute('aria-pressed', String(swatch.id === appState.selectedColorId));
        button.addEventListener('click', () => {
          appState.selectedColorId = swatch.id;
          // Draw/erase treat the palette as an implicit "switch to draw and use
          // this color" shortcut (unchanged from Phase 2). Fill/Replace/Select/
          // Paste/Move Photo each have their own reason to keep the palette open
          // without being kicked back to Draw — Replace in particular needs the
          // palette purely as a target-color picker while staying on Replace.
          if (appState.tool === 'draw' || appState.tool === 'erase') {
            appState.tool = 'draw';
          }
          updateToolButtons();
          renderColorPalette();
        });
        return button;
      }),
      addTile
    );
    updatePaletteSectionVisibility();
  }

  function buildColorManageRow(color) {
    const row = document.createElement('li');
    row.className = 'color-manage-row';
    row.dataset.colorId = color.id;

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'color-manage-drag-handle';
    handle.setAttribute('aria-label', 'Reorder');
    handle.textContent = '☰';

    const swatch = document.createElement('span');
    swatch.className = 'color-manage-swatch';
    swatch.style.background = color.hex;

    const name = document.createElement('span');
    name.className = 'color-manage-name';
    name.textContent = color.name;

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'color-manage-action';
    renameButton.setAttribute('aria-label', 'Rename');
    renameButton.textContent = '✎';
    renameButton.addEventListener('click', () => handleColorRename(color.id));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'color-manage-action';
    deleteButton.setAttribute('aria-label', 'Delete');
    deleteButton.textContent = '✖';
    deleteButton.addEventListener('click', () => handleColorDelete(color.id));

    row.append(handle, swatch, name, renameButton, deleteButton);
    return row;
  }

  function renderColorManageList() {
    colorManageList.replaceChildren(...appState.customColors.map(buildColorManageRow));
  }

  function setTool(tool) {
    appState.tool = tool;
    updateToolButtons();
    updatePasteControls();
  }

  function updateToolButtons() {
    toolDrawButton.setAttribute('aria-pressed', String(appState.tool === 'draw'));
    toolEraseButton.setAttribute('aria-pressed', String(appState.tool === 'erase'));
    toolFillButton.setAttribute('aria-pressed', String(appState.tool === 'fill'));
    toolReplaceButton.setAttribute('aria-pressed', String(appState.tool === 'replace'));
    toolSelectButton.setAttribute('aria-pressed', String(appState.tool === 'select'));
    selectionPasteButton.setAttribute('aria-pressed', String(appState.tool === 'paste'));
    photoTraceMoveButton.setAttribute('aria-pressed', String(appState.tool === 'move-photo'));
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

  // Copy/Cut/Mirror-H need only a selection; Mirror-V additionally needs an odd
  // selection height (see the Phase 7 plan's mirror-vertical parity constraint —
  // reversing row order on an even-height selection would land content on the
  // wrong physical stagger, not fixable at integer column resolution); Paste
  // needs a clipboard, independent of any current selection.
  function updateSelectionButtons() {
    const selection = appState.selection;
    const hasSelection = !!selection;
    const heightEven = hasSelection && (selection.rowEnd - selection.rowStart + 1) % 2 === 0;
    selectionCopyButton.disabled = !hasSelection;
    selectionCutButton.disabled = !hasSelection;
    selectionMirrorHButton.disabled = !hasSelection;
    selectionMirrorVButton.disabled = !hasSelection || heightEven;
    selectionMirrorVButton.title = heightEven
      ? 'Mirror Vertical needs an odd-height selection (even heights would land content on the wrong bead stagger)'
      : '';
    selectionPasteButton.disabled = !appState.clipboard;
    selectionDeselectButton.disabled = !hasSelection;
  }

  // Paste-controls (mode toggle + Cancel/Confirm) only make sense while the
  // 'paste' tool is active — every other tool change hides them.
  function updatePasteControls() {
    const active = appState.tool === 'paste';
    pasteControlsEl.hidden = !active;
    pasteModeFrontButton.setAttribute('aria-pressed', String(appState.pasteMode === 'front'));
    pasteModeBehindButton.setAttribute('aria-pressed', String(appState.pasteMode === 'behind'));
    pasteConfirmButton.disabled = !appState.pastePreview;
  }

  // If a selection is currently active, anchor at its own top-left — reproduces
  // the old "paste in place" behavior as the starting position for the common
  // Copy-then-Paste flow. Otherwise (e.g. deselected after copying) default to
  // the cell nearest the viewport's center, so a first-time paste doesn't need
  // to be dragged in from a corner.
  function defaultPasteAnchor() {
    if (appState.selection) {
      return { anchorRow: appState.selection.rowStart, anchorCol: appState.selection.colStart };
    }
    const centerWorld = screenToWorld(lastCssSize.cssWidth / 2, lastCssSize.cssHeight / 2, appState.viewport);
    const hit = peyoteCellAtPointClamped(
      centerWorld.xMm, centerWorld.yMm,
      appState.gridParams.beadWidthMm, appState.gridParams.beadHeightMm,
      appState.gridParams.rows, appState.gridParams.cols
    );
    return { anchorRow: hit.row, anchorCol: hit.col };
  }

  function updatePhotoTraceControls() {
    const hasPhoto = !!appState.photoTrace;
    photoTraceOpacityLabel.hidden = !hasPhoto;
    photoTraceMoveButton.hidden = !hasPhoto;
    photoTraceRemoveButton.hidden = !hasPhoto;
    if (hasPhoto) photoTraceOpacityInput.value = String(appState.photoTrace.opacityPercent);
    if (!hasPhoto && appState.tool === 'move-photo') setTool('draw');
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
    hidePendingColorCard();
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
    appState.selection = null; // coordinates are meaningless against the new geometry
    appState.pastePreview = null; // coordinates meaningless against the new geometry
    if (appState.tool === 'paste') setTool('draw');
    clearHistory(appState.history);
    updateHistoryButtons();
    updateSelectionButtons();
    updatePasteControls();
    fitViewportToGrid();
    updateSizeReadout();
    hidePendingColorCard();
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
    appState.selection = null; // coordinates are meaningless against the new geometry
    appState.pastePreview = null; // coordinates meaningless against the new geometry
    if (appState.tool === 'paste') setTool('draw');
    rebuildGridParams();
    clearHistory(appState.history); // old patches reference now-invalid coordinates
    updateHistoryButtons();
    updateSelectionButtons();
    updatePasteControls();
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

  async function handleBeadTypeChange() {
    appState.beadTypeKey = beadTypeSelect.value;
    // Custom colors are scoped per bead type — must be refreshed before
    // regenerateGrid() renders the palette, or it'd briefly show the old
    // bead type's colors against the new one.
    await hooks.onBeadTypeChanged(appState.beadTypeKey);
    regenerateGrid();
  }
  function handlePanelToggle() {
    const collapsed = !sidePanel.hidden;
    sidePanel.hidden = collapsed;
    panelToggleButton.setAttribute('aria-pressed', String(!collapsed));
    scheduleRedraw(); // canvas width just changed; resizeCanvasForDisplay must re-run
    hooks.onPreferencesChanged({ panelCollapsed: collapsed });
  }
  function handleColorManageToggle() {
    manageMode = !manageMode;
    colorManageToggleButton.setAttribute('aria-pressed', String(manageMode));
    if (manageMode) renderColorManageList();
    updatePaletteSectionVisibility();
  }
  // iOS Safari's native color picker is its own sheet, separate from the
  // page, and fires `change` continuously while it's open (each drag on the
  // wheel), with no reliable signal for "the user is done": blur only ever
  // fired on the *next* interaction rather than the sheet's actual
  // dismissal, and a debounce guesses wrong whenever the user pauses
  // mid-decision (a real report from on-device testing). So there's no
  // inferred "done" moment at all — `change` just live-updates a pending
  // color preview card, and the user explicitly taps Add (or Cancel)
  // whenever they're actually ready. The confirmation is a real tap, not a
  // timing guess.
  function handleColorPickerChange() {
    pendingColorSwatch.style.background = colorPickerInput.value;
    pendingColorCard.hidden = false;
  }
  function hidePendingColorCard() {
    pendingColorCard.hidden = true;
    pendingColorNameInput.value = '';
  }
  function handlePendingColorAdd() {
    const name = pendingColorNameInput.value.trim();
    if (!name) {
      pendingColorNameInput.focus();
      return;
    }
    const hex = colorPickerInput.value;
    hooks.onCustomColorAdded({ name, hex }).then(() => {
      renderColorPalette();
      if (manageMode) renderColorManageList();
    });
    hidePendingColorCard();
  }
  function handlePendingColorCancel() {
    hidePendingColorCard();
  }
  function handlePendingColorNameKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handlePendingColorAdd();
    }
  }
  function handleColorRename(id) {
    const color = appState.customColors.find((c) => c.id === id);
    if (!color) return;
    const newName = window.prompt('Rename color', color.name);
    if (!newName || !newName.trim()) return;
    hooks.onCustomColorRenamed(id, newName.trim()).then(() => {
      renderColorPalette();
      renderColorManageList();
    });
  }
  function handleColorDelete(id) {
    if (!window.confirm('Delete this color? Beads already using it will show as an unmatched placeholder color.')) return;
    hooks.onCustomColorDeleted(id).then(() => {
      renderColorPalette();
      renderColorManageList();
      scheduleRedraw();
    });
  }
  function handleColorListPointerDown(e) {
    const handle = e.target.closest('.color-manage-drag-handle');
    if (!handle) return;
    const rowEl = handle.closest('.color-manage-row');
    if (!rowEl) return;
    colorDrag = { pointerId: e.pointerId, rowEl, colorId: rowEl.dataset.colorId };
    colorManageList.setPointerCapture(e.pointerId);
    rowEl.classList.add('dragging');
  }
  function handleColorListPointerMove(e) {
    if (!colorDrag || e.pointerId !== colorDrag.pointerId) return;
    const siblings = [...colorManageList.querySelectorAll('.color-manage-row')].filter((r) => r !== colorDrag.rowEl);
    const target = siblings.find((sibling) => {
      const rect = sibling.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if (target) colorManageList.insertBefore(colorDrag.rowEl, target);
    else colorManageList.appendChild(colorDrag.rowEl);
  }
  function handleColorListPointerUp(e) {
    if (!colorDrag || e.pointerId !== colorDrag.pointerId) return;
    const { rowEl, colorId } = colorDrag;
    rowEl.classList.remove('dragging');
    if (colorManageList.hasPointerCapture?.(e.pointerId)) colorManageList.releasePointerCapture(e.pointerId);
    colorDrag = null;

    const targetIndex = [...colorManageList.querySelectorAll('.color-manage-row')].indexOf(rowEl);
    const sortedExcludingDragged = appState.customColors.filter((c) => c.id !== colorId);
    const newOrder = orderForInsertAt(sortedExcludingDragged, targetIndex);
    hooks.onCustomColorReordered(colorId, newOrder).then(() => {
      renderColorPalette();
    });
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
    setTool('draw');
  }
  function handleToolErase() {
    setTool('erase');
  }
  function handleToolFill() {
    setTool('fill');
  }
  function handleToolReplace() {
    setTool('replace');
  }
  function handleToolSelect() {
    setTool('select');
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
  function handleCopy() {
    if (!appState.selection) return;
    appState.clipboard = buildClipboard(appState.cells, appState.selection);
    updateSelectionButtons();
  }
  function handleCut() {
    if (!appState.selection) return;
    appState.clipboard = buildClipboard(appState.cells, appState.selection);
    const patch = applyEraseRegion(appState.cells, appState.selection);
    if (patch.length > 0 && pushPatch(appState.history, patch)) updateHistoryButtons();
    updateSelectionButtons();
    scheduleRedraw();
    hooks.onCellsChanged();
  }
  function handleMirror(axis) {
    if (!appState.selection) return;
    const patch = applyMirror(appState.cells, appState.selection, axis);
    if (patch.length > 0 && pushPatch(appState.history, patch)) updateHistoryButtons();
    scheduleRedraw();
    hooks.onCellsChanged();
  }
  function handleMirrorHorizontal() {
    handleMirror('horizontal');
  }
  function handleMirrorVertical() {
    handleMirror('vertical');
  }
  function handleDeselect() {
    if (!appState.selection) return;
    appState.selection = null;
    updateSelectionButtons();
    scheduleRedraw();
  }
  // Clicking Paste opens a pending preview at a sensible default anchor and
  // switches into the 'paste' tool — positioning happens by dragging the ghost
  // (pointerRouter.js's paste-drag interaction), confirmed explicitly via Confirm.
  function handlePasteButtonClick() {
    if (!appState.clipboard) return;
    appState.pastePreview = defaultPasteAnchor();
    setTool('paste');
    scheduleRedraw();
  }
  // Confirm stamps the preview into cells as one undo-able patch, then ends the
  // paste session entirely: clears the preview, clears whatever marquee selection
  // was left over from the original Copy (so its box doesn't linger on screen
  // after the content it described has already been placed), and drops back to
  // Draw. One-and-done — a repeat stamp means clicking Paste again.
  function handlePasteConfirm() {
    if (!appState.pastePreview || !appState.clipboard) return;
    const { anchorRow, anchorCol } = appState.pastePreview;
    const patch = applyPaste(
      appState.cells, appState.clipboard, anchorRow, anchorCol,
      appState.gridParams.rows, appState.gridParams.cols, appState.pasteMode
    );
    if (patch.length > 0 && pushPatch(appState.history, patch)) updateHistoryButtons();
    appState.pastePreview = null;
    appState.selection = null;
    updateSelectionButtons();
    setTool('draw');
    scheduleRedraw();
    if (patch.length > 0) hooks.onCellsChanged();
  }
  function handlePasteCancel() {
    appState.pastePreview = null;
    setTool('draw');
    scheduleRedraw();
  }
  function handlePasteModeChange(mode) {
    appState.pasteMode = mode;
    updatePasteControls();
  }
  function handlePasteModeFrontClick() {
    handlePasteModeChange('front');
  }
  function handlePasteModeBehindClick() {
    handlePasteModeChange('behind');
  }
  function handleKeyDown(e) {
    const isTextInput = document.activeElement?.tagName === 'INPUT';
    if (isTextInput) return;
    if (e.key === 'Escape') {
      // The more specific in-progress action gets cancelled first — same
      // reasoning a text field's own undo already takes precedence over the
      // app's undo shortcut.
      if (appState.pastePreview) handlePasteCancel();
      else handleDeselect();
      return;
    }
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
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
  function handlePhotoTraceLoadClick() {
    photoTraceFileInput.click();
  }
  async function handlePhotoTraceFileChange() {
    const file = photoTraceFileInput.files[0];
    photoTraceFileInput.value = ''; // allow re-selecting the same file later
    if (!file) return;
    const image = await createImageBitmap(file);
    const placement = defaultPhotoPlacement(image.width, image.height, appState.gridParams.boundingBoxMm);
    appState.photoTrace = {
      image,
      blob: file,
      opacityPercent: DEFAULT_PHOTO_OPACITY_PERCENT,
      ...placement,
    };
    updatePhotoTraceControls();
    scheduleRedraw();
    hooks.onPhotoTraceChanged();
  }
  function handlePhotoTraceOpacityInput() {
    if (!appState.photoTrace) return;
    appState.photoTrace.opacityPercent = Number(photoTraceOpacityInput.value);
    scheduleRedraw();
    hooks.onPhotoTraceChanged();
  }
  function handlePhotoTraceMoveToggle() {
    setTool(appState.tool === 'move-photo' ? 'draw' : 'move-photo');
  }
  function handlePhotoTraceRemove() {
    if (!appState.photoTrace) return;
    if (!window.confirm(REMOVE_PHOTO_CONFIRM_MESSAGE)) return;
    appState.photoTrace = null;
    updatePhotoTraceControls();
    scheduleRedraw();
    hooks.onPhotoTraceRemoved();
  }

  // Called by main.js once an async photo-trace load (kicked off on design open)
  // resolves — see main.js's loadPhotoTraceForDesign. Kept out of the initial
  // synchronous mount so opening a design with a multi-MB reference photo doesn't
  // block the editor's first paint on a decode.
  function setPhotoTrace(photoTrace) {
    appState.photoTrace = photoTrace;
    updatePhotoTraceControls();
    scheduleRedraw();
  }

  beadTypeSelect.addEventListener('change', handleBeadTypeChange);
  generateButton.addEventListener('click', handleResizeClick);
  resetViewButton.addEventListener('click', handleResetView);
  unitToggleButton.addEventListener('click', handleUnitToggle);
  toolDrawButton.addEventListener('click', handleToolDraw);
  toolEraseButton.addEventListener('click', handleToolErase);
  toolFillButton.addEventListener('click', handleToolFill);
  toolReplaceButton.addEventListener('click', handleToolReplace);
  toolSelectButton.addEventListener('click', handleToolSelect);
  clearButton.addEventListener('click', handleClear);
  panelToggleButton.addEventListener('click', handlePanelToggle);
  colorManageToggleButton.addEventListener('click', handleColorManageToggle);
  colorPickerInput.addEventListener('change', handleColorPickerChange);
  pendingColorAddButton.addEventListener('click', handlePendingColorAdd);
  pendingColorCancelButton.addEventListener('click', handlePendingColorCancel);
  pendingColorNameInput.addEventListener('keydown', handlePendingColorNameKeydown);
  colorManageList.addEventListener('pointerdown', handleColorListPointerDown);
  colorManageList.addEventListener('pointermove', handleColorListPointerMove);
  colorManageList.addEventListener('pointerup', handleColorListPointerUp);
  colorManageList.addEventListener('pointercancel', handleColorListPointerUp);
  undoButton.addEventListener('click', handleUndo);
  redoButton.addEventListener('click', handleRedo);
  backButton.addEventListener('click', handleBack);
  printExportButton.addEventListener('click', handlePrintExport);
  colorwaySelect.addEventListener('change', handleColorwaySelectChange);
  colorwayNewButton.addEventListener('click', handleColorwayNew);
  colorwayRenameButton.addEventListener('click', handleColorwayRename);
  colorwayDeleteButton.addEventListener('click', handleColorwayDelete);
  selectionCopyButton.addEventListener('click', handleCopy);
  selectionCutButton.addEventListener('click', handleCut);
  selectionPasteButton.addEventListener('click', handlePasteButtonClick);
  selectionMirrorHButton.addEventListener('click', handleMirrorHorizontal);
  selectionMirrorVButton.addEventListener('click', handleMirrorVertical);
  selectionDeselectButton.addEventListener('click', handleDeselect);
  pasteModeFrontButton.addEventListener('click', handlePasteModeFrontClick);
  pasteModeBehindButton.addEventListener('click', handlePasteModeBehindClick);
  pasteCancelButton.addEventListener('click', handlePasteCancel);
  pasteConfirmButton.addEventListener('click', handlePasteConfirm);
  photoTraceLoadButton.addEventListener('click', handlePhotoTraceLoadClick);
  photoTraceFileInput.addEventListener('change', handlePhotoTraceFileChange);
  photoTraceOpacityInput.addEventListener('input', handlePhotoTraceOpacityInput);
  photoTraceMoveButton.addEventListener('click', handlePhotoTraceMoveToggle);
  photoTraceRemoveButton.addEventListener('click', handlePhotoTraceRemove);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', scheduleRedraw);

  const detachPointerRouter = attachPointerRouter(canvas, appState.viewport, {
    getGridParams: () => appState.gridParams,
    getCells: () => appState.cells,
    getTool: () => appState.tool,
    getColorId: () => appState.selectedColorId,
    getClipboard: () => appState.clipboard,
    getPhotoTrace: () => appState.photoTrace,
    getSelection: () => appState.selection,
    onViewportChange: scheduleRedraw,
    onCellsChanged: () => {
      scheduleRedraw();
      hooks.onCellsChanged();
    },
    onStrokeCommitted: (patch) => {
      if (pushPatch(appState.history, patch)) updateHistoryButtons();
    },
    onSelectionChange: (selection) => {
      appState.selection = selection;
      updateSelectionButtons();
      scheduleRedraw();
    },
    onPhotoTraceChange: () => {
      scheduleRedraw();
      hooks.onPhotoTraceChanged();
    },
    onPastePreviewChange: (preview) => {
      appState.pastePreview = preview;
      updatePasteControls();
      scheduleRedraw();
    },
  });

  // Reflect the bead type/rows/cols the opened design already carries, and sync
  // the units toggle's readout — these controls don't fire their own change
  // events just from being set programmatically.
  beadTypeSelect.value = appState.beadTypeKey;
  rowsInput.value = String(appState.rows);
  colsInput.value = String(appState.cols);

  // Set the panel's collapsed state before measuring the canvas below — it
  // changes the canvas's available width, so it must apply first.
  sidePanel.hidden = !!appState.preferences.panelCollapsed;
  panelToggleButton.setAttribute('aria-pressed', String(!sidePanel.hidden));

  // Populate lastCssSize before fitViewportToGrid() divides by its dimensions.
  lastCssSize = resizeCanvasForDisplay(canvas, ctx);
  updateToolButtons();
  updateHistoryButtons();
  updateSelectionButtons();
  updatePasteControls();
  updatePhotoTraceControls();
  deriveGridAndRender();

  function unmount() {
    beadTypeSelect.removeEventListener('change', handleBeadTypeChange);
    generateButton.removeEventListener('click', handleResizeClick);
    resetViewButton.removeEventListener('click', handleResetView);
    unitToggleButton.removeEventListener('click', handleUnitToggle);
    toolDrawButton.removeEventListener('click', handleToolDraw);
    toolEraseButton.removeEventListener('click', handleToolErase);
    toolFillButton.removeEventListener('click', handleToolFill);
    toolReplaceButton.removeEventListener('click', handleToolReplace);
    toolSelectButton.removeEventListener('click', handleToolSelect);
    clearButton.removeEventListener('click', handleClear);
    panelToggleButton.removeEventListener('click', handlePanelToggle);
    colorManageToggleButton.removeEventListener('click', handleColorManageToggle);
    colorPickerInput.removeEventListener('change', handleColorPickerChange);
    pendingColorAddButton.removeEventListener('click', handlePendingColorAdd);
    pendingColorCancelButton.removeEventListener('click', handlePendingColorCancel);
    pendingColorNameInput.removeEventListener('keydown', handlePendingColorNameKeydown);
    colorManageList.removeEventListener('pointerdown', handleColorListPointerDown);
    colorManageList.removeEventListener('pointermove', handleColorListPointerMove);
    colorManageList.removeEventListener('pointerup', handleColorListPointerUp);
    colorManageList.removeEventListener('pointercancel', handleColorListPointerUp);
    undoButton.removeEventListener('click', handleUndo);
    redoButton.removeEventListener('click', handleRedo);
    backButton.removeEventListener('click', handleBack);
    printExportButton.removeEventListener('click', handlePrintExport);
    colorwaySelect.removeEventListener('change', handleColorwaySelectChange);
    colorwayNewButton.removeEventListener('click', handleColorwayNew);
    colorwayRenameButton.removeEventListener('click', handleColorwayRename);
    colorwayDeleteButton.removeEventListener('click', handleColorwayDelete);
    selectionCopyButton.removeEventListener('click', handleCopy);
    selectionCutButton.removeEventListener('click', handleCut);
    selectionPasteButton.removeEventListener('click', handlePasteButtonClick);
    selectionMirrorHButton.removeEventListener('click', handleMirrorHorizontal);
    selectionMirrorVButton.removeEventListener('click', handleMirrorVertical);
    selectionDeselectButton.removeEventListener('click', handleDeselect);
    pasteModeFrontButton.removeEventListener('click', handlePasteModeFrontClick);
    pasteModeBehindButton.removeEventListener('click', handlePasteModeBehindClick);
    pasteCancelButton.removeEventListener('click', handlePasteCancel);
    pasteConfirmButton.removeEventListener('click', handlePasteConfirm);
    photoTraceLoadButton.removeEventListener('click', handlePhotoTraceLoadClick);
    photoTraceFileInput.removeEventListener('change', handlePhotoTraceFileChange);
    photoTraceOpacityInput.removeEventListener('input', handlePhotoTraceOpacityInput);
    photoTraceMoveButton.removeEventListener('click', handlePhotoTraceMoveToggle);
    photoTraceRemoveButton.removeEventListener('click', handlePhotoTraceRemove);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('resize', scheduleRedraw);
    detachPointerRouter();
  }

  return { unmount, setPhotoTrace };
}
