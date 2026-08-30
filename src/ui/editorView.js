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
//   onDesignContentChanged() — fired at every genuine content-mutation site
//                            (regenerate, resize/crop/undo-redo-of-either,
//                            Clear, colorway rename/delete/new) so main.js
//                            knows the next save should bump the design's
//                            updatedAt — opening/closing or reordering a
//                            design never should (see .work/feature-ruler-
//                            rotation-viewmode-datefix-plan.md §4).
//   onPreferencesChanged(patch) — fired when regenerate or the units toggle
//                            should update the global preference defaults.
//   onPhotoTraceChanged() — fired after a photo trace load/move/scale/opacity
//                            change; main.js debounces the resulting save to
//                            photoTraceStore (a separate debounce from cells,
//                            since it targets a different store).
//   onPhotoTraceRemoved() — fired after Remove Photo; main.js deletes the
//                            persisted record immediately (not debounced).
//   onBeadTypeChanged(beadTypeKey) — fired before a bead-type change's own
//                            regenerateGrid() runs (empty-design case only, see
//                            handleBeadTypeChange); main.js refreshes
//                            appState.customColors for the new bead type and
//                            this module awaits it so the palette that
//                            regenerateGrid() renders is already correct.
//   onBeadTypeCreated/onBeadTypeSaved/onBeadTypeDeleted/onBeadTypeReordered —
//                            forwarded straight through to beadCatalogDialog.js;
//                            see that file's own header for their shapes.
//   onRequestBeadTypeConversionData(targetBeadTypeKey) — fired when switching
//                            bead type on a non-empty design; main.js returns
//                            {usedColors, targetColors} for the conversion
//                            mapping dialog (see .work/feature-bead-catalog-and-
//                            conversion-plan.md's Part C).
//   onBeadTypeConvertConfirmed(targetBeadTypeKey, mappings) — fired once the
//                            mapping dialog resolves (or immediately with an
//                            empty array if the design uses no colors); main.js
//                            clones the pattern into a brand-new design under
//                            the target bead type and switches the editor into
//                            it. This module's own mount is torn down by
//                            main.js right after — nothing more happens here.
//   onStitchTypeConvertConfirmed(targetStitchType) — fired once the user
//                            confirms switching a non-empty design's stitch
//                            type; main.js clones the pattern (same bead type/
//                            colors/shape, only geometry changes — no color-
//                            mapping step needed, unlike bead-type conversion)
//                            into a brand-new design under the target stitch
//                            type and switches the editor into it. Same
//                            teardown as onBeadTypeConvertConfirmed above.
//   onCustomColorAdded({name, hex}) — fired from the palette's "+" tile;
//                            main.js persists and pushes onto appState.customColors.
//   onCustomColorRenamed(id, name) — Manage Colors list rename.
//   onCustomColorHexChanged(id, hex) — Manage Colors list color edit.
//   onCustomColorDeleted(id)       — Manage Colors list delete.
//   onCustomColorReordered(id, newOrder) — Manage Colors list drag-reorder.
//   onCustomColorCopiedToBeadType(id, targetBeadTypeKey) — Manage Colors list
//                            "Copy to…" action; main.js copies the color into
//                            the target bead type's own independent palette,
//                            leaving the source color/palette untouched.
//   onBack()              — fired when "Back to Library" is tapped, after this
//                            module has finished its own cleanup.

import { createIcon } from './icons.js';
import { findBeadType } from '../palette/beadSpecs.js';
import { resolveSwatchHex } from '../palette/colorLibrary.js';
import { findPatternsUsingColor } from '../palette/colorUsage.js';
import { resolveGridEngine, stitchTypeLabel } from '../grid/gridEngine.js';
import { resizeCanvasForDisplay, drawGrid } from '../render/canvasRenderer.js';
import { drawSelectionOverlay } from '../render/selectionOverlay.js';
import { drawPastePreviewOverlay } from '../render/pastePreviewOverlay.js';
import { drawRulerTop, drawRulerLeft } from '../render/rulerRenderer.js';
import { screenToWorld } from '../render/viewport.js';
import { attachPointerRouter } from '../interaction/pointerRouter.js';
import { formatLength } from '../units/convert.js';
import { pushPatch, pushGeometryChange, undo, redo, canUndo, canRedo, clearHistory } from '../state/historyStore.js';
import {
  resizeCells, resizeColorEntries, boundingBoxForCells, cropCells, cropColorEntries,
  axisOffset, compensatedStaggerFlipped,
} from '../state/resizeGrid.js';
import { materializeColorwayCells, decomposeCellsForSave, pruneColorwaysToShape } from '../state/colorwaySync.js';
import { defaultPhotoPlacement } from '../state/photoTrace.js';
import { orderForInsertAt } from '../state/designOrder.js';
import { generateId } from '../storage/id.js';
import { buildClipboard, applyEraseRegion, applyPaste } from '../tools/cutCopyTool.js';
import { applyMirror } from '../tools/mirrorTool.js';
import { mountPrintView } from './printView.js';
import { promptResizeOptions } from './resizeDialog.js';
import { mountBeadCatalogDialog } from './beadCatalogDialog.js';
import { promptCopyColorTarget } from './copyColorDialog.js';
import { promptConvertBeadType } from './convertBeadTypeDialog.js';

const CLEAR_CONFIRM_MESSAGE = 'This pattern has beads placed. Clear them?';
const REMOVE_PHOTO_CONFIRM_MESSAGE = 'Remove the reference photo?';
const DEFAULT_PHOTO_OPACITY_PERCENT = 60;
// CSS spec's fixed 96px/inch reference pixel — the only way to render a physical
// "actual size" without a native API for real screen DPI (browsers don't expose
// one). Accurate relative to the pattern's own bead dimensions, not guaranteed
// laser-precise against a tape measure on every device — see the Actual Size
// calibration control, which corrects for that gap per-device.
const CSS_PX_PER_MM = 96 / 25.4;

export function mountEditorView(appState, hooks) {
  const canvas = document.getElementById('pattern-canvas');
  const ctx = canvas.getContext('2d');
  const canvasArea = document.getElementById('canvas-area');
  const rulerTopCanvas = document.getElementById('ruler-top');
  const rulerTopCtx = rulerTopCanvas.getContext('2d');
  const rulerLeftCanvas = document.getElementById('ruler-left');
  const rulerLeftCtx = rulerLeftCanvas.getContext('2d');

  const backButton = document.getElementById('back-to-library');
  const settingsDialog = document.getElementById('settings-dialog');
  const settingsOpenButton = document.getElementById('settings-open');
  const settingsCloseButton = document.getElementById('settings-close');
  const preferencesDialog = document.getElementById('preferences-dialog');
  const preferencesOpenButton = document.getElementById('preferences-open');
  const preferencesCloseButton = document.getElementById('preferences-close');
  const calibrationRangeInput = document.getElementById('calibration-range');
  const calibrationValueLabel = document.getElementById('calibration-value');
  const calibrationSaveButton = document.getElementById('calibration-save');
  const calibrationResetButton = document.getElementById('calibration-reset');
  const beadTypeSelect = document.getElementById('bead-type');
  const beadCatalogManageButton = document.getElementById('bead-catalog-manage-button');
  const stitchTypeSelect = document.getElementById('stitch-type');
  const rowsInput = document.getElementById('rows');
  const colsInput = document.getElementById('cols');
  const generateButton = document.getElementById('generate');
  const cropToDesignButton = document.getElementById('crop-to-design');
  const rulerToggleButton = document.getElementById('ruler-toggle');
  const preferencesUnitToggleButton = document.getElementById('preferences-unit-toggle');
  const outlineToggleButton = document.getElementById('outline-toggle');
  const sizeReadout = document.getElementById('size-readout');
  const resetViewButton = document.getElementById('reset-view');
  const toolDrawButton = document.getElementById('tool-draw');
  const toolEraseButton = document.getElementById('tool-erase');
  const toolFillButton = document.getElementById('tool-fill');
  const toolReplaceButton = document.getElementById('tool-replace');
  const toolEyedropperButton = document.getElementById('tool-eyedropper');
  const toolSelectButton = document.getElementById('tool-select');
  const clearButton = document.getElementById('clear-pattern');
  const panelToggleButton = document.getElementById('panel-toggle');
  const sidePanel = document.getElementById('side-panel');
  const colorPalette = document.getElementById('color-palette');
  const colorPaletteEmptyMessage = document.getElementById('color-palette-empty');
  const colorManageToggleButton = document.getElementById('color-manage-toggle');
  const colorUndoEditButton = document.getElementById('color-undo-edit');
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
  const selectionControlsEl = document.getElementById('selection-controls');
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
  let editingColorId = null; // id of the color whose hex the shared #color-picker-input is currently editing, or null when it's in "add a new color" mode
  let editingColorOriginalHex = null; // hex captured once when an edit session starts, so Undo reverts to the true pre-edit value even if iOS fires several `change` events (one per wheel drag) during a single edit
  let lastColorHexEdit = null; // { id, previousHex } for the single most recent hex edit, or null — a one-level undo, not a stack; cleared by using it, by a design/bead-type switch, or superseded by the next hex edit
  let calibrationFactor = 1; // working value while the Preferences dialog is open — not written to preferences until Save
  let viewModeBeforePreferencesOpen = 'fit'; // restored on Close-without-Save
  let calibrationSavedThisOpen = false; // Save sets this so the 'close' handler below knows not to revert

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
    const bead = findBeadType(appState.beadCatalog, appState.beadTypeKey);
    drawGrid(
      ctx,
      lastCssSize.cssWidth,
      lastCssSize.cssHeight,
      appState.gridParams,
      appState.viewport,
      appState.cells,
      resolveColor,
      appState.photoTrace,
      bead.cornerRadiusFraction ?? 0,
      appState.showBeadOutlines
    );
    drawSelectionOverlay(ctx, appState.viewport, appState.gridParams, appState.selection);
    drawPastePreviewOverlay(ctx, appState.viewport, appState.gridParams, appState.clipboard, appState.pastePreview, resolveColor);
    if (appState.showRuler) {
      const topSize = resizeCanvasForDisplay(rulerTopCanvas, rulerTopCtx);
      drawRulerTop(rulerTopCtx, topSize.cssWidth, topSize.cssHeight, appState.viewport, appState.units);
      const leftSize = resizeCanvasForDisplay(rulerLeftCanvas, rulerLeftCtx);
      drawRulerLeft(rulerLeftCtx, leftSize.cssWidth, leftSize.cssHeight, appState.viewport, appState.units);
    }
  }

  // Centers the grid's bounding box in the canvas at a scale that fits it with
  // margin — used on design open, on regenerate, and on "Reset View" (fit side).
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
    // Every geometry change (regenerate/resize/crop/undo-redo of either) calls
    // this directly rather than through handleResetView, so re-sync viewMode/the
    // button here too — otherwise the button could keep claiming "actual size"
    // while the view it's actually showing is a fresh fit.
    appState.viewMode = 'fit';
    updateResetViewButton();
  }

  // Same centering math as fitViewportToGrid, but scaled to a fixed physical size
  // instead of whatever fits the canvas — corrected by the user's own calibration
  // factor (preferences.actualSizeCalibration, a global multiplier, default 1)
  // unless a working value is passed in while live-calibrating (see
  // handleCalibrationInput). If the pattern is larger than the viewport at this
  // scale, the existing pan/pinch interaction already lets the user scroll
  // around it — no new interaction needed.
  function setViewportToActualSize(factorOverride) {
    const factor = factorOverride ?? appState.preferences.actualSizeCalibration ?? 1;
    const scale = CSS_PX_PER_MM * factor;
    const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
    const paddingXmm = (lastCssSize.cssWidth / scale - widthMm) / 2;
    const paddingYmm = (lastCssSize.cssHeight / scale - heightMm) / 2;
    Object.assign(appState.viewport, {
      scalePxPerMm: scale,
      originXmm: -paddingXmm,
      originYmm: -paddingYmm,
    });
  }

  // Reflects appState.viewMode on the Reset View button — title/label swap to
  // name the *next* state a click will produce (more discoverable than
  // aria-pressed alone), plus aria-pressed for consistency with this app's other
  // toggle buttons.
  function updateResetViewButton() {
    const isActual = appState.viewMode === 'actual';
    resetViewButton.setAttribute('aria-pressed', String(isActual));
    resetViewButton.title = isActual ? 'Fit to View' : 'View Actual Size';
    resetViewButton.setAttribute('aria-label', resetViewButton.title);
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
    addTile.append(createIcon('plus'));
    // Guards against a stale editingColorId left over from a previous edit-color
    // tap whose native picker the user dismissed without actually changing
    // anything — some browsers don't fire `change` on cancel, so it wouldn't
    // otherwise get cleared before the next add.
    addTile.addEventListener('click', () => {
      editingColorId = null;
      editingColorOriginalHex = null;
    });

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
    handle.className = 'icon-btn color-manage-drag-handle';
    handle.setAttribute('aria-label', 'Reorder');
    handle.title = 'Drag to reorder';
    handle.append(createIcon('grip-vertical'));

    const swatch = document.createElement('span');
    swatch.className = 'color-manage-swatch';
    swatch.style.background = color.hex;

    const name = document.createElement('span');
    name.className = 'color-manage-name';
    name.textContent = color.name;

    const main = document.createElement('div');
    main.className = 'color-manage-main';
    main.append(handle, swatch, name);

    // A <label for="color-picker-input"> rather than a button that calls
    // colorPickerInput.click() — same iOS Safari constraint as the palette's "+"
    // add tile above (a programmatic .click() doesn't reliably open the native
    // color picker there). handleColorPickerChange branches on editingColorId to
    // tell this apart from the add flow sharing the same input.
    const editButton = document.createElement('label');
    editButton.htmlFor = 'color-picker-input';
    editButton.className = 'icon-btn color-manage-action';
    editButton.setAttribute('aria-label', 'Edit color');
    editButton.title = 'Edit color';
    editButton.append(createIcon('palette'));
    editButton.addEventListener('click', () => {
      editingColorId = color.id;
      editingColorOriginalHex = color.hex;
      colorPickerInput.value = color.hex;
    });

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'icon-btn color-manage-action';
    copyButton.setAttribute('aria-label', 'Copy to another bead type');
    copyButton.title = 'Copy to another bead type';
    copyButton.append(createIcon('log-in'));
    copyButton.addEventListener('click', () => handleColorCopyTo(color.id));

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'icon-btn color-manage-action';
    renameButton.setAttribute('aria-label', 'Rename');
    renameButton.title = 'Rename';
    renameButton.append(createIcon('pencil'));
    renameButton.addEventListener('click', () => handleColorRename(color.id));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'icon-btn color-manage-action';
    deleteButton.setAttribute('aria-label', 'Delete');
    deleteButton.title = 'Delete';
    deleteButton.append(createIcon('trash-2'));
    deleteButton.addEventListener('click', () => handleColorDelete(color.id));

    const actions = document.createElement('div');
    actions.className = 'color-manage-actions';
    actions.append(editButton, copyButton, renameButton, deleteButton);

    row.append(main, actions);
    return row;
  }

  function renderColorManageList() {
    colorManageList.replaceChildren(...appState.customColors.map(buildColorManageRow));
  }

  function setTool(tool) {
    appState.tool = tool;
    updateToolButtons();
    updateSelectionButtons();
    updatePasteControls();
  }

  function updateToolButtons() {
    toolDrawButton.setAttribute('aria-pressed', String(appState.tool === 'draw'));
    toolEraseButton.setAttribute('aria-pressed', String(appState.tool === 'erase'));
    toolFillButton.setAttribute('aria-pressed', String(appState.tool === 'fill'));
    toolReplaceButton.setAttribute('aria-pressed', String(appState.tool === 'replace'));
    toolEyedropperButton.setAttribute('aria-pressed', String(appState.tool === 'eyedropper'));
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

  // Copy/Cut/Mirror-V need only a selection; Mirror-H additionally needs an odd
  // selection width on a peyote design (see mirrorTool.js's parity constraint —
  // reversing col order on an even-width selection would land content on the
  // wrong physical stagger, not fixable at integer bead resolution, since
  // isRaised's stagger rule depends on col, not row — see peyote.js). Square
  // stitch has no stagger at all, so this restriction doesn't apply there — see
  // .work/feature-square-stitch-plan.md's "Mirror tool constraint". Paste needs
  // a clipboard, independent of any current selection.
  function updateSelectionButtons() {
    // The whole group only makes sense while the Select tool is active —
    // previously it stayed permanently visible (just disabled), matching
    // #paste-controls' own hidden-unless-active convention now instead.
    selectionControlsEl.hidden = appState.tool !== 'select';
    const selection = appState.selection;
    const hasSelection = !!selection;
    const widthEven = hasSelection && (selection.colEnd - selection.colStart + 1) % 2 === 0;
    const blocksEvenWidthMirror = appState.stitchType === 'peyote' && widthEven;
    selectionCopyButton.disabled = !hasSelection;
    selectionCutButton.disabled = !hasSelection;
    selectionMirrorHButton.disabled = !hasSelection || blocksEvenWidthMirror;
    selectionMirrorHButton.title = blocksEvenWidthMirror
      ? 'Mirror Horizontal needs an odd-width selection (even widths would land content on the wrong bead stagger)'
      : '';
    selectionMirrorVButton.disabled = !hasSelection;
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
    const engine = resolveGridEngine(appState.stitchType);
    const hit = engine.cellAtPointClamped(centerWorld.xMm, centerWorld.yMm, appState.gridParams);
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
    const bead = findBeadType(appState.beadCatalog, appState.beadTypeKey);
    const engine = resolveGridEngine(appState.stitchType);
    appState.gridParams = engine.generateGrid({
      rows: appState.rows,
      cols: appState.cols,
      beadWidthMm: bead.widthMm,
      beadHeightMm: bead.heightMm,
    });
    // Neither is part of generateGrid's own signature (it only computes the
    // bounding box) — stashed onto gridParams here purely so every renderer/
    // hit-tester that already reads gridParams can pick them up without a
    // separate parameter of its own.
    appState.gridParams.staggerFlipped = appState.staggerFlipped;
    appState.gridParams.stitchType = appState.stitchType;
  }

  // Draws the grid for the design as currently loaded into appState (rows/cols/
  // beadTypeKey/cells already set by main.js before mount) — no clearing, no
  // confirm. Used once, right after a design opens.
  function deriveGridAndRender() {
    rebuildGridParams();
    fitViewportToGrid();
    updateSizeReadout();
    hidePendingColorCard();
    lastColorHexEdit = null; // a prior design's edit isn't meaningful to revert once we've switched away
    editingColorId = null; // any in-flight edit session belonged to the prior design's palette
    editingColorOriginalHex = null;
    updateColorUndoButton();
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
    lastColorHexEdit = null; // bead type may have changed underneath the edited color's id
    editingColorId = null; // bead type may have changed underneath any in-flight edit session too
    editingColorOriginalHex = null;
    updateColorUndoButton();
    renderColorPalette();
    updateColorwaySelect();
    scheduleRedraw();
    hooks.onPreferencesChanged({
      defaultBeadTypeKey: appState.beadTypeKey,
      defaultRows: appState.rows,
      defaultCols: appState.cols,
    });
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }

  // A resize/crop touches more than cell colors (rows, cols, staggerFlipped, every
  // colorway's colors all move together), so it can't be recorded as a cell-patch
  // array the way a stroke can — captureGeometrySnapshot/commitGeometrySnapshot
  // below deal in whole-state snapshots instead, pushed onto the same undo/redo
  // stack as ordinary strokes via historyStore's pushGeometryChange (see its own
  // comment) so a resize/crop is a normal, undoable step in one linear history —
  // not a wall that discards everything before it, which is what this used to do
  // (clearHistory()) before undo/redo could represent anything but cell patches.
  function captureGeometrySnapshot() {
    return {
      rows: appState.rows,
      cols: appState.cols,
      staggerFlipped: appState.staggerFlipped,
      cellEntries: [...appState.cells.entries()],
      // setCell always creates a fresh {colorId} value rather than mutating one in
      // place (see cellStore.js), so a shallow copy of the entries/colorEntries
      // pairs is enough — no need to also clone each cell's value object.
      colorways: appState.colorways.map((cw) => ({ ...cw, colorEntries: [...cw.colorEntries] })),
    };
  }

  // Commits a geometry snapshot as the design's current state and refreshes every
  // dependent piece of UI — called directly by applyResize/applyCrop below for the
  // "after" state, and later by historyStore's undo/redo (via the apply function
  // passed to pushGeometryChange) to replay either side of the change. Never
  // touches history itself — only the two call sites that decide whether a push is
  // warranted (applyResize/applyCrop) do that.
  function commitGeometrySnapshot(snapshot) {
    appState.rows = snapshot.rows;
    appState.cols = snapshot.cols;
    appState.staggerFlipped = snapshot.staggerFlipped;
    appState.cells = new Map(snapshot.cellEntries);
    appState.colorways = snapshot.colorways.map((cw) => ({ ...cw, colorEntries: [...cw.colorEntries] }));
    appState.selection = null; // coordinates are meaningless against the new geometry
    appState.pastePreview = null; // coordinates meaningless against the new geometry
    if (appState.tool === 'paste') setTool('draw');
    rebuildGridParams();
    updateSelectionButtons();
    updatePasteControls();
    fitViewportToGrid();
    updateSizeReadout();
    renderColorPalette();
    rowsInput.value = String(appState.rows);
    colsInput.value = String(appState.cols);
    scheduleRedraw();
    // Covers applyResize/applyCrop's own "after" apply AND undo/redo replaying
    // either one, since both funnel through this one function — a resize/crop
    // (or undoing/redoing one) is always a genuine content change relative to
    // what's on disk.
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }

  // Applies a resolved rows/cols change: remaps existing cells per the chosen
  // anchors (see resizeGrid.js) instead of discarding them, since — unlike a bead
  // type change — the stitch structure the cells were drawn against still applies,
  // just with a different row/col count.
  function applyResize(newRows, newCols, rowAnchor, colAnchor) {
    const before = captureGeometrySnapshot();

    const newCells = resizeCells(appState.cells, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor);
    // Every colorway's stored colors get the identical anchor offsets applied, not
    // just the active cells Map — otherwise switching to an untouched colorway
    // after a resize would show colors at pre-resize coordinates that no longer
    // line up with the new shape.
    const newColorways = appState.colorways.map((cw) => ({
      ...cw,
      colorEntries: resizeColorEntries(cw.colorEntries, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor),
    }));
    // A col anchor other than 'start' shifts every existing cell's col index —
    // see resizeGrid.js's compensatedStaggerFlipped for why an odd shift needs
    // staggerFlipped toggled to keep pre-existing content's raised/recessed look
    // unchanged. Square stitch has no stagger concept at all, so this is a no-op
    // there regardless.
    const colOffset = axisOffset(appState.cols, newCols, colAnchor);
    const newStaggerFlipped = appState.stitchType === 'peyote'
      ? compensatedStaggerFlipped(appState.staggerFlipped, colOffset)
      : appState.staggerFlipped;

    const after = {
      rows: newRows,
      cols: newCols,
      staggerFlipped: newStaggerFlipped,
      cellEntries: [...newCells.entries()],
      colorways: newColorways.map((cw) => ({ ...cw, colorEntries: [...cw.colorEntries] })),
    };

    commitGeometrySnapshot(after);
    pushGeometryChange(appState.history, before, after, commitGeometrySnapshot);
    updateHistoryButtons();
    hooks.onPreferencesChanged({
      defaultBeadTypeKey: appState.beadTypeKey,
      defaultRows: appState.rows,
      defaultCols: appState.cols,
    });
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

  // Shrinks the grid to the smallest bounding box containing every placed bead,
  // trimming only genuinely empty border rows/cols. Unlike a manual resize this
  // never loses a bead — the box is derived from the beads themselves — so there's
  // nothing to confirm, no anchor to choose, and no resize dialog.
  function applyCrop() {
    const box = boundingBoxForCells(appState.cells);
    if (!box) {
      window.alert('No beads placed yet — nothing to crop to.');
      return;
    }
    if (box.minRow === 0 && box.minCol === 0 && box.rows === appState.rows && box.cols === appState.cols) {
      window.alert('Already cropped tightly to the design.');
      return;
    }

    const before = captureGeometrySnapshot();

    const newCells = cropCells(appState.cells, box);
    // Every colorway's stored colors get the identical crop offset applied, not
    // just the active cells Map — same reasoning as applyResize above.
    const newColorways = appState.colorways.map((cw) => ({
      ...cw,
      colorEntries: cropColorEntries(cw.colorEntries, box),
    }));
    // The crop's own col shift (-box.minCol) is exactly as capable of flipping
    // pre-existing content's raised/recessed look as a resize's col anchor is —
    // see resizeGrid.js's compensatedStaggerFlipped and applyResize above.
    const newStaggerFlipped = appState.stitchType === 'peyote'
      ? compensatedStaggerFlipped(appState.staggerFlipped, box.minCol)
      : appState.staggerFlipped;

    const after = {
      rows: box.rows,
      cols: box.cols,
      staggerFlipped: newStaggerFlipped,
      cellEntries: [...newCells.entries()],
      colorways: newColorways.map((cw) => ({ ...cw, colorEntries: [...cw.colorEntries] })),
    };

    commitGeometrySnapshot(after);
    pushGeometryChange(appState.history, before, after, commitGeometrySnapshot);
    updateHistoryButtons();
    // Deliberately not written back as the new defaultRows/defaultCols preference
    // (unlike applyResize/regenerateGrid) — a crop's size is a byproduct of this
    // one design's content, not a deliberate choice worth seeding future designs
    // with.
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
    // Set before switchColorway() below, which itself only fires
    // onImmediateSave — creating a colorway is a genuine content change, unlike
    // a plain switch between existing ones.
    hooks.onDesignContentChanged();
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
    hooks.onDesignContentChanged();
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
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }

  // Populates the top-bar bead-type <select> from the live catalog — called on
  // mount and again whenever the bead catalog manager mutates it, so a
  // rename/add/delete/reorder is reflected immediately without remounting.
  function renderBeadTypeSelect() {
    beadTypeSelect.replaceChildren(
      ...appState.beadCatalog.map((bead) => {
        const option = document.createElement('option');
        option.value = bead.id;
        option.textContent = bead.name;
        return option;
      })
    );
    beadTypeSelect.value = appState.beadTypeKey;
  }

  // An empty design switches bead type directly (nothing to lose or map colors
  // for). A design with beads placed instead opens the Convert Bead Type flow —
  // clone the pattern into a brand-new design under the target bead type, with
  // used colors resolved per a user-confirmed mapping, leaving the open design
  // completely untouched (see .work/feature-bead-catalog-and-conversion-plan.md's
  // Part C — the user's own suggestion for sidestepping an in-place geometry
  // change's usual "clear undo history" tradeoff).
  async function handleBeadTypeChange() {
    const targetBeadTypeKey = beadTypeSelect.value;
    if (targetBeadTypeKey === appState.beadTypeKey) return;

    if (appState.cells.size === 0) {
      appState.beadTypeKey = targetBeadTypeKey;
      // Custom colors are scoped per bead type — must be refreshed before
      // regenerateGrid() renders the palette, or it'd briefly show the old
      // bead type's colors against the new one.
      await hooks.onBeadTypeChanged(appState.beadTypeKey);
      regenerateGrid();
      return;
    }

    const data = await hooks.onRequestBeadTypeConversionData(targetBeadTypeKey);
    let mappings = [];
    if (data.usedColors.length > 0) {
      const targetBeadType = findBeadType(appState.beadCatalog, targetBeadTypeKey);
      const result = await promptConvertBeadType({
        usedColors: data.usedColors,
        targetColors: data.targetColors,
        targetBeadTypeName: targetBeadType.name,
      });
      if (!result) {
        beadTypeSelect.value = appState.beadTypeKey; // revert the displayed selection
        return;
      }
      mappings = result.mappings;
    }
    await hooks.onBeadTypeConvertConfirmed(targetBeadTypeKey, mappings);
    // main.js unmounts this editor instance and opens the newly created design
    // right after the promise above resolves — nothing left to do here.
  }

  // A design's stitch type is chosen once and is fixed, same "no in-place
  // geometry mutation" rule as bead type (see handleBeadTypeChange above) — but
  // simpler: unlike a bead-type change, the color palette itself never changes
  // (same bead type, same colors, just different geometry), so shapeEntries/
  // colorways carry over completely unchanged and there's no mapping dialog to
  // show, only a plain confirm naming what's about to happen.
  async function handleStitchTypeChange() {
    const targetStitchType = stitchTypeSelect.value;
    if (targetStitchType === appState.stitchType) return;

    if (appState.cells.size === 0) {
      appState.stitchType = targetStitchType;
      rebuildGridParams();
      fitViewportToGrid();
      updateSizeReadout();
      scheduleRedraw();
      hooks.onPreferencesChanged({ defaultStitchType: appState.stitchType });
      hooks.onDesignContentChanged();
      hooks.onImmediateSave();
      return;
    }

    const confirmed = window.confirm(
      `This will create a new pattern using ${stitchTypeLabel(targetStitchType)} instead of ${stitchTypeLabel(appState.stitchType)} — ` +
      'the two use different bead geometry, so a new pattern is created and the original is left untouched.'
    );
    if (!confirmed) {
      stitchTypeSelect.value = appState.stitchType; // revert the displayed selection
      return;
    }
    await hooks.onStitchTypeConvertConfirmed(targetStitchType);
    // main.js unmounts this editor instance and opens the newly created design
    // right after the promise above resolves — nothing left to do here.
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
    if (editingColorId) {
      // Deliberately not cleared here: iOS Safari's color picker sheet fires
      // `change` repeatedly while it's open (once per wheel/slider drag), not
      // once on close (same behavior the comment above documents for the add
      // flow). Clearing editingColorId on the first fire meant every
      // subsequent drag-tick of the *same* edit gesture fell through to the
      // add-new-color branch below, so the intended color's edit converged on
      // whatever the first tick landed on while later ticks spawned a new
      // color instead of continuing to update the original. Left set until
      // the next edit-button or add-tile click explicitly changes it.
      const id = editingColorId;
      const previousHex = editingColorOriginalHex;
      hooks.onCustomColorHexChanged(id, colorPickerInput.value).then(() => {
        // Only the most recently edited color is revertible — a single slot,
        // not a stack, matching the deliberately narrow scope of this undo
        // (just the hex-edit action, not add/rename/delete/reorder too).
        lastColorHexEdit = previousHex !== null ? { id, previousHex } : null;
        updateColorUndoButton();
        renderColorPalette();
        renderColorManageList();
        scheduleRedraw();
      });
      return;
    }
    pendingColorSwatch.style.background = colorPickerInput.value;
    pendingColorCard.hidden = false;
  }
  function updateColorUndoButton() {
    colorUndoEditButton.hidden = !lastColorHexEdit;
  }
  function handleColorUndoEdit() {
    if (!lastColorHexEdit) return;
    const { id, previousHex } = lastColorHexEdit;
    lastColorHexEdit = null;
    updateColorUndoButton();
    hooks.onCustomColorHexChanged(id, previousHex).then(() => {
      renderColorPalette();
      renderColorManageList();
      scheduleRedraw();
    });
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
  // Copies this color into another bead type's own independent palette (Part B
  // of .work/feature-bead-catalog-and-conversion-plan.md) — palettes stay
  // independent per bead type (Phase 8), so this is a real create, not a move;
  // the source color/palette is never touched.
  async function handleColorCopyTo(id) {
    const color = appState.customColors.find((c) => c.id === id);
    if (!color) return;
    if (appState.beadCatalog.length <= 1) {
      window.alert('No other bead types to copy to yet.');
      return;
    }
    const targetBeadTypeKey = await promptCopyColorTarget({
      color, beadCatalog: appState.beadCatalog, currentBeadTypeKey: appState.beadTypeKey,
    });
    if (!targetBeadTypeKey) return;
    await hooks.onCustomColorCopiedToBeadType(id, targetBeadTypeKey);
  }
  function handleColorDelete(id) {
    const usage = findPatternsUsingColor(appState.designs, id, {
      currentDesignId: appState.currentDesignId,
      colorways: appState.colorways,
      activeColorwayId: appState.activeColorwayId,
      cells: appState.cells,
    });
    if (usage.length > 0) {
      const lines = usage.map((u) =>
        u.colorwayNames.length > 1 ? `${u.designName} (${u.colorwayNames.join(', ')})` : u.designName
      );
      window.alert(
        `This color is used in ${usage.length} pattern${usage.length === 1 ? '' : 's'} and can't be deleted:\n\n${lines.join('\n')}`
      );
      return;
    }
    if (!window.confirm('Delete this color?')) return;
    if (lastColorHexEdit && lastColorHexEdit.id === id) {
      lastColorHexEdit = null; // nothing left to revert to once the color itself is gone
      updateColorUndoButton();
    }
    if (editingColorId === id) {
      editingColorId = null; // a stray change event for a now-deleted color would otherwise resurrect it
      editingColorOriginalHex = null;
    }
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
    appState.viewMode = appState.viewMode === 'fit' ? 'actual' : 'fit';
    if (appState.viewMode === 'fit') {
      fitViewportToGrid(); // also re-syncs the button — see its own comment
    } else {
      setViewportToActualSize();
      updateResetViewButton();
    }
    scheduleRedraw();
  }

  function updateCalibrationValueLabel() {
    calibrationValueLabel.textContent = `${calibrationRangeInput.value}%`;
  }

  // Preferences is app-level, not per-design (CLAUDE.md pain point #1 — global
  // toggles belong in one place, not scattered per-design controls). Opening it
  // seeds the calibration slider from whatever's currently saved and, since
  // calibrating only makes sense against a live Actual Size reference, switches
  // into that mode for the duration if the design wasn't already showing it —
  // handlePreferencesDialogClose (below) reverts this on Close-without-Save.
  function handlePreferencesOpen() {
    viewModeBeforePreferencesOpen = appState.viewMode;
    calibrationSavedThisOpen = false;
    calibrationFactor = appState.preferences.actualSizeCalibration ?? 1;
    calibrationRangeInput.value = String(calibrationFactor * 100);
    updateCalibrationValueLabel();
    appState.viewMode = 'actual';
    setViewportToActualSize(calibrationFactor);
    updateResetViewButton();
    scheduleRedraw();
    preferencesDialog.showModal();
  }

  // Live-adjusts as the user drags, so the canvas visibly resizes in real time
  // against their held-up beadwork — mutates appState.viewport only, exactly
  // like panning/zooming already does, not preferences.
  function handleCalibrationInput() {
    calibrationFactor = Number(calibrationRangeInput.value) / 100;
    updateCalibrationValueLabel();
    setViewportToActualSize(calibrationFactor);
    scheduleRedraw();
  }

  // Live-previews the uncalibrated assumption without losing the in-progress
  // adjustment's own working value unless the user separately chooses Save —
  // a plain click of this button never itself writes to preferences.
  function handleCalibrationResetDefault() {
    calibrationFactor = 1;
    calibrationRangeInput.value = '100';
    updateCalibrationValueLabel();
    setViewportToActualSize(calibrationFactor);
    scheduleRedraw();
  }

  // Applies immediately and globally: the next time any design (this one or
  // another) enters Actual Size, it uses the new factor.
  function handleCalibrationSave() {
    hooks.onPreferencesChanged({ actualSizeCalibration: calibrationFactor });
    calibrationSavedThisOpen = true;
    preferencesDialog.close();
  }

  function handlePreferencesClose() {
    preferencesDialog.close();
  }

  // Fires on every way the dialog can close (X button, Escape, or the
  // programmatic .close() calls above) — reverts the live view to whatever was
  // actually on screen/saved before Preferences was opened, unless Save already
  // committed the in-progress adjustment.
  function handlePreferencesDialogClose() {
    if (calibrationSavedThisOpen) return;
    appState.viewMode = viewModeBeforePreferencesOpen;
    if (appState.viewMode === 'fit') {
      fitViewportToGrid(); // also re-syncs the button — see its own comment
    } else {
      setViewportToActualSize();
      updateResetViewButton();
    }
    scheduleRedraw();
  }
  // Names the *next* state a click will produce, same convention as Reset
  // View's title swap — cheaper to read at a glance than a plain on/off label.
  function updateUnitToggleButton() {
    preferencesUnitToggleButton.textContent = appState.units === 'mm' ? 'Switch to Inches' : 'Switch to Millimeters';
  }
  function handleUnitToggle() {
    appState.units = appState.units === 'mm' ? 'in' : 'mm';
    updateSizeReadout();
    updateUnitToggleButton();
    scheduleRedraw(); // the ruler's tick spacing/labels depend on the unit too
    hooks.onPreferencesChanged({ units: appState.units });
  }
  // Ruler visibility is a preference-backed session toggle, same pattern as
  // showBeadOutlines — collapsing/expanding its grid track changes the
  // canvas's available space, so this also needs a redraw (resizeCanvasForDisplay
  // must re-run), same as handlePanelToggle.
  function handleRulerToggle() {
    appState.showRuler = !appState.showRuler;
    canvasArea.classList.toggle('ruler-hidden', !appState.showRuler);
    rulerToggleButton.setAttribute('aria-pressed', String(appState.showRuler));
    scheduleRedraw();
    hooks.onPreferencesChanged({ showRuler: appState.showRuler });
  }
  function handleOutlineToggle() {
    appState.showBeadOutlines = !appState.showBeadOutlines;
    outlineToggleButton.setAttribute('aria-pressed', String(appState.showBeadOutlines));
    scheduleRedraw();
    hooks.onPreferencesChanged({ showBeadOutlines: appState.showBeadOutlines });
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
  function handleToolEyedropper() {
    setTool('eyedropper');
  }
  function handleToolSelect() {
    setTool('select');
  }
  // Fired by pointerRouter.js when the eyedropper tool taps an occupied,
  // color-assigned cell. Guards against a dangling colorId (a cell referencing a
  // since-deleted custom color, rendered on canvas as a red X marker — see the
  // color-deletion-guard feature) — that colorId doesn't correspond to any current
  // swatch, so picking it would select a color the palette can't show as active.
  // Switches back to Draw afterward, matching the standard pick-then-draw
  // eyedropper convention (Photoshop/Procreate's alt-click sample-and-return).
  function handleColorPicked(colorId) {
    if (!appState.customColors.some((color) => color.id === colorId)) return;
    appState.selectedColorId = colorId;
    setTool('draw');
    renderColorPalette();
  }
  function handleClear() {
    if (appState.cells.size === 0) return;
    if (!window.confirm(confirmClearMessage())) return;
    appState.cells.clear();
    appState.colorways = appState.colorways.map((cw) => ({ ...cw, colorEntries: [] }));
    clearHistory(appState.history);
    updateHistoryButtons();
    scheduleRedraw();
    hooks.onDesignContentChanged();
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
  // Bead type/rows/cols/Resize moved off the permanently-visible top bar into
  // this dialog (iPad UX pass, 2026-08-13) — genuinely rare, per-design setup
  // actions, not worth the top-bar space every session. Native <dialog>, same
  // open/close convention as #bead-catalog-dialog (which can itself still be
  // opened from inside this one — separate top-level <dialog>s stack fine).
  function handleSettingsOpen() {
    settingsDialog.showModal();
  }
  function handleSettingsClose() {
    settingsDialog.close();
  }
  function handlePrintExport() {
    mountPrintView(appState, { onPreferencesChanged: hooks.onPreferencesChanged });
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

  // Refreshes the top-bar select after any catalog mutation, and — since the
  // manager can edit the *currently open* design's own bead type without going
  // through handleBeadTypeChange at all — also re-derives gridParams from the
  // (already-updated-in-place) appState.beadCatalog and redraws, so a width/
  // height/corner-roundness edit shows up immediately instead of only after
  // leaving and reopening the design. rebuildGridParams()/scheduleRedraw() run
  // unconditionally (cheap, and needed for a live corner-roundness change too,
  // which doesn't affect boundingBoxMm) but fitViewportToGrid()/
  // updateSizeReadout() only run when the bounding box actually changed size —
  // otherwise every keystroke in the manager (including edits to a bead type
  // that isn't even the open design's own) would reset the canvas's pan/zoom.
  function handleBeadCatalogChanged() {
    renderBeadTypeSelect();
    const previousBoundingBoxMm = appState.gridParams?.boundingBoxMm;
    rebuildGridParams();
    const boundingBoxMm = appState.gridParams.boundingBoxMm;
    if (!previousBoundingBoxMm || previousBoundingBoxMm.widthMm !== boundingBoxMm.widthMm || previousBoundingBoxMm.heightMm !== boundingBoxMm.heightMm) {
      fitViewportToGrid();
      updateSizeReadout();
    }
    scheduleRedraw();
  }

  const beadCatalogDialog = mountBeadCatalogDialog(appState, {
    onBeadTypeCreated: hooks.onBeadTypeCreated,
    onBeadTypeSaved: hooks.onBeadTypeSaved,
    onBeadTypeDeleted: hooks.onBeadTypeDeleted,
    onBeadTypeReordered: hooks.onBeadTypeReordered,
    onCatalogChanged: handleBeadCatalogChanged,
  });
  function handleBeadCatalogManageClick() {
    beadCatalogDialog.open();
  }

  settingsOpenButton.addEventListener('click', handleSettingsOpen);
  settingsCloseButton.addEventListener('click', handleSettingsClose);
  preferencesOpenButton.addEventListener('click', handlePreferencesOpen);
  preferencesCloseButton.addEventListener('click', handlePreferencesClose);
  preferencesDialog.addEventListener('close', handlePreferencesDialogClose);
  calibrationRangeInput.addEventListener('input', handleCalibrationInput);
  calibrationSaveButton.addEventListener('click', handleCalibrationSave);
  calibrationResetButton.addEventListener('click', handleCalibrationResetDefault);
  beadTypeSelect.addEventListener('change', handleBeadTypeChange);
  beadCatalogManageButton.addEventListener('click', handleBeadCatalogManageClick);
  stitchTypeSelect.addEventListener('change', handleStitchTypeChange);
  generateButton.addEventListener('click', handleResizeClick);
  cropToDesignButton.addEventListener('click', applyCrop);
  resetViewButton.addEventListener('click', handleResetView);
  preferencesUnitToggleButton.addEventListener('click', handleUnitToggle);
  rulerToggleButton.addEventListener('click', handleRulerToggle);
  outlineToggleButton.addEventListener('click', handleOutlineToggle);
  toolDrawButton.addEventListener('click', handleToolDraw);
  toolEraseButton.addEventListener('click', handleToolErase);
  toolFillButton.addEventListener('click', handleToolFill);
  toolReplaceButton.addEventListener('click', handleToolReplace);
  toolEyedropperButton.addEventListener('click', handleToolEyedropper);
  toolSelectButton.addEventListener('click', handleToolSelect);
  clearButton.addEventListener('click', handleClear);
  panelToggleButton.addEventListener('click', handlePanelToggle);
  colorManageToggleButton.addEventListener('click', handleColorManageToggle);
  colorUndoEditButton.addEventListener('click', handleColorUndoEdit);
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
    onColorPicked: handleColorPicked,
  });

  // Reflect the bead type/rows/cols the opened design already carries, and sync
  // the units toggle's readout — these controls don't fire their own change
  // events just from being set programmatically.
  renderBeadTypeSelect();
  stitchTypeSelect.value = appState.stitchType;
  rowsInput.value = String(appState.rows);
  colsInput.value = String(appState.cols);

  // Set the panel's collapsed state before measuring the canvas below — it
  // changes the canvas's available width, so it must apply first.
  sidePanel.hidden = !!appState.preferences.panelCollapsed;
  panelToggleButton.setAttribute('aria-pressed', String(!sidePanel.hidden));
  outlineToggleButton.setAttribute('aria-pressed', String(appState.showBeadOutlines));
  // Same reasoning as the panel above — the ruler's grid track changes the
  // canvas's available space, so it must be set before the canvas is measured.
  canvasArea.classList.toggle('ruler-hidden', !appState.showRuler);
  rulerToggleButton.setAttribute('aria-pressed', String(appState.showRuler));
  updateUnitToggleButton();

  // Populate lastCssSize before fitViewportToGrid() divides by its dimensions.
  lastCssSize = resizeCanvasForDisplay(canvas, ctx);
  updateToolButtons();
  updateHistoryButtons();
  updateSelectionButtons();
  updatePasteControls();
  updatePhotoTraceControls();
  deriveGridAndRender();

  function unmount() {
    beadCatalogDialog.unmount();
    settingsOpenButton.removeEventListener('click', handleSettingsOpen);
    settingsCloseButton.removeEventListener('click', handleSettingsClose);
    preferencesOpenButton.removeEventListener('click', handlePreferencesOpen);
    preferencesCloseButton.removeEventListener('click', handlePreferencesClose);
    preferencesDialog.removeEventListener('close', handlePreferencesDialogClose);
    calibrationRangeInput.removeEventListener('input', handleCalibrationInput);
    calibrationSaveButton.removeEventListener('click', handleCalibrationSave);
    calibrationResetButton.removeEventListener('click', handleCalibrationResetDefault);
    beadTypeSelect.removeEventListener('change', handleBeadTypeChange);
    beadCatalogManageButton.removeEventListener('click', handleBeadCatalogManageClick);
    stitchTypeSelect.removeEventListener('change', handleStitchTypeChange);
    generateButton.removeEventListener('click', handleResizeClick);
    cropToDesignButton.removeEventListener('click', applyCrop);
    resetViewButton.removeEventListener('click', handleResetView);
    preferencesUnitToggleButton.removeEventListener('click', handleUnitToggle);
    rulerToggleButton.removeEventListener('click', handleRulerToggle);
    outlineToggleButton.removeEventListener('click', handleOutlineToggle);
    toolDrawButton.removeEventListener('click', handleToolDraw);
    toolEraseButton.removeEventListener('click', handleToolErase);
    toolFillButton.removeEventListener('click', handleToolFill);
    toolReplaceButton.removeEventListener('click', handleToolReplace);
    toolSelectButton.removeEventListener('click', handleToolSelect);
    clearButton.removeEventListener('click', handleClear);
    panelToggleButton.removeEventListener('click', handlePanelToggle);
    colorManageToggleButton.removeEventListener('click', handleColorManageToggle);
    colorUndoEditButton.removeEventListener('click', handleColorUndoEdit);
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
