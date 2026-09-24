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
//   onPhotoTraceChanged() — fired after a photo trace load/move/scale/rotate/
//                            opacity change; main.js debounces the resulting save to
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
//   onCustomColorAdded({name, hex, alphaPercent, luster}) — fired from the
//                            palette's "+" tile; main.js persists and pushes
//                            onto appState.customColors.
//   onCustomColorRenamed(id, name) — Manage Colors list rename.
//   onCustomColorAppearanceChanged(id, {hex, alphaPercent, luster}) — Manage
//                            Colors list color/opacity/luster edit.
//   onCustomColorDeleted(id)       — Manage Colors list delete.
//   onCustomColorStashChanged(id, stashCount) — Manage Colors list stash-count
//                            edit (beads on hand for that color); null clears
//                            it back to "not tracked" — see stashCheck.js,
//                            used by printView.js to warn when a design needs
//                            more of a color than is on hand.
//   onCustomColorReordered(id, newOrder) — Manage Colors list drag-reorder.
//   onCustomColorCopiedToBeadType(id, targetBeadTypeKey) — Manage Colors list
//                            "Copy to…" action; main.js copies the color into
//                            the target bead type's own independent palette,
//                            leaving the source color/palette untouched.
//   onBack()              — fired when "Back to Library" is tapped, after this
//                            module has finished its own cleanup.

import { createIcon } from './icons.js';
import { findBeadType, beadTypeSelectOptions } from '../palette/beadSpecs.js';
import { resolveSwatchAppearance } from '../palette/colorLibrary.js';
import { alphaOverWhite } from '../palette/colorConversion.js';
import { findPatternsUsingColor } from '../palette/colorUsage.js';
import { resolveGridEngine, stitchTypeLabel } from '../grid/gridEngine.js';
import { colShiftRowDelta, resolveColShift } from '../grid/peyote.js';
import { resizeCanvasForDisplay, drawGrid } from '../render/canvasRenderer.js';
import { renderThumbnailDataUrl } from '../render/thumbnailRenderer.js';
import { drawSelectionOverlay } from '../render/selectionOverlay.js';
import { drawPastePreviewOverlay } from '../render/pastePreviewOverlay.js';
import { drawMovePreviewOverlay } from '../render/movePreviewOverlay.js';
import { drawRulerTop, drawRulerLeft } from '../render/rulerRenderer.js';
import { screenToWorld } from '../render/viewport.js';
import { attachPointerRouter } from '../interaction/pointerRouter.js';
import { formatLength } from '../units/convert.js';
import { createHistory, pushPatch, pushGeometryChange, undo, redo, canUndo, canRedo, clearHistory, peekUndoContext, peekRedoContext } from '../state/historyStore.js';
import {
  resizeCells, resizeKeyList, resizeColorEntries, boundingBoxForCells, cropCells, cropKeyList, cropColorEntries,
  axisOffset, compensatedStaggerFlipped,
} from '../state/resizeGrid.js';
import { rotatedDimensions, rotateCells, rotateKeyList, rotateColorEntries, rotateSelection180 } from '../state/rotateGrid.js';
import { materializeLayerCells, composeVisibleLayers, decomposeCellsForSave } from '../state/colorwaySync.js';
import { defaultPhotoPlacement, PHOTO_ROTATE_STEP_DEG, normalizeRotationDeg } from '../state/photoTrace.js';
import { orderForInsertAt } from '../state/designOrder.js';
import { generateId } from '../storage/id.js';
import { buildClipboard, applyEraseRegion, applyPaste, rotateClipboard } from '../tools/cutCopyTool.js';
import { collectMovingEntries, applyMove } from '../tools/moveTool.js';
import { applyMirror, canMirrorHorizontally } from '../tools/mirrorTool.js';
import { cellKey } from '../state/cellStore.js';
import { mountPrintView } from './printView.js';
import { promptResizeOptions } from './resizeDialog.js';
import { mountBeadCatalogDialog } from './beadCatalogDialog.js';
import { promptCopyColorTarget } from './copyColorDialog.js';
import { promptConvertBeadType } from './convertBeadTypeDialog.js';
import { promptColorPicker } from './colorPickerDialog.js';
import { registerLongPressMenu } from './longPressTooltip.js';
import { openActionMenu } from './actionMenu.js';
import { showToast } from './toast.js';

const CLEAR_CONFIRM_MESSAGE = 'This pattern has beads placed. Clear them?';
const REMOVE_PHOTO_CONFIRM_MESSAGE = 'Remove the reference photo?';
const DEFAULT_PHOTO_OPACITY_PERCENT = 60;
// CSS spec's fixed 96px/inch reference pixel — the only way to render a physical
// "actual size" without a native API for real screen DPI (browsers don't expose
// one). Accurate relative to the pattern's own bead dimensions, not guaranteed
// laser-precise against a tape measure on every device — see the Actual Size
// calibration control, which corrects for that gap per-device.
const CSS_PX_PER_MM = 96 / 25.4;
// Small rail-style thumbnail per colorway row — same idea as the library's own
// per-design thumbnail (thumbnailRenderer.js) but sized for a narrow side-panel
// list rather than a library card.
const COLORWAY_THUMBNAIL_MAX_SIZE_PX = 64;

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
  const canvasBackgroundModeSelect = document.getElementById('canvas-background-mode');
  const canvasBackgroundCustomSwatchButton = document.getElementById('canvas-background-custom-swatch');
  const preferencesPreserveStaggerToggleButton = document.getElementById('preferences-preserve-stagger-toggle');
  const beadTypeSelect = document.getElementById('bead-type');
  const beadCatalogManageButton = document.getElementById('bead-catalog-manage-button');
  const stitchTypeSelect = document.getElementById('stitch-type');
  const dropCountLabel = document.getElementById('settings-drop-count-label');
  const dropCountInput = document.getElementById('drop-count');
  const rowsInput = document.getElementById('rows');
  const colsInput = document.getElementById('cols');
  const generateButton = document.getElementById('generate');
  const cropToDesignButton = document.getElementById('crop-to-design');
  const rulerToggleButton = document.getElementById('ruler-toggle');
  const preferencesUnitToggleButton = document.getElementById('preferences-unit-toggle');
  const outlineToggleButton = document.getElementById('outline-toggle');
  const sizeReadout = document.getElementById('size-readout');
  const scaleReadout = document.getElementById('scale-readout');
  const resetViewButton = document.getElementById('reset-view');
  const rotateCwButton = document.getElementById('rotate-cw');
  const toolDrawButton = document.getElementById('tool-draw');
  const toolEraseButton = document.getElementById('tool-erase');
  const toolFillButton = document.getElementById('tool-fill');
  const toolReplaceButton = document.getElementById('tool-replace');
  const toolEyedropperButton = document.getElementById('tool-eyedropper');
  const toolSelectButton = document.getElementById('tool-select');
  const toolMoveButton = document.getElementById('tool-move');
  const clearButton = document.getElementById('clear-pattern');
  const panelToggleButton = document.getElementById('panel-toggle');
  const sidePanel = document.getElementById('side-panel');
  const colorPalette = document.getElementById('color-palette');
  const colorPaletteEmptyMessage = document.getElementById('color-palette-empty');
  const colorManageToggleButton = document.getElementById('color-manage-toggle');
  const colorManageList = document.getElementById('color-manage-list');
  const undoButton = document.getElementById('undo-button');
  const redoButton = document.getElementById('redo-button');
  const printExportButton = document.getElementById('print-export');
  const colorwayListEl = document.getElementById('colorway-list');
  const colorwayNewButton = document.getElementById('colorway-new');
  const layerListEl = document.getElementById('layer-list');
  const layerNewButton = document.getElementById('layer-new');
  const selectionControlsEl = document.getElementById('selection-controls');
  const selectionCopyButton = document.getElementById('selection-copy');
  const selectionCutButton = document.getElementById('selection-cut');
  const selectionPasteButton = document.getElementById('selection-paste');
  const selectionMirrorButton = document.getElementById('selection-mirror');
  const selectionRotateButton = document.getElementById('selection-rotate');
  const selectionDeselectButton = document.getElementById('selection-deselect');
  const pasteControlsEl = document.getElementById('paste-controls');
  const pasteModeFrontButton = document.getElementById('paste-mode-front');
  const pasteModeBehindButton = document.getElementById('paste-mode-behind');
  const pasteCancelButton = document.getElementById('paste-cancel');
  const pasteConfirmButton = document.getElementById('paste-confirm');
  const moveControlsEl = document.getElementById('move-controls');
  const moveCancelButton = document.getElementById('move-cancel');
  const moveConfirmButton = document.getElementById('move-confirm');
  const photoTraceFileInput = document.getElementById('photo-trace-file');
  const photoTraceLoadButton = document.getElementById('photo-trace-load');
  const photoTraceOpacityLabel = document.getElementById('photo-trace-opacity-label');
  const photoTraceOpacityInput = document.getElementById('photo-trace-opacity');
  const photoTraceMoveButton = document.getElementById('photo-trace-move');
  const photoTraceRotateCcwButton = document.getElementById('photo-trace-rotate-ccw');
  const photoTraceRotateCwButton = document.getElementById('photo-trace-rotate-cw');
  const photoTraceRemoveButton = document.getElementById('photo-trace-remove');

  let redrawScheduled = false;
  let lastCssSize = { cssWidth: 0, cssHeight: 0 };
  let manageMode = false; // Manage Colors list vs. swatch grid — ephemeral UI state, not persisted
  let colorDrag = null; // { pointerId, rowEl, colorId } or null, mirrors libraryView.js's drag shape
  let layerDrag = null; // { pointerId, rowEl, layerId } or null, same drag-reorder shape as colorDrag
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
    return resolveSwatchAppearance(appState.customColors, colorId);
  }

  // Read directly from appState.preferences at render time (no new appState
  // field) — a canvas-only preview toggle, unlike showBeadOutlines, so there's
  // no button-state to keep locally in sync between renders.
  function currentCanvasBackground() {
    return {
      mode: appState.preferences.canvasBackgroundMode ?? 'white',
      hex: appState.preferences.canvasBackgroundHex ?? null,
    };
  }

  // Composites every visible layer (top of stack wins per cell) into one flat
  // cells Map for the active colorway — the one place "as if flattened"
  // happens for display purposes; substitutes the active layer's live,
  // not-yet-saved cells in place of what's actually persisted for it. See
  // .work/feature-layers-plan.md. No caching, recomputed on every call —
  // consistent with this codebase's "no dirty tracking" philosophy elsewhere.
  //
  // While a move preview is active, the moving cells' ORIGINAL positions are
  // punched out of the active layer's contribution here (not just at render
  // time) — appState.cells itself is never touched until Confirm, but the
  // display (and the eyedropper, which also reads through this) should show
  // the content as already "picked up," matching drawMovePreviewOverlay's own
  // ghost at the destination. See handleToolMove/handleMoveConfirm/
  // handleMoveCancel.
  function composedCellsForDisplay() {
    const activeLayerCells = appState.movePreview
      ? cellsWithHolesPunched(appState.cells, appState.movePreview.movingEntries)
      : appState.cells;
    return composeVisibleLayers(appState.layers, {
      overrideLayerId: appState.activeLayerId,
      overrideCells: activeLayerCells,
    });
  }

  function cellsWithHolesPunched(cells, movingEntries) {
    const holeCells = new Map(cells);
    for (const [row, col] of movingEntries) holeCells.delete(cellKey(row, col));
    return holeCells;
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
      composedCellsForDisplay(),
      resolveColor,
      appState.photoTrace,
      bead.cornerRadiusFraction ?? 0,
      appState.showBeadOutlines,
      currentCanvasBackground()
    );
    drawSelectionOverlay(ctx, appState.viewport, appState.gridParams, appState.selection);
    drawPastePreviewOverlay(ctx, appState.viewport, appState.gridParams, appState.clipboard, appState.pastePreview, resolveColor);
    drawMovePreviewOverlay(ctx, appState.viewport, appState.gridParams, appState.movePreview, resolveColor);
    if (appState.showRuler) {
      const topSize = resizeCanvasForDisplay(rulerTopCanvas, rulerTopCtx);
      drawRulerTop(rulerTopCtx, topSize.cssWidth, topSize.cssHeight, appState.viewport, appState.units);
      const leftSize = resizeCanvasForDisplay(rulerLeftCanvas, rulerLeftCtx);
      drawRulerLeft(rulerLeftCtx, leftSize.cssWidth, leftSize.cssHeight, appState.viewport, appState.units);
    }
    updateScaleReadout();
  }

  // The scale fitViewportToGrid would apply, without mutating anything — shared
  // with updateScaleReadout so it can tell whether the live viewport is actually
  // still at the fit scale, not just whether appState.viewMode last said "fit"
  // (which pinch/wheel zoom can drift away from without changing).
  function computeFitScale() {
    const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
    const FIT_MARGIN = 0.9;
    return Math.min(lastCssSize.cssWidth / widthMm, lastCssSize.cssHeight / heightMm) * FIT_MARGIN;
  }

  // The scale setViewportToActualSize would apply for the given (or currently
  // saved) calibration factor — same sharing rationale as computeFitScale.
  function computeActualSizeScale(factorOverride) {
    const factor = factorOverride ?? appState.preferences.actualSizeCalibration ?? 1;
    return CSS_PX_PER_MM * factor;
  }

  // Centers the grid's bounding box in the canvas at a scale that fits it with
  // margin — used on design open, on regenerate, and on "Reset View" (fit side).
  function fitViewportToGrid() {
    const { widthMm, heightMm } = appState.gridParams.boundingBoxMm;
    const scale = computeFitScale();
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
    const scale = computeActualSizeScale(factorOverride);
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

  // Persistent zoom-level indicator, always visible (not just while hovering/pressing
  // Reset View) — the fit-vs-actual-size question this exists to answer needs to be
  // answerable at a glance. The mode label is derived by comparing the viewport's
  // live scalePxPerMm directly against what Fit/Actual Size would currently produce
  // — NOT from appState.viewMode, which only tracks which state Reset View would
  // toggle to next and stays put through a manual pinch/wheel zoom. Without this
  // comparison, zooming away from either reference scale would still show the
  // stale "(Fit)"/"(Actual Size)" label as if nothing had changed. Recomputed every
  // render() frame (not just at the handful of call sites that also call
  // updateSizeReadout()), since manual zoom updates scalePxPerMm without going
  // through fitViewportToGrid/setViewportToActualSize/updateResetViewButton at all.
  const SCALE_MATCH_TOLERANCE = 0.005; // 0.5% relative — floating-point slop, not a real zoom difference
  function updateScaleReadout() {
    const scale = appState.viewport.scalePxPerMm;
    const actualScale = computeActualSizeScale();
    const percent = Math.round((scale / actualScale) * 100);
    let modeLabel = '';
    if (Math.abs(scale - actualScale) / actualScale < SCALE_MATCH_TOLERANCE) {
      modeLabel = ' (Actual Size)';
    } else if (Math.abs(scale - computeFitScale()) / computeFitScale() < SCALE_MATCH_TOLERANCE) {
      modeLabel = ' (Fit)';
    }
    scaleReadout.textContent = `${percent}%${modeLabel}`;
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

    const addTile = document.createElement('button');
    addTile.type = 'button';
    addTile.className = 'color-swatch-add';
    addTile.title = 'Add color';
    addTile.setAttribute('aria-label', 'Add color');
    addTile.append(createIcon('plus'));
    addTile.addEventListener('click', handleAddColorClick);

    colorPalette.replaceChildren(
      ...colors.map((swatch) => {
        const button = document.createElement('button');
        button.className = 'color-swatch';
        button.type = 'button';
        button.title = swatch.name;
        // Pinned to a white backing regardless of the canvas background
        // toggle (see colorConversion.js's alphaOverWhite) — swatches always
        // preview the same way, only the live canvas itself is configurable.
        button.style.backgroundColor = alphaOverWhite(swatch.hex, swatch.alphaPercent);
        button.classList.toggle('swatch-shiny', swatch.luster === 'shiny');
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
    swatch.style.backgroundColor = alphaOverWhite(color.hex, color.alphaPercent);
    swatch.classList.toggle('swatch-shiny', color.luster === 'shiny');

    const name = document.createElement('span');
    name.className = 'color-manage-name';
    name.textContent = color.name;

    const main = document.createElement('div');
    main.className = 'color-manage-main';
    main.append(handle, swatch, name);

    const stashLabel = document.createElement('label');
    stashLabel.className = 'color-manage-stash';
    stashLabel.title = 'Beads on hand for this color — leave blank to skip comparing it against this pattern\'s bead counts when printing';
    stashLabel.append(document.createTextNode('Stash'));
    const stashInput = document.createElement('input');
    stashInput.type = 'number';
    stashInput.min = '0';
    stashInput.step = '1';
    stashInput.placeholder = '—';
    stashInput.value = color.stashCount === null || color.stashCount === undefined ? '' : String(color.stashCount);
    stashInput.setAttribute('aria-label', `Stash count for ${color.name}`);
    stashInput.addEventListener('change', () => handleColorStashChange(color.id, stashInput.value));
    stashLabel.append(stashInput);

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'icon-btn color-manage-action';
    moreButton.setAttribute('aria-label', `More actions for ${color.name}`);
    moreButton.title = 'More actions';
    moreButton.append(createIcon('ellipsis-vertical'));
    moreButton.addEventListener('click', () => openActionMenu(moreButton, [
      { label: 'Edit Color', icon: 'palette', onSelect: () => handleColorEditClick(color.id) },
      { label: 'Copy to Another Bead Type', icon: 'log-in', onSelect: () => handleColorCopyTo(color.id) },
      { label: 'Rename', icon: 'pencil', onSelect: () => handleColorRename(color.id) },
      { label: 'Delete', icon: 'trash-2', destructive: true, onSelect: () => handleColorDelete(color.id) },
    ]));

    const actions = document.createElement('div');
    actions.className = 'color-manage-actions';
    actions.append(moreButton);

    row.append(main, stashLabel, actions);
    return row;
  }

  function renderColorManageList() {
    colorManageList.replaceChildren(...appState.customColors.map(buildColorManageRow));
  }

  // Blank clears back to "not tracked" (null, distinct from 0 — see
  // stashCheck.js). An invalid/non-numeric entry reverts to the color's prior
  // value rather than persisting garbage, same guard beadCatalogDialog.js's
  // numberField uses for its own inline-editable number inputs.
  async function handleColorStashChange(id, rawValue) {
    const color = appState.customColors.find((c) => c.id === id);
    if (!color) return;
    const trimmed = rawValue.trim();
    let stashCount = null;
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      stashCount = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : (color.stashCount ?? null);
    }
    await hooks.onCustomColorStashChanged(id, stashCount);
    renderColorManageList();
  }

  // 'select' plus its three long-press-menu variants (magic wand's two modes,
  // column select) — all reached via #tool-select, all discrete/repeatable
  // (tap again to select something else) rather than switching back to plain
  // 'select' the moment one tap resolves a selection (see onSelectionChange,
  // below, and its own comment for why staying on the same tool matters).
  // Shared by updateToolButtons' aria-pressed condition and
  // updateSelectionButtons' #selection-controls visibility so the two can't
  // drift out of sync with each other.
  function isSelectFamilyTool(tool) {
    return tool === 'select' || tool === 'wand-contiguous' || tool === 'wand-global' || tool === 'col-select';
  }

  // #tool-select's own icon swaps to match whichever select-family variant is
  // actually active — plain marquee select, either magic-wand mode, or column
  // select — so it's visible at a glance which one is armed without needing
  // to reopen the long-press menu or hover for the title text. Reverts to the
  // plain lasso icon both for 'select' itself and for every tool outside the
  // select family (the button's resting icon when nothing select-related is
  // active).
  function selectToolIconName(tool) {
    if (tool === 'wand-contiguous' || tool === 'wand-global') return 'wand-sparkles';
    if (tool === 'col-select') return 'columns-2';
    return 'lasso-select';
  }

  function updateSelectToolIcon() {
    const desired = selectToolIconName(appState.tool);
    if (toolSelectButton.dataset.icon === desired) return;
    toolSelectButton.dataset.icon = desired;
    toolSelectButton.querySelector('.icon')?.remove();
    toolSelectButton.prepend(createIcon(desired));
  }

  // Tools that still have a legitimate use for whatever's currently selected,
  // so switching to them must NOT clear it: the select-family tools themselves
  // (isSelectFamilyTool — switching between e.g. col-select and plain Select
  // is still "staying in selection mode"), Move (reads appState.selection to
  // know what to pick up — see handleToolMove), and Paste (defaultPasteAnchor
  // seeds its starting position from the selection's own top-left). Every
  // other tool (Draw, Erase, Fill, Replace, Eyedropper, Move Photo) has no use
  // for a leftover selection, and leaving it in place was confusing — its
  // marquee overlay kept drawing on top of the canvas while drawing/erasing,
  // even though #selection-controls itself was already correctly hidden.
  function clearsSelectionOnToolSwitch(tool) {
    return !isSelectFamilyTool(tool) && tool !== 'move' && tool !== 'paste';
  }

  function setTool(tool) {
    if (appState.selection && clearsSelectionOnToolSwitch(tool)) {
      appState.selection = null;
      scheduleRedraw();
    }
    appState.tool = tool;
    updateToolButtons();
    updateSelectionButtons();
    updatePasteControls();
    updateMoveControls();
  }

  function updateToolButtons() {
    toolDrawButton.setAttribute('aria-pressed', String(appState.tool === 'draw'));
    toolEraseButton.setAttribute('aria-pressed', String(appState.tool === 'erase'));
    toolFillButton.setAttribute('aria-pressed', String(appState.tool === 'fill'));
    toolReplaceButton.setAttribute('aria-pressed', String(appState.tool === 'replace'));
    toolEyedropperButton.setAttribute('aria-pressed', String(appState.tool === 'eyedropper'));
    toolSelectButton.setAttribute('aria-pressed', String(isSelectFamilyTool(appState.tool)));
    updateSelectToolIcon();
    toolMoveButton.setAttribute('aria-pressed', String(appState.tool === 'move'));
    selectionPasteButton.setAttribute('aria-pressed', String(appState.tool === 'paste'));
    photoTraceMoveButton.setAttribute('aria-pressed', String(appState.tool === 'move-photo'));
  }

  function updateHistoryButtons() {
    undoButton.disabled = !canUndo(appState.history);
    redoButton.disabled = !canRedo(appState.history);
  }

  // Every cell-patch push (draw/erase strokes, cut, mirror, rotate, move, paste)
  // goes through this instead of calling historyStore's pushPatch directly, so
  // every patch is stamped with which layer/colorway it was made on — see
  // switchContext()/handleUndo()/handleRedo() below for why that's needed now
  // that switching layers/colorways is no longer itself an undo step.
  function pushCellPatch(patch) {
    if (patch.length === 0) return false;
    const context = { colorwayId: appState.activeColorwayId, layerId: appState.activeLayerId };
    const pushed = pushPatch(appState.history, patch, context);
    if (pushed) updateHistoryButtons();
    return pushed;
  }

  // Renders one colorway's thumbnail from its own layers, composited exactly
  // like the canvas itself (composeVisibleLayers) — for the currently open
  // colorway, appState.layers/appState.cells substitute the live,
  // not-yet-folded-back edits so the thumbnail never looks stale while
  // drawing; every other colorway renders straight from its own stored data.
  function renderColorwayThumbnail(cw) {
    const bead = findBeadType(appState.beadCatalog, appState.beadTypeKey);
    const layers = cw.id === appState.activeColorwayId ? appState.layers : cw.layers;
    const cells = composeVisibleLayers(layers, cw.id === appState.activeColorwayId
      ? { overrideLayerId: appState.activeLayerId, overrideCells: appState.cells }
      : {});
    return renderThumbnailDataUrl(
      appState.gridParams,
      cells,
      resolveColor,
      COLORWAY_THUMBNAIL_MAX_SIZE_PX,
      bead.cornerRadiusFraction ?? 0
    );
  }

  // A hidden active layer is fully locked for editing — draw/erase/fill/
  // replace/wand/col-select/select/cut/copy/paste/move/mirror/rotate/clear
  // all have no effect while it's off, not just no visible feedback (a prior
  // approach that instead force-rendered a hidden active layer while it was
  // being edited was explicitly reverted per direct user request — editing a
  // hidden layer isn't wanted at all, not just wanted-with-visual-feedback).
  // A dangling activeLayerId (shouldn't happen in practice) fails open rather
  // than silently locking everything.
  function isActiveLayerVisible() {
    const layer = appState.layers.find((l) => l.id === appState.activeLayerId);
    return !layer || layer.visible !== false;
  }

  function showLayerHiddenToast() {
    showToast('This layer is hidden — show it to make changes.');
  }

  // Copy/Cut/Mirror-V need only a selection; Mirror-H additionally needs a
  // selection width that's compatible with the design's dropCount on a peyote
  // design (see mirrorTool.js's canMirrorHorizontally — reversing col order
  // on an unsupported width/dropCount combination would land content on the
  // wrong physical stagger, not fixable at integer bead resolution, since
  // isRaised's stagger rule depends on col, not row — see peyote.js). Square
  // stitch has no stagger at all, so this restriction doesn't apply there — see
  // .work/feature-square-stitch-plan.md's "Mirror tool constraint". Paste needs
  // a clipboard, independent of any current selection.
  function updateSelectionButtons() {
    // The whole group only makes sense while a select-family tool is active —
    // previously it stayed permanently visible (just disabled), matching
    // #paste-controls' own hidden-unless-active convention now instead. Stays
    // visible for the wand/col-select variants too (not just plain 'select'),
    // since a resolved selection from any of them is just as real/actionable
    // as one drawn with a marquee.
    selectionControlsEl.hidden = !isSelectFamilyTool(appState.tool);
    const selection = appState.selection;
    const hasSelection = !!selection;
    // A magic-wand-produced selection (see tools/magicWandTool.js) can be
    // non-contiguous or irregularly shaped within its own bounding box —
    // Mirror is a swap between geometrically-opposite cells, which has no
    // well-defined result when only one side of a pair falls inside the mask
    // (same reasoning .work/feature-lasso-select-plan.md already worked out
    // for a polygon selection). Copy/Cut/Paste/Rotate-90° are unaffected —
    // they already respect selection.mask via cutCopyTool.js.
    const hasMask = hasSelection && !!selection.mask;
    const width = hasSelection ? selection.colEnd - selection.colStart + 1 : 0;
    const blocksMirror = hasMask || (appState.stitchType === 'peyote' && hasSelection && !canMirrorHorizontally(width, appState.dropCount));
    selectionCopyButton.disabled = !hasSelection;
    selectionCutButton.disabled = !hasSelection;
    // Mirror/Rotate stay enabled whenever a selection exists at all — unlike
    // the old separate mirror-h/mirror-v buttons, this one button's default
    // tap (Mirror Horizontal) is blocked individually by handleMirrorDefaultTap
    // (which toasts an explanation instead of silently no-oping), while the
    // long-press/right-click menu still offers Mirror Vertical regardless
    // (rotation has no such restriction at all — see handleSelectionRotate90's
    // own comment: 180° swaps within the same footprint, 90°/270° never try to
    // fit rotated content back into the original footprint in the first place).
    selectionMirrorButton.disabled = !hasSelection;
    selectionMirrorButton.title = hasMask
      ? 'Mirror isn\'t available for this selection\'s shape'
      : blocksMirror
        ? 'Mirror Horizontal needs a selection width compatible with this pattern\'s drop count — long-press or right-click for Mirror Vertical'
        : 'Mirror Horizontal (long-press or right-click for Mirror Vertical)';
    selectionRotateButton.disabled = !hasSelection;
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

  // Move-controls (Cancel/Confirm) mirror paste-controls exactly — visible
  // only while the 'move' tool is active. Confirm stays disabled when
  // appState.movePreview is null (nothing was actually captured to move —
  // e.g. an empty selection or an empty active layer, see handleToolMove),
  // same "nothing to confirm yet" convention as Paste's own Confirm button.
  function updateMoveControls() {
    const active = appState.tool === 'move';
    moveControlsEl.hidden = !active;
    moveConfirmButton.disabled = !appState.movePreview;
  }

  // If a selection is currently active, anchor at its own top-left — reproduces
  // the old "paste in place" behavior as the starting position for the common
  // Copy-then-Paste flow. Otherwise (e.g. deselected after copying) default to
  // the cell nearest the viewport's center, so a first-time paste doesn't need
  // to be dragged in from a corner.
  //
  // Whichever anchor is picked, it's resolved against appState.clipboard's own
  // originCol (the column the content was actually copied FROM, fixed at copy
  // time — see cutCopyTool.js's buildClipboard) rather than assumed correct by
  // default: the active selection at Paste-click time isn't necessarily the
  // same selection the clipboard was copied from (e.g. re-entering Paste after
  // selecting something else), and the viewport-center fallback never is. If
  // that starting point's parity already differs from the true origin, this
  // placement needs compensation from the very first frame, not only once the
  // user starts dragging — otherwise the initial paste can land visibly
  // distorted relative to the source pattern with nothing having been "shifted"
  // yet from the user's own perspective.
  function defaultPasteAnchor() {
    const raw = appState.selection
      ? { anchorRow: appState.selection.rowStart, anchorCol: appState.selection.colStart }
      : (() => {
          const centerWorld = screenToWorld(lastCssSize.cssWidth / 2, lastCssSize.cssHeight / 2, appState.viewport);
          const engine = resolveGridEngine(appState.stitchType);
          const hit = engine.cellAtPointClamped(centerWorld.xMm, centerWorld.yMm, appState.gridParams);
          return { anchorRow: hit.row, anchorCol: hit.col };
        })();
    return { ...raw, ...resolvePasteColFromOrigin(raw.anchorCol) };
  }

  // Mirrors pointerRouter.js's resolvePasteAnchorCol (same compensation rule,
  // same "no known origin yet" fallback for a freshly rotated clipboard), just
  // reading appState directly instead of through hook getters, since this runs
  // outside the pointer-drag path.
  function resolvePasteColFromOrigin(rawCol) {
    const originCol = appState.clipboard?.originCol;
    const preserveOn = appState.preferences.preserveStaggerOnShift !== false;
    if (originCol == null || !preserveOn || appState.gridParams.stitchType === 'square') {
      return { anchorCol: rawCol, needsRowCompensation: false };
    }
    const { deltaCol, needsRowCompensation } = resolveColShift(rawCol - originCol, appState.gridParams.dropCount ?? 1);
    return { anchorCol: originCol + deltaCol, needsRowCompensation };
  }

  function updatePhotoTraceControls() {
    const hasPhoto = !!appState.photoTrace;
    photoTraceOpacityLabel.hidden = !hasPhoto;
    photoTraceMoveButton.hidden = !hasPhoto;
    photoTraceRotateCcwButton.hidden = !hasPhoto;
    photoTraceRotateCwButton.hidden = !hasPhoto;
    photoTraceRemoveButton.hidden = !hasPhoto;
    if (hasPhoto) photoTraceOpacityInput.value = String(appState.photoTrace.opacityPercent);
    if (!hasPhoto && appState.tool === 'move-photo') setTool('draw');
  }

  // Clear only ever affects the active layer within the active colorway (see
  // .work/feature-layers-plan.md's "editing tools stay scoped to the active
  // layer") — and since layers now belong to exactly one colorway (see
  // .work/feature-per-colorway-layers-plan.md), that's genuinely all it
  // touches; no other colorway is affected. Names the active layer when
  // there's more than one on this colorway, since that's the only thing worth
  // disambiguating here.
  function confirmClearLayerMessage() {
    const activeLayer = appState.layers.find((l) => l.id === appState.activeLayerId);
    const layerNote = appState.layers.length > 1 && activeLayer ? ` on layer "${activeLayer.name}"` : '';
    return layerNote ? `This layer has beads placed. Clear them?` : CLEAR_CONFIRM_MESSAGE;
  }

  // Regenerating resets the grid geometry for the WHOLE design — every layer
  // of every colorway, not just the one currently open — so the warning names
  // every colorway that stands to lose content, unlike Clear above.
  function confirmRegenerateMessage() {
    return appState.colorways.length > 1
      ? `This will clear beads across the whole design, including all ${appState.colorways.length} colorways. Continue?`
      : CLEAR_CONFIRM_MESSAGE;
  }

  // True when every layer of every colorway in this design is empty (the
  // active layer's live cells plus every other layer's own stored shape,
  // across every colorway — not just the one currently open) — used in place
  // of a plain appState.cells.size check wherever "is there anything to lose"
  // needs to consider the whole design, since bead-type/stitch-type changes
  // and a full regenerate still apply design-wide even though layers
  // themselves are now scoped per colorway (see .work/feature-per-colorway-
  // layers-plan.md).
  function isDesignEmpty() {
    if (appState.cells.size > 0) return false;
    return appState.colorways.every((cw) => {
      const layers = cw.id === appState.activeColorwayId ? appState.layers : cw.layers;
      return layers.every((layer) =>
        (cw.id === appState.activeColorwayId && layer.id === appState.activeLayerId) || layer.shapeEntries.length === 0
      );
    });
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
    // None of these are part of generateGrid's own signature (it only computes
    // the bounding box) — stashed onto gridParams here purely so every
    // renderer/hit-tester that already reads gridParams can pick them up
    // without a separate parameter of its own.
    appState.gridParams.staggerFlipped = appState.staggerFlipped;
    appState.gridParams.stitchType = appState.stitchType;
    appState.gridParams.dropCount = appState.dropCount;
  }

  // Draws the grid for the design as currently loaded into appState (rows/cols/
  // beadTypeKey/cells already set by main.js before mount) — no clearing, no
  // confirm. Used once, right after a design opens.
  function deriveGridAndRender() {
    rebuildGridParams();
    fitViewportToGrid();
    updateSizeReadout();
    renderColorPalette();
    renderColorwayList();
    renderLayerList();
    scheduleRedraw();
  }

  // Regenerating changes the grid geometry underneath any existing cell coordinates
  // (partial pattern migration across a geometry change is out of scope), so this
  // always clears cells (every layer of every colorway, not just the active one —
  // a raw geometry reset with no anchor-based remapping has nothing meaningful to
  // preserve on any of them) — guarded by confirm() when there's something to
  // lose, consistent with prior-app pain point #4 (never lose state silently).
  function regenerateGrid() {
    if (!isDesignEmpty() && !window.confirm(confirmRegenerateMessage())) return;

    appState.rows = Math.max(1, parseInt(rowsInput.value, 10) || 1);
    appState.cols = Math.max(1, parseInt(colsInput.value, 10) || 1);
    rebuildGridParams();
    appState.cells.clear();
    // A geometry change invalidates every layer's shape/colors across every
    // colorway (layers belong to exactly one colorway each — see .work/
    // feature-per-colorway-layers-plan.md) — the layer/colorway lists
    // themselves (names/count/order) survive, only contents clear.
    appState.colorways = appState.colorways.map((cw) => {
      const layers = cw.id === appState.activeColorwayId ? appState.layers : cw.layers;
      return { ...cw, layers: layers.map((layer) => ({ ...layer, shapeEntries: [], colorEntries: [] })) };
    });
    appState.layers = appState.colorways.find((cw) => cw.id === appState.activeColorwayId).layers;
    appState.selection = null; // coordinates are meaningless against the new geometry
    appState.pastePreview = null; // coordinates meaningless against the new geometry
    appState.movePreview = null; // baseCells/movingEntries coordinates meaningless against the new geometry
    if (appState.tool === 'paste' || appState.tool === 'move') setTool('draw');
    clearHistory(appState.history);
    updateHistoryButtons();
    updateSelectionButtons();
    updatePasteControls();
    updateMoveControls();
    fitViewportToGrid();
    updateSizeReadout();
    renderColorPalette();
    renderColorwayList();
    renderLayerList();
    scheduleRedraw();
    hooks.onPreferencesChanged({
      defaultBeadTypeKey: appState.beadTypeKey,
      defaultRows: appState.rows,
      defaultCols: appState.cols,
    });
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }

  // appState.layers' own entry for the CURRENTLY ACTIVE layer is only ever a
  // stale placeholder in between explicit fold points (switchLayer/
  // switchColorway/persistCurrentDesign etc. are the only things that ever
  // write appState.cells' live content back into it) — every snapshot-taking
  // function below (both the geometry ones and the layer/colorway view ones)
  // needs the CURRENT live cells folded in first, or a snapshot taken right
  // after a draw with no intervening switch would silently omit it from the
  // colorway/layer data it captures (a real bug caught via Playwright, not
  // guessed at — see .work/feature-per-colorway-layers-plan.md).
  function foldedColorways() {
    const { shapeEntries, colorEntries } = decomposeCellsForSave(appState.cells);
    const foldedLayers = appState.layers.map((layer) =>
      layer.id === appState.activeLayerId ? { ...layer, shapeEntries, colorEntries } : layer
    );
    return appState.colorways.map((cw) =>
      cw.id === appState.activeColorwayId ? { ...cw, activeLayerId: appState.activeLayerId, layers: foldedLayers } : cw
    );
  }

  // Deep-copies foldedColorways() (shapeEntries/colorEntries arrays included)
  // so a captured snapshot can never be mutated by a later live edit —
  // setCell always creates a fresh {colorId} value rather than mutating one
  // in place (see cellStore.js), so cloning each layer's entries arrays is
  // enough; no need to also clone each cell's value object.
  function clonedFoldedColorways() {
    return foldedColorways().map((cw) => ({
      ...cw,
      layers: cw.layers.map((l) => ({ ...l, shapeEntries: [...l.shapeEntries], colorEntries: [...l.colorEntries] })),
    }));
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
      cellEntries: [...appState.cells.entries()], // active layer's live cells
      colorways: clonedFoldedColorways(),
    };
  }

  // Commits a geometry snapshot as the design's current state and refreshes every
  // dependent piece of UI — called directly by applyResize/applyCrop/applyRotate
  // below for the "after" state, and later by historyStore's undo/redo (via the
  // apply function passed to pushGeometryChange) to replay either side of the
  // change. Never touches history itself — only the call sites that decide
  // whether a push is warranted do that. appState.activeLayerId/activeColorwayId
  // never change across a resize/crop/rotate (or its undo/redo) — no snapshot
  // field needed for either.
  function commitGeometrySnapshot(snapshot) {
    appState.rows = snapshot.rows;
    appState.cols = snapshot.cols;
    appState.staggerFlipped = snapshot.staggerFlipped;
    appState.cells = new Map(snapshot.cellEntries);
    appState.colorways = snapshot.colorways.map((cw) => ({
      ...cw,
      layers: cw.layers.map((l) => ({ ...l, shapeEntries: [...l.shapeEntries], colorEntries: [...l.colorEntries] })),
    }));
    appState.layers = appState.colorways.find((cw) => cw.id === appState.activeColorwayId).layers;
    appState.selection = null; // coordinates are meaningless against the new geometry
    appState.pastePreview = null; // coordinates meaningless against the new geometry
    appState.movePreview = null; // baseCells/movingEntries coordinates meaningless against the new geometry
    if (appState.tool === 'paste' || appState.tool === 'move') setTool('draw');
    rebuildGridParams();
    updateSelectionButtons();
    updatePasteControls();
    updateMoveControls();
    fitViewportToGrid();
    updateSizeReadout();
    renderColorPalette();
    renderColorwayList();
    renderLayerList();
    rowsInput.value = String(appState.rows);
    colsInput.value = String(appState.cols);
    scheduleRedraw();
    // Covers applyResize/applyCrop/applyRotate's own "after" apply AND undo/redo
    // replaying any of them, since all funnel through this one function — a
    // resize/crop/rotate (or undoing/redoing one) is always a genuine content
    // change relative to what's on disk.
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }

  // Applies remapShape/remapColors (resizeKeyList/resizeColorEntries,
  // cropKeyList/cropColorEntries, or rotateKeyList/rotateColorEntries) to
  // every OTHER layer of every colorway — the active colorway's active layer
  // already has its remapped shape/colors precomputed in newActiveCells (from
  // whichever geometry tool ran). A resize/crop/rotate is a whole-design
  // operation: every colorway shares the same rows/cols grid, only shape/color
  // content differs — so this always touches every colorway's every layer,
  // not just the one currently open (see .work/feature-per-colorway-layers-
  // plan.md).
  function remapAllColorways(newActiveCells, remapShape, remapColors) {
    const { shapeEntries: activeShapeEntries, colorEntries: activeColorEntries } = decomposeCellsForSave(newActiveCells);
    return appState.colorways.map((cw) => {
      const layers = cw.id === appState.activeColorwayId ? appState.layers : cw.layers;
      return {
        ...cw,
        layers: layers.map((layer) => {
          if (cw.id === appState.activeColorwayId && layer.id === appState.activeLayerId) {
            return { ...layer, shapeEntries: activeShapeEntries, colorEntries: activeColorEntries };
          }
          return { ...layer, shapeEntries: remapShape(layer.shapeEntries), colorEntries: remapColors(layer.colorEntries) };
        }),
      };
    });
  }

  // Applies a resolved rows/cols change: remaps existing cells per the chosen
  // anchors (see resizeGrid.js) instead of discarding them, since — unlike a bead
  // type change — the stitch structure the cells were drawn against still applies,
  // just with a different row/col count. Every colorway's every layer gets the
  // identical anchor offsets applied (see remapAllColorways above) — otherwise
  // switching to an untouched layer or colorway after a resize would show
  // content at pre-resize coordinates that no longer line up with the new shape.
  function applyResize(newRows, newCols, rowAnchor, colAnchor) {
    const before = captureGeometrySnapshot();

    const newCells = resizeCells(appState.cells, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor);
    const newColorways = remapAllColorways(
      newCells,
      (shapeEntries) => resizeKeyList(shapeEntries, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor),
      (colorEntries) => resizeColorEntries(colorEntries, appState.rows, appState.cols, newRows, newCols, rowAnchor, colAnchor)
    );
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
      colorways: newColorways,
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

  // Rotates the whole design 90°/270°/180° — reuses the exact same geometry-
  // snapshot undo/redo machinery applyResize/applyCrop already established
  // (rotation is a change of the same *kind*: rows, cols, staggerFlipped, every
  // layer's shape and every colorway's colors all move together), so it slots
  // in with no new undo infrastructure. Unlike a resize, rotation never drops a
  // cell — it's a pure bijection over the whole grid (see rotateGrid.js) — so
  // there's no confirm dialog, the same reasoning applyCrop already uses.
  // staggerFlipped is reset to false rather than compensated for: a rotation is
  // a wholesale new set of coordinates, not a shift, so there's no prior
  // stagger registration to stay continuous with (see rotateGrid.js's header
  // comment).
  function applyRotate(direction) {
    const before = captureGeometrySnapshot();

    const { rows: newRows, cols: newCols } = rotatedDimensions(appState.rows, appState.cols, direction);
    const newCells = rotateCells(appState.cells, appState.rows, appState.cols, direction);
    const newColorways = remapAllColorways(
      newCells,
      (shapeEntries) => rotateKeyList(shapeEntries, appState.rows, appState.cols, direction),
      (colorEntries) => rotateColorEntries(colorEntries, appState.rows, appState.cols, direction)
    );

    const after = {
      rows: newRows,
      cols: newCols,
      staggerFlipped: false,
      cellEntries: [...newCells.entries()],
      colorways: newColorways,
    };

    commitGeometrySnapshot(after);
    pushGeometryChange(appState.history, before, after, commitGeometrySnapshot);
    updateHistoryButtons();
  }
  // Whole-canvas rotation is a single "Rotate 90° CW" button, tapped as many
  // times as needed for 180°/270° — deliberately not three separate buttons
  // (CW/CCW/180°), per direct user feedback that the extra buttons weren't
  // worth the top-bar space next to Reset View for a repeatable action.
  function handleRotateCw() {
    applyRotate('cw');
  }

  // Rows/Cols field changes go through here (not regenerateGrid) so existing
  // beads are preserved by default. Only prompts for which side(s) absorb the
  // change — and only requires confirmation — when there's a pattern to lose;
  // an empty design just resizes straight away.
  async function handleResizeClick() {
    const newRows = Math.max(1, parseInt(rowsInput.value, 10) || 1);
    const newCols = Math.max(1, parseInt(colsInput.value, 10) || 1);
    if (newRows === appState.rows && newCols === appState.cols) return;

    if (isDesignEmpty()) {
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
  // nothing to confirm, no anchor to choose, and no resize dialog. The bounding box
  // is computed from the UNION of every layer of every colorway's occupied cells,
  // visible or not (substituting the active layer's live keys) — a crop is a
  // whole-design geometry operation (every colorway shares the same rows/cols
  // grid), and content on a currently-hidden layer, or on a colorway that isn't
  // even open right now, is still real content this must never silently clip
  // away (see .work/feature-layers-plan.md, .work/feature-per-colorway-layers-
  // plan.md).
  function applyCrop() {
    const activeLayerLiveKeys = Array.from(appState.cells.keys());
    const unionKeys = new Set();
    for (const cw of appState.colorways) {
      const layers = cw.id === appState.activeColorwayId ? appState.layers : cw.layers;
      for (const layer of layers) {
        const keys = (cw.id === appState.activeColorwayId && layer.id === appState.activeLayerId)
          ? activeLayerLiveKeys
          : layer.shapeEntries;
        for (const key of keys) unionKeys.add(key);
      }
    }
    const box = boundingBoxForCells(unionKeys);
    if (!box) {
      showToast('No beads placed yet — nothing to crop to.');
      return;
    }
    if (box.minRow === 0 && box.minCol === 0 && box.rows === appState.rows && box.cols === appState.cols) {
      showToast('Already cropped tightly to the design.');
      return;
    }

    const before = captureGeometrySnapshot();

    const newCells = cropCells(appState.cells, box);
    // Every colorway's every layer gets the identical crop offset applied —
    // same reasoning as applyResize above.
    const newColorways = remapAllColorways(
      newCells,
      (shapeEntries) => cropKeyList(shapeEntries, box),
      (colorEntries) => cropColorEntries(colorEntries, box)
    );
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
      colorways: newColorways,
    };

    commitGeometrySnapshot(after);
    pushGeometryChange(appState.history, before, after, commitGeometrySnapshot);
    updateHistoryButtons();
    // Deliberately not written back as the new defaultRows/defaultCols preference
    // (unlike applyResize/regenerateGrid) — a crop's size is a byproduct of this
    // one design's content, not a deliberate choice worth seeding future designs
    // with.
  }

  // --- Layer/colorway view state, and how it interacts with undo/redo -------
  // Per direct user request: merely SWITCHING which layer/colorway is active is
  // a purely visual action, never itself an undo/redo step — it shouldn't be
  // possible to "undo" back onto a layer/colorway you deliberately navigated
  // away from. CREATING or DELETING a layer/colorway is a real content change
  // and stays undoable, pushed onto the same chronological stack as cell edits
  // and resize/crop/rotate via pushGeometryChange (see historyStore.js's own
  // comment on why interleaving different kinds of entries on one stack still
  // replays in correct chronological order). Undoing/redoing a cell patch (a
  // stroke, cut, mirror, move, paste, ...) still needs to land on whichever
  // layer/colorway it was actually made on, even though getting there is no
  // longer a step of its own — see switchContext() and handleUndo()/
  // handleRedo() below for how that jump happens without being undoable itself.

  // Captures which colorway/layer is active, every colorway's own layers, and
  // the active layer's live cells — a colorway's `activeLayerId` field is
  // stamped from appState.activeLayerId here (switching layers within a
  // colorway doesn't otherwise persist it onto the colorway record until a
  // snapshot like this one is taken).
  function captureViewSnapshot() {
    return {
      activeColorwayId: appState.activeColorwayId,
      activeLayerId: appState.activeLayerId,
      cellEntries: [...appState.cells.entries()],
      colorways: clonedFoldedColorways(),
    };
  }

  // Commits a view snapshot as the design's current state and refreshes every
  // dependent piece of UI — called directly by switchContext (used by
  // switchLayer/switchColorway, and by handleUndo/handleRedo's own context
  // jump) for a plain, non-undoable switch; and by handleLayerNew/
  // handleLayerDelete/handleColorwayNew/handleColorwayDelete for the "after"
  // state of an undoable create/delete, later replayed by historyStore's
  // undo/redo via the apply function passed to pushGeometryChange.
  function commitViewSnapshot(snapshot) {
    // A pending move's baseCells is a live snapshot of whichever layer/
    // colorway was active when the move began — this is the one function
    // every layer/colorway switch, create, and delete (plus undo/redo of any
    // of them, since this is also what pushGeometryChange replays) funnels
    // through to actually reassign appState.cells, so it's the single correct
    // place to catch "the active layer/colorway is about to change out from
    // under a pending move." Discarding it (not silently auto-confirming) —
    // a layer/colorway change isn't something the user should be able to
    // accidentally finalize a move through.
    if (appState.movePreview) {
      appState.movePreview = null;
      if (appState.tool === 'move') setTool('draw');
    }
    appState.colorways = snapshot.colorways.map((cw) => ({
      ...cw,
      layers: cw.layers.map((l) => ({ ...l, shapeEntries: [...l.shapeEntries], colorEntries: [...l.colorEntries] })),
    }));
    appState.activeColorwayId = snapshot.activeColorwayId;
    appState.layers = appState.colorways.find((cw) => cw.id === appState.activeColorwayId).layers;
    appState.activeLayerId = snapshot.activeLayerId;
    appState.cells = new Map(snapshot.cellEntries);
    renderColorwayList();
    renderLayerList();
    scheduleRedraw();
    hooks.onImmediateSave();
  }

  // Switches to a specific (colorwayId, layerId) pair with NO undo/redo entry
  // — a plain visual navigation, never itself undoable (see the section header
  // comment above). Folds the currently active layer's live cells back into
  // its own slot first (foldedColorways()), same as every other view-changing
  // action in this file. Used directly by switchLayer/switchColorway (an
  // explicit click) and by handleUndo/handleRedo (jumping to whichever
  // layer/colorway a patch being undone/redone actually belongs to, without
  // that jump becoming a history entry of its own). No-op if already there.
  function switchContext(newColorwayId, newLayerId) {
    if (newColorwayId === appState.activeColorwayId && newLayerId === appState.activeLayerId) return;

    const updatedColorways = foldedColorways();
    const targetColorway = updatedColorways.find((cw) => cw.id === newColorwayId);
    const targetLayer = targetColorway.layers.find((l) => l.id === newLayerId) ?? targetColorway.layers[0];
    const newCells = materializeLayerCells(targetLayer);

    commitViewSnapshot({
      activeColorwayId: newColorwayId,
      activeLayerId: targetLayer.id,
      cellEntries: [...newCells.entries()],
      colorways: updatedColorways.map((cw) =>
        cw.id === newColorwayId ? { ...cw, activeLayerId: targetLayer.id } : cw
      ),
    });
  }

  // --- Layers (.work/feature-layers-plan.md, .work/feature-per-colorway-
  // layers-plan.md) --------------------------------------------------------
  // A layer belongs to exactly one colorway — its own shapeEntries AND
  // colorEntries both live directly on the layer object.

  function switchLayer(newLayerId) {
    switchContext(appState.activeColorwayId, newLayerId);
  }

  // Deliberately does NOT copy any content — unlike a new colorway (an
  // explicit duplicate of the active one's appearance), a new layer's whole
  // purpose is fresh, empty space to draw on. Scoped only to the colorway
  // currently open — a new layer never appears in any other colorway (see
  // .work/feature-per-colorway-layers-plan.md). Undoing this removes the
  // newly created layer entirely and returns to the previous one.
  function handleLayerNew() {
    const before = captureViewSnapshot();

    // foldedColorways() folds the active layer's live cells in first — using
    // bare appState.layers here would silently drop whatever's been drawn
    // since the last explicit fold (a real bug caught via Playwright).
    const foldedLayers = foldedColorways().find((cw) => cw.id === appState.activeColorwayId).layers;
    const maxOrder = foldedLayers.reduce((max, l) => Math.max(max, l.order), -Infinity);
    const newLayer = { id: generateId(), name: `Layer ${foldedLayers.length + 1}`, visible: true, order: maxOrder + 1, shapeEntries: [], colorEntries: [] };
    const newLayers = [...foldedLayers, newLayer];
    const newCells = materializeLayerCells(newLayer);

    const after = {
      activeColorwayId: appState.activeColorwayId,
      activeLayerId: newLayer.id,
      cellEntries: [...newCells.entries()],
      colorways: appState.colorways.map((cw) =>
        cw.id === appState.activeColorwayId ? { ...cw, activeLayerId: newLayer.id, layers: newLayers } : cw
      ),
    };

    commitViewSnapshot(after);
    pushGeometryChange(appState.history, before, after, commitViewSnapshot);
    updateHistoryButtons();
    hooks.onDesignContentChanged();
  }

  function handleLayerRename(id) {
    const layer = appState.layers.find((l) => l.id === id);
    if (!layer) return;
    const newName = window.prompt('Rename layer', layer.name);
    if (!newName || !newName.trim()) return;
    appState.layers = appState.layers.map((l) => (l.id === id ? { ...l, name: newName.trim() } : l));
    renderLayerList();
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }

  // A design always has at least one layer; deleting the last one is blocked
  // (the delete button is disabled in that case — see buildLayerRow). Any
  // live, not-yet-saved edits on the deleted layer are discarded along with
  // it — they belonged only to the layer that's going away. Deleting the
  // active layer switches to another remaining one first.
  // Deleting is pushed onto the shared timeline too, like create — Undo
  // restores the deleted layer exactly (same id, same content).
  function handleLayerDelete(id) {
    if (appState.layers.length <= 1) return;
    if (!window.confirm('Delete this layer?')) return;

    const before = captureViewSnapshot();

    // foldedColorways() folds the active layer's live cells in first — if the
    // survivor includes the still-active layer (deleting a different one),
    // bare appState.layers would silently drop its live, not-yet-folded edits.
    const foldedLayers = foldedColorways().find((cw) => cw.id === appState.activeColorwayId).layers;
    const newLayers = foldedLayers.filter((l) => l.id !== id);
    const wasActive = id === appState.activeLayerId;
    const newActiveLayerId = wasActive ? newLayers[0].id : appState.activeLayerId;
    const newCells = wasActive
      ? materializeLayerCells(newLayers.find((l) => l.id === newActiveLayerId) ?? newLayers[0])
      : new Map(appState.cells);

    const after = {
      activeColorwayId: appState.activeColorwayId,
      activeLayerId: newActiveLayerId,
      cellEntries: [...newCells.entries()],
      colorways: appState.colorways.map((cw) =>
        cw.id === appState.activeColorwayId ? { ...cw, activeLayerId: newActiveLayerId, layers: newLayers } : cw
      ),
    };

    commitViewSnapshot(after);
    pushGeometryChange(appState.history, before, after, commitViewSnapshot);
    updateHistoryButtons();
    hooks.onDesignContentChanged();
  }

  // A view-state toggle, not a content edit (same category as
  // showBeadOutlines/panel-collapse) — never touches appState.cells/history,
  // but is persisted immediately since it's part of this design's own record.
  function handleLayerVisibilityToggle(id) {
    appState.layers = appState.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
    renderLayerList();
    renderColorwayList(); // a hidden/shown layer changes the colorway's own composited thumbnail
    scheduleRedraw();
    hooks.onImmediateSave();
  }

  // Drag-reorder, not undo-tracked — same convention as the design-library/
  // Manage-Colors/Bead-Catalog drag-reorders, none of which push an undo step
  // or bump the design's own "content changed" flag either.
  function handleLayerReordered(id, newOrder) {
    appState.layers = appState.layers.map((l) => (l.id === id ? { ...l, order: newOrder } : l));
    renderLayerList();
    renderColorwayList(); // layer stacking order changes which layer wins per cell in the composite
    scheduleRedraw();
    hooks.onImmediateSave();
  }

  function buildLayerRow(layer) {
    const row = document.createElement('li');
    row.className = 'layer-row';
    row.dataset.layerId = layer.id;
    row.classList.toggle('layer-row-active', layer.id === appState.activeLayerId);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'icon-btn layer-drag-handle';
    handle.setAttribute('aria-label', 'Reorder');
    handle.title = 'Drag to reorder';
    handle.append(createIcon('grip-vertical'));

    const visibilityButton = document.createElement('button');
    visibilityButton.type = 'button';
    visibilityButton.className = 'icon-btn layer-visibility-toggle';
    visibilityButton.setAttribute('aria-label', layer.visible ? 'Hide layer' : 'Show layer');
    visibilityButton.title = layer.visible ? 'Hide layer' : 'Show layer';
    visibilityButton.append(createIcon(layer.visible ? 'eye' : 'eye-off'));
    visibilityButton.addEventListener('click', (e) => {
      e.stopPropagation();
      handleLayerVisibilityToggle(layer.id);
    });

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'layer-name';
    name.textContent = layer.name;
    name.addEventListener('click', () => switchLayer(layer.id));

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'icon-btn layer-action';
    moreButton.setAttribute('aria-label', `More actions for ${layer.name}`);
    moreButton.title = 'More actions';
    moreButton.append(createIcon('ellipsis-vertical'));
    moreButton.addEventListener('click', (e) => {
      e.stopPropagation();
      openActionMenu(moreButton, [
        { label: 'Rename', icon: 'pencil', onSelect: () => handleLayerRename(layer.id) },
        { label: 'Delete', icon: 'trash-2', destructive: true, disabled: appState.layers.length <= 1, onSelect: () => handleLayerDelete(layer.id) },
      ]);
    });

    const actions = document.createElement('div');
    actions.className = 'layer-actions';
    actions.append(moreButton);

    row.append(handle, visibilityButton, name, actions);
    return row;
  }

  // Top of the list = top of the stack (frontmost) = highest order — matches
  // a Photoshop layers panel and colorwaySync.js's own order convention.
  function renderLayerList() {
    const stacked = [...appState.layers].sort((a, b) => b.order - a.order);
    layerListEl.replaceChildren(...stacked.map(buildLayerRow));
  }

  function handleLayerListPointerDown(e) {
    const handle = e.target.closest('.layer-drag-handle');
    if (!handle) return;
    const rowEl = handle.closest('.layer-row');
    if (!rowEl) return;
    layerDrag = { pointerId: e.pointerId, rowEl, layerId: rowEl.dataset.layerId };
    layerListEl.setPointerCapture(e.pointerId);
    rowEl.classList.add('dragging');
  }
  function handleLayerListPointerMove(e) {
    if (!layerDrag || e.pointerId !== layerDrag.pointerId) return;
    const siblings = [...layerListEl.querySelectorAll('.layer-row')].filter((r) => r !== layerDrag.rowEl);
    const target = siblings.find((sibling) => {
      const rect = sibling.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if (target) layerListEl.insertBefore(layerDrag.rowEl, target);
    else layerListEl.appendChild(layerDrag.rowEl);
  }
  function handleLayerListPointerUp(e) {
    if (!layerDrag || e.pointerId !== layerDrag.pointerId) return;
    const { rowEl, layerId } = layerDrag;
    rowEl.classList.remove('dragging');
    if (layerListEl.hasPointerCapture?.(e.pointerId)) layerListEl.releasePointerCapture(e.pointerId);
    layerDrag = null;

    // The list renders top-of-stack (highest order) first — the reverse of
    // orderForInsertAt's own ascending convention — so the drop position is
    // inverted against the ascending (excluding-dragged) list before computing
    // the new fractional order.
    const domIndex = [...layerListEl.querySelectorAll('.layer-row')].indexOf(rowEl);
    const ascending = [...appState.layers].sort((a, b) => a.order - b.order).filter((l) => l.id !== layerId);
    const newOrder = orderForInsertAt(ascending, ascending.length - domIndex);
    handleLayerReordered(layerId, newOrder);
  }

  // --- Colorways (.work/feature-per-colorway-layers-plan.md) ----------------
  // Each colorway owns its own fully independent set of layers (its own
  // shapes AND colors) — switching colorways means folding whatever's
  // currently drawn back into the active layer's own slot within the
  // colorway being left, then loading the target colorway's own layer stack
  // wholesale (which layer is active is remembered per colorway, via its own
  // activeLayerId). No design remount — canvas/tools/palette stay mounted,
  // only cells/the layer list/the colorway list's highlight change.
  function switchColorway(newColorwayId) {
    if (newColorwayId === appState.activeColorwayId) return;
    // The target colorway's own stored data (nothing here is "live" — only the
    // CURRENTLY active colorway's active layer has unfolded edits sitting in
    // appState.cells) already has everything needed to resolve which layer to
    // land on; switchContext() does the actual fold + switch.
    const target = appState.colorways.find((cw) => cw.id === newColorwayId);
    const activeLayer = target.layers.find((l) => l.id === target.activeLayerId) ?? target.layers[0];
    switchContext(newColorwayId, activeLayer.id);
  }

  // Creating a colorway always seeds it as a disconnected copy of the
  // currently active colorway's own layers — every layer, shape AND colors —
  // so there's no separate "duplicate" action, create is duplicate, scoped to
  // one pattern. Fresh ids throughout (every copied layer gets its own new
  // id) so the two colorways' layers are never the same object going forward
  // — editing one's layers (add/delete/reorder/redraw) never touches the
  // other's (see .work/feature-per-colorway-layers-plan.md). Overwrites just
  // the active layer's own slice with the freshly-decomposed live cells first,
  // so an edit not yet reconciled into appState.layers isn't lost in the copy.
  // Undoing this removes the newly created colorway entirely.
  function handleColorwayNew() {
    const before = captureViewSnapshot();

    const updatedColorways = foldedColorways();
    const currentLayers = updatedColorways.find((cw) => cw.id === appState.activeColorwayId).layers;

    const layerIdMap = new Map(currentLayers.map((l) => [l.id, generateId()]));
    const now = Date.now();
    const newColorway = {
      id: generateId(),
      name: `Colorway ${appState.colorways.length + 1}`,
      activeLayerId: layerIdMap.get(appState.activeLayerId),
      layers: currentLayers.map((layer) => ({
        ...layer,
        id: layerIdMap.get(layer.id),
        shapeEntries: [...layer.shapeEntries],
        colorEntries: [...layer.colorEntries],
      })),
      createdAt: now,
      updatedAt: now,
    };
    const newColorways = [...updatedColorways, newColorway];
    const activeLayerInNew = newColorway.layers.find((l) => l.id === newColorway.activeLayerId);
    const newCells = materializeLayerCells(activeLayerInNew);

    const after = {
      activeColorwayId: newColorway.id,
      activeLayerId: newColorway.activeLayerId,
      cellEntries: [...newCells.entries()],
      colorways: newColorways,
    };

    commitViewSnapshot(after);
    pushGeometryChange(appState.history, before, after, commitViewSnapshot);
    updateHistoryButtons();
    hooks.onDesignContentChanged();
  }

  function handleColorwayRename(id) {
    const current = appState.colorways.find((cw) => cw.id === id);
    if (!current) return;
    const newName = window.prompt('Rename colorway', current.name);
    if (!newName || !newName.trim()) return;
    appState.colorways = appState.colorways.map((cw) =>
      cw.id === current.id ? { ...cw, name: newName.trim(), updatedAt: Date.now() } : cw
    );
    renderColorwayList();
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }

  // A design always has at least one colorway; deleting the last one is
  // blocked (button is disabled in that case — see buildColorwayRow). Any
  // colorway can be deleted, not just the active one (matching
  // handleLayerDelete's own "any row" pattern) — deleting it discards its own
  // layers entirely (they belong to no other colorway, see .work/feature-
  // per-colorway-layers-plan.md). Deleting the active colorway switches to
  // the first remaining one; deleting any other one leaves the active
  // colorway/layer/cells completely untouched. Pushed onto the shared
  // timeline like create — Undo restores the deleted colorway exactly.
  function handleColorwayDelete(id) {
    if (appState.colorways.length <= 1) return;
    if (!window.confirm('Delete this colorway?')) return;

    const before = captureViewSnapshot();

    // foldedColorways() folds the active colorway's active layer's live cells
    // in first — if the survivor includes the still-active colorway (deleting
    // a different one), bare appState.colorways would silently drop its live,
    // not-yet-folded edits.
    const newColorways = foldedColorways().filter((cw) => cw.id !== id);
    const wasActive = id === appState.activeColorwayId;
    let newActiveColorwayId = appState.activeColorwayId;
    let newActiveLayerId = appState.activeLayerId;
    let newCells;
    if (wasActive) {
      const next = newColorways[0];
      const activeLayer = next.layers.find((l) => l.id === next.activeLayerId) ?? next.layers[0];
      newActiveColorwayId = next.id;
      newActiveLayerId = activeLayer.id;
      newCells = materializeLayerCells(activeLayer);
    } else {
      newCells = new Map(appState.cells);
    }

    const after = {
      activeColorwayId: newActiveColorwayId,
      activeLayerId: newActiveLayerId,
      cellEntries: [...newCells.entries()],
      colorways: newColorways,
    };

    commitViewSnapshot(after);
    pushGeometryChange(appState.history, before, after, commitViewSnapshot);
    updateHistoryButtons();
    hooks.onDesignContentChanged();
  }

  function buildColorwayRow(cw) {
    const row = document.createElement('li');
    row.className = 'colorway-row';
    row.dataset.colorwayId = cw.id;
    row.classList.toggle('colorway-row-active', cw.id === appState.activeColorwayId);

    const thumb = document.createElement('div');
    thumb.className = 'colorway-thumb';
    const img = document.createElement('img');
    img.src = renderColorwayThumbnail(cw);
    img.alt = '';
    thumb.append(img);

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'colorway-name';
    name.textContent = cw.name;
    name.addEventListener('click', () => switchColorway(cw.id));

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'icon-btn colorway-action';
    moreButton.setAttribute('aria-label', `More actions for ${cw.name}`);
    moreButton.title = 'More actions';
    moreButton.append(createIcon('ellipsis-vertical'));
    moreButton.addEventListener('click', (e) => {
      e.stopPropagation();
      openActionMenu(moreButton, [
        { label: 'Rename', icon: 'pencil', onSelect: () => handleColorwayRename(cw.id) },
        { label: 'Delete', icon: 'trash-2', destructive: true, disabled: appState.colorways.length <= 1, onSelect: () => handleColorwayDelete(cw.id) },
      ]);
    });

    const actions = document.createElement('div');
    actions.className = 'colorway-actions';
    actions.append(moreButton);

    row.append(thumb, name, actions);
    return row;
  }

  // No manual reordering — colorways render in stored (creation) order, top
  // to bottom, unlike the layer list's stack ordering (nothing here has a
  // "which one wins" concept to arrange).
  function renderColorwayList() {
    colorwayListEl.replaceChildren(...appState.colorways.map(buildColorwayRow));
  }

  // Cheaper than a full renderColorwayList() for the common case (a single
  // draw/erase/undo/etc. stroke on the currently open colorway) — updates just
  // that one row's already-rendered <img>, in place, rather than rebuilding
  // every row (and every OTHER colorway's thumbnail, which didn't change) on
  // every cell edit.
  function refreshActiveColorwayThumbnail() {
    const activeColorway = appState.colorways.find((cw) => cw.id === appState.activeColorwayId);
    if (!activeColorway) return;
    const img = colorwayListEl.querySelector('.colorway-row-active .colorway-thumb img');
    if (img) img.src = renderColorwayThumbnail(activeColorway);
  }

  // rAF-deduped like scheduleRedraw — a continuous draw/erase drag fires the
  // underlying cells-changed callback on every pointermove, so this collapses
  // however many of those land within one frame into a single thumbnail
  // re-render, the same way scheduleRedraw already does for the main canvas.
  let colorwayThumbnailRefreshScheduled = false;
  function scheduleColorwayThumbnailRefresh() {
    if (colorwayThumbnailRefreshScheduled) return;
    colorwayThumbnailRefreshScheduled = true;
    requestAnimationFrame(() => {
      colorwayThumbnailRefreshScheduled = false;
      refreshActiveColorwayThumbnail();
    });
  }

  // Populates the top-bar bead-type <select> from the live catalog — called on
  // mount and again whenever the bead catalog manager mutates it, so a
  // rename/add/delete/reorder is reflected immediately without remounting.
  function renderBeadTypeSelect() {
    beadTypeSelect.replaceChildren(
      ...beadTypeSelectOptions(appState.beadCatalog).map(({ value, label }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
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

    if (isDesignEmpty()) {
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

  // Shows the Drops field only for peyote — square stitch has no drop concept
  // at all (see .work/feature-multi-drop-peyote-plan.md). Keyed off the
  // *currently selected* stitch-type option, not necessarily the committed
  // appState.stitchType, since the select's own value can change before a
  // non-empty-design conversion is confirmed or reverted (handleStitchTypeChange
  // below calls this from all three of its own branches, plus once at mount).
  function updateDropCountVisibility() {
    dropCountLabel.hidden = stitchTypeSelect.value !== 'peyote';
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

    if (isDesignEmpty()) {
      appState.stitchType = targetStitchType;
      rebuildGridParams();
      fitViewportToGrid();
      updateSizeReadout();
      updateDropCountVisibility();
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
      updateDropCountVisibility();
      return;
    }
    await hooks.onStitchTypeConvertConfirmed(targetStitchType);
    updateDropCountVisibility();
    // main.js unmounts this editor instance and opens the newly created design
    // right after the promise above resolves — nothing left to do here.
  }

  // The Settings dialog's Drops field is the conversion mechanism for an
  // existing design — no separate dialog, since a dropCount change is
  // non-destructive and reinterpreted live (see appState.js's own comment).
  // No confirm dialog (matches Crop to Design's precedent — nothing is lost),
  // no undo-history entry (matches how stitchType/beadTypeKey changes aren't
  // part of the cell-patch undo stack either — this doesn't touch cells/rows/
  // cols/staggerFlipped at all, only a rendering reinterpretation of existing
  // data).
  function handleDropCountChange() {
    const value = Math.max(1, Math.round(Number(dropCountInput.value)) || 1);
    dropCountInput.value = String(value);
    if (value === appState.dropCount) return;
    appState.dropCount = value;
    rebuildGridParams();
    updateSelectionButtons(); // Mirror Horizontal's guard depends on dropCount
    scheduleRedraw();
    hooks.onPreferencesChanged({ defaultDropCount: value });
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
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
  // Both flows open the same custom picker dialog (colorPickerDialog.js) — it
  // replaces the native <input type="color"> that used to render as two
  // genuinely different OS pickers on Mac vs. iPad. Nothing is applied until
  // the dialog resolves (Add/Done), so there's no live-apply-while-dragging
  // and no separate undo button to keep in sync — Cancel just discards.
  async function handleAddColorClick() {
    const result = await promptColorPicker({ title: 'Add Color', showNameField: true });
    if (!result) return;
    await hooks.onCustomColorAdded({ name: result.name, hex: result.hex, alphaPercent: result.alphaPercent, luster: result.luster });
    renderColorPalette();
    if (manageMode) renderColorManageList();
  }
  async function handleColorEditClick(id) {
    const color = appState.customColors.find((c) => c.id === id);
    if (!color) return;
    const result = await promptColorPicker({
      title: 'Edit Color',
      initialHex: color.hex,
      showNameField: false,
      initialAlphaPercent: color.alphaPercent,
      initialLuster: color.luster,
    });
    if (!result) return;
    await hooks.onCustomColorAppearanceChanged(id, { hex: result.hex, alphaPercent: result.alphaPercent, luster: result.luster });
    renderColorPalette();
    renderColorManageList();
    renderColorwayList(); // this color may be used in more than just the active colorway
    scheduleRedraw();
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
      showToast('No other bead types to copy to yet.');
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
      activeLayerId: appState.activeLayerId,
      cells: appState.cells,
    });
    if (usage.length > 0) {
      const lines = usage.map((u) =>
        u.colorwayNames.length > 1 ? `${u.designName} (${u.colorwayNames.join(', ')})` : u.designName
      );
      showToast(
        `This color is used in ${usage.length} pattern${usage.length === 1 ? '' : 's'} and can't be deleted:\n\n${lines.join('\n')}`
      );
      return;
    }
    if (!window.confirm('Delete this color?')) return;
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

  // Reflects appState.preferences.canvasBackgroundMode/Hex on the select and
  // the Custom Color button's visibility — called once on open and again
  // after the custom-color picker resolves, since that's the only other way
  // the mode/hex could change while this dialog is open.
  function updateCanvasBackgroundControls() {
    canvasBackgroundModeSelect.value = appState.preferences.canvasBackgroundMode ?? 'white';
    canvasBackgroundCustomSwatchButton.hidden = canvasBackgroundModeSelect.value !== 'custom';
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
    updateCanvasBackgroundControls();
    updatePreserveStaggerToggleButton();
    appState.viewMode = 'actual';
    setViewportToActualSize(calibrationFactor);
    updateResetViewButton();
    scheduleRedraw();
    preferencesDialog.showModal();
  }

  // Canvas background applies and persists immediately on every change — no
  // Save/Cancel step, unlike calibration's live-preview-then-commit flow.
  // Picking a mode or a color *is* the final action; there's no "abort
  // mid-drag" scenario here worth a separate commit step.
  function handleCanvasBackgroundModeChange() {
    const mode = canvasBackgroundModeSelect.value;
    // onPreferencesChanged mutates appState.preferences synchronously (before
    // its own first await) — must run before updateCanvasBackgroundControls,
    // which reads appState.preferences.canvasBackgroundMode to decide the
    // Custom Color button's visibility. Calling it first would read the
    // *old* mode and immediately reset the select back to it.
    hooks.onPreferencesChanged({ canvasBackgroundMode: mode });
    updateCanvasBackgroundControls();
    scheduleRedraw();
  }

  async function handleCanvasBackgroundCustomSwatchClick() {
    const result = await promptColorPicker({
      title: 'Canvas Background Color',
      confirmLabel: 'Done',
      showNameField: false,
      showAppearanceControls: false,
      initialHex: appState.preferences.canvasBackgroundHex ?? '#ffffff',
    });
    if (!result) return;
    hooks.onPreferencesChanged({ canvasBackgroundHex: result.hex });
    scheduleRedraw();
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
  // A plain on/off switch (aria-pressed drives both the visual slide and
  // assistive-tech state), not a button whose text names the next state —
  // that convention (matching updateUnitToggleButton/Reset View) turned out
  // unclear here specifically: it wasn't obvious what the button's *current*
  // wording meant would happen on click. Reads appState.preferences directly
  // rather than a promoted top-level field, since this is only consulted by
  // pointerRouter.js mid-drag, not rendering, so it doesn't need the same
  // hot-path treatment showBeadOutlines gets. `!== false` treats a
  // preferences row saved before this preference existed as "on" (its
  // default) rather than "off" — see preferencesStore.js.
  function updatePreserveStaggerToggleButton() {
    const on = appState.preferences.preserveStaggerOnShift !== false;
    preferencesPreserveStaggerToggleButton.setAttribute('aria-pressed', String(on));
    preferencesPreserveStaggerToggleButton.setAttribute('aria-label', `Preserve Pattern Shape: ${on ? 'on' : 'off'}`);
  }
  function handlePreserveStaggerToggle() {
    const next = !(appState.preferences.preserveStaggerOnShift !== false);
    // onPreferencesChanged mutates appState.preferences synchronously (same
    // guarantee handleCanvasBackgroundModeChange relies on) — call it before
    // reading the new state back into the button label.
    hooks.onPreferencesChanged({ preserveStaggerOnShift: next });
    updatePreserveStaggerToggleButton();
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
  // Magic wand — two variants, reached via #tool-select's long-press/right-click
  // menu rather than their own top-level tool buttons (see registerLongPressMenu
  // below). Each is a one-tap discrete action (pointerRouter.js's
  // performDiscreteAction) that resolves a masked selection instead of drawing —
  // the tool switches to 'select' itself once onSelectionChange reports the
  // result (see that hook, in attachPointerRouter's hooks object below), so
  // #selection-controls appears with Copy/Cut/Paste ready to use immediately.
  function handleToolWandContiguous() {
    setTool('wand-contiguous');
  }
  function handleToolWandGlobal() {
    setTool('wand-global');
  }
  // Single column select — same reached-via-#tool-select's-long-press-menu shape
  // as the wand variants above: one tap resolves a plain full-height, one-column-
  // wide selection (pointerRouter.js's performDiscreteAction), and the tool
  // switches itself to 'select' once onSelectionChange reports it.
  function handleToolColSelect() {
    setTool('col-select');
  }
  // Moves the active selection if one exists, else the whole active layer
  // (dragged directly on canvas via pointerRouter.js's startMoveDrag/
  // continueMoveDrag) — see .work/feature-requests-and-bugs.md.
  // Move is a position-then-confirm flow like Paste: clicking the tool
  // captures a pristine snapshot of what's being moved right away (the active
  // selection's own occupied cells, or every occupied cell on the active
  // layer if nothing's selected — same "which layer" non-question Paste's
  // own getCells()-is-already-the-active-layer reasoning already covers) at
  // zero delta, so dragging always continues from a trivially-correct
  // starting position. Nothing in appState.cells is touched here or during
  // the drag — only Confirm (handleMoveConfirm) actually applies it. A
  // no-op if already on the move tool (avoids discarding an in-progress,
  // not-yet-confirmed position if this fires again, e.g. a redundant click).
  function handleToolMove() {
    if (appState.tool === 'move') return;
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    const bounds = appState.selection
      ? {
          rowStart: appState.selection.rowStart, rowEnd: appState.selection.rowEnd,
          colStart: appState.selection.colStart, colEnd: appState.selection.colEnd,
          mask: appState.selection.mask, // magic-wand selections restrict which cells move — see collectMovingEntries
        }
      : null;
    const baseCells = new Map(appState.cells);
    const movingEntries = collectMovingEntries(baseCells, bounds);
    // An empty selection or an empty active layer has nothing to move —
    // movePreview stays null (Confirm disabled, per updateMoveControls),
    // matching how Paste's own Confirm stays disabled with no pastePreview.
    appState.movePreview = movingEntries.length > 0
      ? { baseCells, movingEntries, bounds, deltaRow: 0, deltaCol: 0, needsRowCompensation: false }
      : null;
    setTool('move');
    scheduleRedraw();
  }
  // Confirm applies the accumulated shift as one undo-able patch (via
  // applyMove — same per-cell "preserve pattern" compensation Paste's own
  // Confirm applies, see colShiftRowDelta), then ends the move session
  // entirely: clears the preview, clears the now-stale selection (it would
  // otherwise sit over the empty hole the content just vacated), and drops
  // back to Draw — one-and-done, matching Paste's own Confirm exactly. A
  // repeat move means clicking the Move tool again.
  function handleMoveConfirm() {
    if (!appState.movePreview) return;
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    const { baseCells, movingEntries, deltaRow, deltaCol, needsRowCompensation } = appState.movePreview;
    const computeTarget = (row, col) => ({
      row: row + deltaRow + colShiftRowDelta(
        col, needsRowCompensation, appState.gridParams.cols, appState.gridParams.staggerFlipped, appState.gridParams.dropCount ?? 1
      ),
      col: col + deltaCol,
    });
    const patch = applyMove(appState.cells, baseCells, movingEntries, computeTarget, appState.gridParams.rows, appState.gridParams.cols, new Set());
    pushCellPatch(patch);
    appState.movePreview = null;
    appState.selection = null;
    updateSelectionButtons();
    setTool('draw');
    scheduleRedraw();
    if (patch.length > 0) {
      refreshActiveColorwayThumbnail();
      hooks.onCellsChanged();
    }
  }
  // Discards the preview outright — since nothing was ever mutated during
  // positioning, this is a pure no-op on the actual design, unlike the old
  // live-mutating Move which needed applyMove's own touchedKeys machinery to
  // undo a mid-drag change.
  function handleMoveCancel() {
    appState.movePreview = null;
    setTool('draw');
    scheduleRedraw();
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
  // Clear is an editing tool like draw/erase/fill, so — per .work/feature-
  // layers-plan.md's "editing tools stay scoped to the active layer" — it only
  // ever clears the active layer within the active colorway; since layers
  // belong to exactly one colorway (see .work/feature-per-colorway-layers-
  // plan.md), no other colorway is touched at all.
  function handleClear() {
    if (appState.cells.size === 0) return;
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    if (!window.confirm(confirmClearLayerMessage())) return;
    appState.cells.clear();
    clearHistory(appState.history);
    updateHistoryButtons();
    renderColorwayList();
    scheduleRedraw();
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }
  // If the patch about to be undone was made on a different layer/colorway
  // than the one currently active, jump there first (switchContext — not an
  // undo step of its own) so the undo lands where it actually belongs. A
  // geometry entry (resize/crop/rotate, or a layer/colorway create/delete)
  // needs no jump — peekUndoContext returns null for those, since applying
  // them already restores whichever layer/colorway was active as part of what
  // they do.
  function handleUndo() {
    const context = peekUndoContext(appState.history);
    if (context && (context.colorwayId !== appState.activeColorwayId || context.layerId !== appState.activeLayerId)) {
      switchContext(context.colorwayId, context.layerId);
    }
    if (undo(appState.history, appState.cells)) {
      scheduleRedraw();
      updateHistoryButtons();
      refreshActiveColorwayThumbnail();
      hooks.onCellsChanged();
    }
  }
  function handleRedo() {
    const context = peekRedoContext(appState.history);
    if (context && (context.colorwayId !== appState.activeColorwayId || context.layerId !== appState.activeLayerId)) {
      switchContext(context.colorwayId, context.layerId);
    }
    if (redo(appState.history, appState.cells)) {
      scheduleRedraw();
      updateHistoryButtons();
      refreshActiveColorwayThumbnail();
      hooks.onCellsChanged();
    }
  }
  function handleCopy() {
    if (!appState.selection) return;
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    appState.clipboard = buildClipboard(appState.cells, appState.selection);
    updateSelectionButtons();
  }
  function handleCut() {
    if (!appState.selection) return;
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    appState.clipboard = buildClipboard(appState.cells, appState.selection);
    const patch = applyEraseRegion(appState.cells, appState.selection);
    pushCellPatch(patch);
    updateSelectionButtons();
    scheduleRedraw();
    refreshActiveColorwayThumbnail();
    hooks.onCellsChanged();
  }
  function handleMirror(axis) {
    if (!appState.selection) return;
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    const patch = applyMirror(appState.cells, appState.selection, axis);
    pushCellPatch(patch);
    scheduleRedraw();
    refreshActiveColorwayThumbnail();
    hooks.onCellsChanged();
  }
  function handleMirrorHorizontal() {
    handleMirror('horizontal');
  }
  function handleMirrorVertical() {
    handleMirror('vertical');
  }
  // The consolidated #selection-mirror button's plain tap (not its long-press/
  // right-click menu) — Mirror Horizontal is the default action, but unlike
  // the old dedicated button this one stays enabled even when blocked, so a
  // tap while blocked explains why via a toast instead of silently doing
  // nothing.
  function handleMirrorDefaultTap() {
    if (!appState.selection) return;
    if (appState.selection.mask) {
      showToast('Mirror isn\'t available for a magic wand selection — its shape has no well-defined mirror image.');
      return;
    }
    const width = appState.selection.colEnd - appState.selection.colStart + 1;
    const blocksMirror = appState.stitchType === 'peyote' && !canMirrorHorizontally(width, appState.dropCount);
    if (blocksMirror) {
      showToast(
        'Mirror Horizontal needs a selection width compatible with this pattern\'s drop count (an incompatible width would land content on the wrong bead stagger).'
      );
      return;
    }
    handleMirrorHorizontal();
  }
  // 180° keeps the selection's own W×H footprint (see rotateGrid.js's
  // rotatedDimensions), so — exactly like Mirror — it's an immediate in-place
  // swap, no paste flow needed.
  function handleSelectionRotate180() {
    if (!appState.selection) return;
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    const patch = rotateSelection180(appState.cells, appState.selection);
    pushCellPatch(patch);
    scheduleRedraw();
    refreshActiveColorwayThumbnail();
    hooks.onCellsChanged();
  }
  // 90°/270° rotates the selection's content into an H×W clipboard (via the
  // existing Copy machinery) and hands it to the existing paste-preview flow
  // to place — a rotated non-square selection can't be stamped back into its
  // own footprint the way 180° can. Matches Copy's own semantics: the original
  // selected beads are not erased automatically; a user who wants the rotated
  // copy to replace the original cuts first or erases afterward.
  function handleSelectionRotate90(direction) {
    if (!appState.selection) return;
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    const clipboard = buildClipboard(appState.cells, appState.selection);
    appState.clipboard = rotateClipboard(clipboard, direction);
    appState.pastePreview = defaultPasteAnchor();
    // rotateClipboard deliberately leaves originCol unset (a rotated shape has
    // no prior on-grid position to stay faithful to) — now that the fresh
    // clipboard's first placement is known (with no compensation applied to
    // it, per resolvePasteColFromOrigin's originCol==null fallback above),
    // that placement itself becomes the fixed baseline every later drag/
    // Confirm compensates against.
    appState.clipboard.originCol = appState.pastePreview.anchorCol;
    setTool('paste');
    updateSelectionButtons();
    scheduleRedraw();
  }
  function handleSelectionRotate90Cw() {
    handleSelectionRotate90('cw');
  }
  function handleSelectionRotate90Ccw() {
    handleSelectionRotate90('ccw');
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
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
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
    if (!isActiveLayerVisible()) {
      showLayerHiddenToast();
      return;
    }
    const { anchorRow, anchorCol, needsRowCompensation } = appState.pastePreview;
    // A clipboard cell's OWN starting column (for compensation purposes) is
    // where it actually sat when copied — appState.clipboard.originCol, per
    // cutCopyTool.js's buildClipboard — not wherever this particular paste
    // session happened to start.
    const computeTarget = (relRow, relCol) => ({
      row: anchorRow + relRow + colShiftRowDelta(
        appState.clipboard.originCol + relCol, needsRowCompensation,
        appState.gridParams.cols, appState.gridParams.staggerFlipped, appState.gridParams.dropCount ?? 1
      ),
      col: anchorCol + relCol,
    });
    const patch = applyPaste(
      appState.cells, appState.clipboard, computeTarget,
      appState.gridParams.rows, appState.gridParams.cols, appState.pasteMode
    );
    pushCellPatch(patch);
    appState.pastePreview = null;
    appState.selection = null;
    updateSelectionButtons();
    setTool('draw');
    scheduleRedraw();
    if (patch.length > 0) {
      refreshActiveColorwayThumbnail();
      hooks.onCellsChanged();
    }
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
      else if (appState.movePreview) handleMoveCancel();
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
  // Fixed-step nudges — the buttons' role is quick/discoverable/repeatable
  // rotation on any input device; arbitrary fine alignment is covered by the
  // two-finger twist gesture (touch) and Shift+wheel (desktop, move-photo
  // tool active), both in pointerRouter.js. Available whenever a photo is
  // loaded, not gated to the move-photo tool being active — same convention
  // as Remove Photo.
  function handlePhotoTraceRotate(deltaDeg) {
    if (!appState.photoTrace) return;
    appState.photoTrace.rotationDeg = normalizeRotationDeg(
      (appState.photoTrace.rotationDeg ?? 0) + deltaDeg
    );
    scheduleRedraw();
    hooks.onPhotoTraceChanged();
  }
  function handlePhotoTraceRotateCcw() {
    handlePhotoTraceRotate(-PHOTO_ROTATE_STEP_DEG);
  }
  function handlePhotoTraceRotateCw() {
    handlePhotoTraceRotate(PHOTO_ROTATE_STEP_DEG);
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
  canvasBackgroundModeSelect.addEventListener('change', handleCanvasBackgroundModeChange);
  canvasBackgroundCustomSwatchButton.addEventListener('click', handleCanvasBackgroundCustomSwatchClick);
  preferencesPreserveStaggerToggleButton.addEventListener('click', handlePreserveStaggerToggle);
  beadTypeSelect.addEventListener('change', handleBeadTypeChange);
  beadCatalogManageButton.addEventListener('click', handleBeadCatalogManageClick);
  stitchTypeSelect.addEventListener('change', handleStitchTypeChange);
  dropCountInput.addEventListener('change', handleDropCountChange);
  generateButton.addEventListener('click', handleResizeClick);
  cropToDesignButton.addEventListener('click', applyCrop);
  resetViewButton.addEventListener('click', handleResetView);
  rotateCwButton.addEventListener('click', handleRotateCw);
  preferencesUnitToggleButton.addEventListener('click', handleUnitToggle);
  rulerToggleButton.addEventListener('click', handleRulerToggle);
  outlineToggleButton.addEventListener('click', handleOutlineToggle);
  toolDrawButton.addEventListener('click', handleToolDraw);
  toolEraseButton.addEventListener('click', handleToolErase);
  toolFillButton.addEventListener('click', handleToolFill);
  toolReplaceButton.addEventListener('click', handleToolReplace);
  toolEyedropperButton.addEventListener('click', handleToolEyedropper);
  toolSelectButton.addEventListener('click', handleToolSelect);
  toolMoveButton.addEventListener('click', handleToolMove);
  clearButton.addEventListener('click', handleClear);
  panelToggleButton.addEventListener('click', handlePanelToggle);
  colorManageToggleButton.addEventListener('click', handleColorManageToggle);
  colorManageList.addEventListener('pointerdown', handleColorListPointerDown);
  colorManageList.addEventListener('pointermove', handleColorListPointerMove);
  colorManageList.addEventListener('pointerup', handleColorListPointerUp);
  colorManageList.addEventListener('pointercancel', handleColorListPointerUp);
  layerNewButton.addEventListener('click', handleLayerNew);
  layerListEl.addEventListener('pointerdown', handleLayerListPointerDown);
  layerListEl.addEventListener('pointermove', handleLayerListPointerMove);
  layerListEl.addEventListener('pointerup', handleLayerListPointerUp);
  layerListEl.addEventListener('pointercancel', handleLayerListPointerUp);
  undoButton.addEventListener('click', handleUndo);
  redoButton.addEventListener('click', handleRedo);
  backButton.addEventListener('click', handleBack);
  printExportButton.addEventListener('click', handlePrintExport);
  colorwayNewButton.addEventListener('click', handleColorwayNew);
  selectionCopyButton.addEventListener('click', handleCopy);
  selectionCutButton.addEventListener('click', handleCut);
  selectionPasteButton.addEventListener('click', handlePasteButtonClick);
  selectionMirrorButton.addEventListener('click', handleMirrorDefaultTap);
  selectionRotateButton.addEventListener('click', handleSelectionRotate90Cw);
  selectionDeselectButton.addEventListener('click', handleDeselect);
  // getItems is called fresh on every long-press/right-click (see
  // registerLongPressMenu's own doc comment) — always reflects current
  // selection state with no separate "refresh the menu" call needed.
  registerLongPressMenu(selectionMirrorButton, () => {
    const selection = appState.selection;
    // A magic-wand-produced (masked) selection blocks both mirror axes — see
    // updateSelectionButtons' own comment on why a swap-based op has no
    // well-defined result for an irregular shape.
    const hasMask = !!selection?.mask;
    const width = selection ? selection.colEnd - selection.colStart + 1 : 0;
    const blocksHorizontal = hasMask || (appState.stitchType === 'peyote' && !!selection && !canMirrorHorizontally(width, appState.dropCount));
    return [
      { label: 'Mirror Horizontal', icon: 'flip-horizontal-2', disabled: blocksHorizontal, onSelect: handleMirrorHorizontal },
      { label: 'Mirror Vertical', icon: 'flip-vertical-2', disabled: hasMask, onSelect: handleMirrorVertical },
    ];
  });
  registerLongPressMenu(selectionRotateButton, () => {
    // 180° is an in-place swap like Mirror, so it's blocked by the same
    // masked-selection restriction; 90°/270° route through Copy's own
    // clipboard (already mask-aware, see cutCopyTool.js) and are unaffected.
    const blocksInPlaceRotate = !!appState.selection?.mask;
    return [
      { label: 'Rotate 90° CW', icon: 'rotate-cw', onSelect: handleSelectionRotate90Cw },
      { label: 'Rotate 90° CCW', icon: 'rotate-ccw', onSelect: handleSelectionRotate90Ccw },
      { label: 'Rotate 180°', icon: 'rotate-cw-square', disabled: blocksInPlaceRotate, onSelect: handleSelectionRotate180 },
    ];
  });
  registerLongPressMenu(toolSelectButton, () => [
    {
      label: 'Magic Wand: Color Area',
      icon: 'wand-sparkles',
      onSelect: handleToolWandContiguous,
    },
    {
      label: 'Magic Wand: All of Color',
      icon: 'wand-sparkles',
      onSelect: handleToolWandGlobal,
    },
    {
      label: 'Select Column',
      icon: 'columns-2',
      onSelect: handleToolColSelect,
    },
  ]);
  pasteModeFrontButton.addEventListener('click', handlePasteModeFrontClick);
  pasteModeBehindButton.addEventListener('click', handlePasteModeBehindClick);
  pasteCancelButton.addEventListener('click', handlePasteCancel);
  pasteConfirmButton.addEventListener('click', handlePasteConfirm);
  moveCancelButton.addEventListener('click', handleMoveCancel);
  moveConfirmButton.addEventListener('click', handleMoveConfirm);
  photoTraceLoadButton.addEventListener('click', handlePhotoTraceLoadClick);
  photoTraceFileInput.addEventListener('change', handlePhotoTraceFileChange);
  photoTraceOpacityInput.addEventListener('input', handlePhotoTraceOpacityInput);
  photoTraceMoveButton.addEventListener('click', handlePhotoTraceMoveToggle);
  photoTraceRotateCcwButton.addEventListener('click', handlePhotoTraceRotateCcw);
  photoTraceRotateCwButton.addEventListener('click', handlePhotoTraceRotateCw);
  photoTraceRemoveButton.addEventListener('click', handlePhotoTraceRemove);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', scheduleRedraw);

  const detachPointerRouter = attachPointerRouter(canvas, appState.viewport, {
    getGridParams: () => appState.gridParams,
    getCells: () => appState.cells,
    getDisplayCells: composedCellsForDisplay,
    getTool: () => appState.tool,
    getColorId: () => appState.selectedColorId,
    getClipboard: () => appState.clipboard,
    getPhotoTrace: () => appState.photoTrace,
    getSelection: () => appState.selection,
    getMovePreview: () => appState.movePreview,
    getPreserveStaggerOnShift: () => appState.preferences.preserveStaggerOnShift !== false,
    getActiveLayerVisible: isActiveLayerVisible,
    onViewportChange: scheduleRedraw,
    onCellsChanged: () => {
      scheduleRedraw();
      scheduleColorwayThumbnailRefresh();
      hooks.onCellsChanged();
    },
    onStrokeCommitted: (patch) => {
      pushCellPatch(patch);
    },
    onSelectionChange: (selection) => {
      appState.selection = selection;
      // A magic-wand/col-select tap resolves a selection but deliberately
      // stays on its own tool ('wand-contiguous'/'wand-global'/'col-select'),
      // not 'select' — these are meant to be used repeatedly (tap another
      // area/color/column and it re-resolves immediately), so switching away
      // to plain Select after just one tap would force reopening the
      // long-press menu every time. #selection-controls' own visibility
      // (updateSelectionButtons, below) already treats all four of these
      // tools as "selection is active" for exactly this reason.
      updateSelectionButtons();
      scheduleRedraw();
    },
    onPhotoTraceChange: () => {
      scheduleRedraw();
      hooks.onPhotoTraceChanged();
    },
    onPastePreviewChange: (preview) => {
      // No merge needed: pointerRouter.js's resolvePasteAnchorCol resolves
      // compensation against appState.clipboard.originCol (fixed at copy
      // time, see cutCopyTool.js's buildClipboard) rather than anything
      // carried on the preview itself, so `preview` already has everything
      // pastePreview needs.
      appState.pastePreview = preview;
      updatePasteControls();
      scheduleRedraw();
    },
    onMovePreviewChange: (update) => {
      // baseCells/movingEntries/bounds were captured once, in handleToolMove,
      // and must survive every later drag update untouched — only
      // deltaRow/deltaCol/needsRowCompensation change per frame.
      appState.movePreview = { ...appState.movePreview, ...update };
      updateMoveControls();
      scheduleRedraw();
    },
    onColorPicked: handleColorPicked,
    onActiveLayerLocked: showLayerHiddenToast,
  });

  // Reflect the bead type/rows/cols the opened design already carries, and sync
  // the units toggle's readout — these controls don't fire their own change
  // events just from being set programmatically.
  renderBeadTypeSelect();
  stitchTypeSelect.value = appState.stitchType;
  dropCountInput.value = String(appState.dropCount);
  updateDropCountVisibility();
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
  updatePreserveStaggerToggleButton();

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
    canvasBackgroundModeSelect.removeEventListener('change', handleCanvasBackgroundModeChange);
    canvasBackgroundCustomSwatchButton.removeEventListener('click', handleCanvasBackgroundCustomSwatchClick);
    preferencesPreserveStaggerToggleButton.removeEventListener('click', handlePreserveStaggerToggle);
    beadTypeSelect.removeEventListener('change', handleBeadTypeChange);
    beadCatalogManageButton.removeEventListener('click', handleBeadCatalogManageClick);
    stitchTypeSelect.removeEventListener('change', handleStitchTypeChange);
    dropCountInput.removeEventListener('change', handleDropCountChange);
    generateButton.removeEventListener('click', handleResizeClick);
    cropToDesignButton.removeEventListener('click', applyCrop);
    resetViewButton.removeEventListener('click', handleResetView);
    rotateCwButton.removeEventListener('click', handleRotateCw);
    preferencesUnitToggleButton.removeEventListener('click', handleUnitToggle);
    rulerToggleButton.removeEventListener('click', handleRulerToggle);
    outlineToggleButton.removeEventListener('click', handleOutlineToggle);
    toolDrawButton.removeEventListener('click', handleToolDraw);
    toolEraseButton.removeEventListener('click', handleToolErase);
    toolFillButton.removeEventListener('click', handleToolFill);
    toolReplaceButton.removeEventListener('click', handleToolReplace);
    toolSelectButton.removeEventListener('click', handleToolSelect);
    toolMoveButton.removeEventListener('click', handleToolMove);
    clearButton.removeEventListener('click', handleClear);
    panelToggleButton.removeEventListener('click', handlePanelToggle);
    colorManageToggleButton.removeEventListener('click', handleColorManageToggle);
    colorManageList.removeEventListener('pointerdown', handleColorListPointerDown);
    colorManageList.removeEventListener('pointermove', handleColorListPointerMove);
    colorManageList.removeEventListener('pointerup', handleColorListPointerUp);
    colorManageList.removeEventListener('pointercancel', handleColorListPointerUp);
    layerNewButton.removeEventListener('click', handleLayerNew);
    layerListEl.removeEventListener('pointerdown', handleLayerListPointerDown);
    layerListEl.removeEventListener('pointermove', handleLayerListPointerMove);
    layerListEl.removeEventListener('pointerup', handleLayerListPointerUp);
    layerListEl.removeEventListener('pointercancel', handleLayerListPointerUp);
    undoButton.removeEventListener('click', handleUndo);
    redoButton.removeEventListener('click', handleRedo);
    backButton.removeEventListener('click', handleBack);
    printExportButton.removeEventListener('click', handlePrintExport);
    colorwayNewButton.removeEventListener('click', handleColorwayNew);
    selectionCopyButton.removeEventListener('click', handleCopy);
    selectionCutButton.removeEventListener('click', handleCut);
    selectionPasteButton.removeEventListener('click', handlePasteButtonClick);
    selectionMirrorButton.removeEventListener('click', handleMirrorDefaultTap);
    selectionRotateButton.removeEventListener('click', handleSelectionRotate90Cw);
    selectionDeselectButton.removeEventListener('click', handleDeselect);
    pasteModeFrontButton.removeEventListener('click', handlePasteModeFrontClick);
    pasteModeBehindButton.removeEventListener('click', handlePasteModeBehindClick);
    pasteCancelButton.removeEventListener('click', handlePasteCancel);
    pasteConfirmButton.removeEventListener('click', handlePasteConfirm);
    moveCancelButton.removeEventListener('click', handleMoveCancel);
    moveConfirmButton.removeEventListener('click', handleMoveConfirm);
    photoTraceLoadButton.removeEventListener('click', handlePhotoTraceLoadClick);
    photoTraceFileInput.removeEventListener('change', handlePhotoTraceFileChange);
    photoTraceOpacityInput.removeEventListener('input', handlePhotoTraceOpacityInput);
    photoTraceMoveButton.removeEventListener('click', handlePhotoTraceMoveToggle);
    photoTraceRotateCcwButton.removeEventListener('click', handlePhotoTraceRotateCcw);
    photoTraceRotateCwButton.removeEventListener('click', handlePhotoTraceRotateCw);
    photoTraceRemoveButton.removeEventListener('click', handlePhotoTraceRemove);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('resize', scheduleRedraw);
    detachPointerRouter();
  }

  return { unmount, setPhotoTrace };
}
