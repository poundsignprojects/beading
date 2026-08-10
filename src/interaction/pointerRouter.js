import { screenToWorld } from '../render/viewport.js';
import { peyoteCellAtPoint, peyoteCellAtPointClamped } from '../grid/peyote.js';
import { cellKey } from '../state/cellStore.js';
import { applyDrawAtCell } from '../tools/drawTool.js';
import { applyEraseAtCell } from '../tools/eraseTool.js';
import { applyFill } from '../tools/fillTool.js';
import { applyColorReplace } from '../tools/colorReplaceTool.js';
import { applyPaste } from '../tools/cutCopyTool.js';
import { scalePhotoToAnchor } from '../state/photoTrace.js';
import { interpolatedWorldPoints } from './dragTrace.js';
import { createStrokePatch, recordCellChange, strokePatchToArray } from '../state/strokePatch.js';

// Don't let a bead render under ~4px (illegible) or the scale balloon past filling
// most of the viewport on a single bead. Tune once visible on a real device.
const MIN_SCALE_PX_PER_MM = 1;
const MAX_SCALE_PX_PER_MM = 150;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

// draw/erase: continuous drag, interpolated between move events (unchanged from
// Phase 2). fill/replace/paste: one action per pointerdown, no interpolation — a
// flood fill or a paste stamp only makes sense at the tapped cell.
const STROKE_TOOLS = new Set(['draw', 'erase']);
const DISCRETE_TOOLS = new Set(['fill', 'replace', 'paste']);

function normalizeSelection(a, b) {
  return {
    rowStart: Math.min(a.row, b.row),
    rowEnd: Math.max(a.row, b.row),
    colStart: Math.min(a.col, b.col),
    colEnd: Math.max(a.col, b.col),
  };
}

function clampScale(scale) {
  return Math.min(MAX_SCALE_PX_PER_MM, Math.max(MIN_SCALE_PX_PER_MM, scale));
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Zooms viewport.scalePxPerMm by scaleFactor while keeping anchorWorld pinned under
// screenPoint — the shared math behind both pinch-zoom and ctrl+wheel-zoom-to-cursor.
function zoomToAnchor(viewport, anchorWorld, screenPoint, scaleFactor) {
  viewport.scalePxPerMm = clampScale(viewport.scalePxPerMm * scaleFactor);
  viewport.originXmm = anchorWorld.xMm - screenPoint.x / viewport.scalePxPerMm;
  viewport.originYmm = anchorWorld.yMm - screenPoint.y / viewport.scalePxPerMm;
}

// Owns every canvas pointer/wheel listener and routes by pointer count/type, since
// splitting pan/zoom and draw/erase across two independent listener sets would race
// on the same pointer events (Phase 2 plan's "Pointer routing is centralized" decision):
//   - two touch/pen pointers        -> pan/zoom (pinch + drag), unchanged from Phase 1
//   - exactly one touch/pen pointer -> draw/erase (tap = a drag that never moved)
//   - mouse, left-drag, Space held  -> pan (dev-only fallback for a bare mouse)
//   - mouse, left-drag, no Space    -> draw/erase
//   - plain wheel                   -> pan (trackpad two-finger-scroll convention)
//   - ctrl+wheel                    -> zoom-to-cursor
// If a second touch/pen pointer lands mid-stroke, the stroke is cancelled so pan/zoom
// can take over cleanly instead of a bead landing under the second finger.
export function attachPointerRouter(canvas, viewport, {
  getGridParams,
  getCells,
  getTool,
  getColorId,
  getClipboard,
  getPhotoTrace,
  onViewportChange,
  onCellsChanged,
  onStrokeCommitted,
  onSelectionChange,
  onPhotoTraceChange,
}) {
  const pointers = new Map(); // pointerId -> { x, y, pointerType }
  let pinchBaseline = null; // { midpoint, distance } in canvas-local px
  let mouseDrag = null; // { x, y } in canvas-local px
  let drawStroke = null; // { pointerId, lastWorld: { xMm, yMm }, patch } or null
  let selectionDrag = null; // { pointerId, startRow, startCol } or null
  let photoDrag = null; // { pointerId, x, y } in canvas-local px, or null
  let spacePressed = false;

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function touchLikePointers() {
    return [...pointers.values()].filter(
      (p) => p.pointerType === 'touch' || p.pointerType === 'pen'
    );
  }

  // Hit-tests a world-mm point, applies the active tool, and records any change
  // into the in-progress stroke's patch. Returns whether a cell actually changed,
  // so the caller only schedules a redraw when needed.
  function applyToolAtWorld(worldPoint, strokePatch) {
    const gridParams = getGridParams();
    if (!gridParams) return false;
    const hit = peyoteCellAtPoint(
      worldPoint.xMm,
      worldPoint.yMm,
      gridParams.beadWidthMm,
      gridParams.beadHeightMm,
      gridParams.rows,
      gridParams.cols
    );
    if (!hit) return false; // stroke exited the grid bounds — no-op, not an error
    const cells = getCells();
    const result = getTool() === 'erase'
      ? applyEraseAtCell(cells, hit.row, hit.col)
      : applyDrawAtCell(cells, hit.row, hit.col, getColorId());
    if (!result) return false;
    recordCellChange(strokePatch, result.row, result.col, result.before, result.after);
    return true;
  }

  // Both places a stroke can end — a normal pointerup/cancel, and a second finger
  // landing mid-stroke (which aborts to pan/zoom) — commit whatever was drawn so
  // far as one undo-able patch, then null out drawStroke.
  function commitStroke() {
    if (!drawStroke) return;
    const patch = strokePatchToArray(drawStroke.patch);
    if (patch.length > 0) onStrokeCommitted(patch);
    drawStroke = null;
  }

  // One-shot action for fill/replace/paste: hit-tests the tapped cell, applies the
  // active discrete tool, and commits the result as a single undo-able patch via
  // the same onStrokeCommitted path draw/erase strokes already use.
  function performDiscreteAction(point) {
    const worldPoint = screenToWorld(point.x, point.y, viewport);
    const gridParams = getGridParams();
    if (!gridParams) return;
    const hit = peyoteCellAtPoint(
      worldPoint.xMm,
      worldPoint.yMm,
      gridParams.beadWidthMm,
      gridParams.beadHeightMm,
      gridParams.rows,
      gridParams.cols
    );
    if (!hit) return;
    const cells = getCells();
    const tool = getTool();
    let patch;
    if (tool === 'fill') {
      patch = applyFill(cells, hit.row, hit.col, getColorId(), gridParams.rows, gridParams.cols);
    } else if (tool === 'replace') {
      const source = cells.get(cellKey(hit.row, hit.col));
      if (!source) return; // tapped an empty cell — nothing to replace
      patch = applyColorReplace(cells, source.colorId, getColorId());
    } else if (tool === 'paste') {
      const clipboard = getClipboard();
      if (!clipboard) return; // shouldn't be reachable (paste tool only selectable with a clipboard)
      patch = applyPaste(cells, clipboard, hit.row, hit.col, gridParams.rows, gridParams.cols);
    }
    if (patch && patch.length > 0) {
      onCellsChanged();
      onStrokeCommitted(patch);
    }
  }

  function clampedHit(point) {
    const gridParams = getGridParams();
    if (!gridParams) return null;
    const worldPoint = screenToWorld(point.x, point.y, viewport);
    return peyoteCellAtPointClamped(
      worldPoint.xMm,
      worldPoint.yMm,
      gridParams.beadWidthMm,
      gridParams.beadHeightMm,
      gridParams.rows,
      gridParams.cols
    );
  }

  function startSelectionDrag(pointerId, point) {
    const hit = clampedHit(point);
    if (!hit) return;
    selectionDrag = { pointerId, startRow: hit.row, startCol: hit.col };
    onSelectionChange(normalizeSelection(hit, hit));
  }

  function continueSelectionDrag(point) {
    const hit = clampedHit(point);
    if (!hit) return;
    onSelectionChange(normalizeSelection({ row: selectionDrag.startRow, col: selectionDrag.startCol }, hit));
  }

  // Single-pointer drag while the 'move-photo' tool is active translates the photo
  // trace overlay directly (not the viewport) — never touches appState.cells, so
  // it's deliberately not undo-tracked (see the Phase 7 plan's photo trace section).
  function startPhotoDrag(pointerId, point) {
    if (!getPhotoTrace()) return;
    photoDrag = { pointerId, x: point.x, y: point.y };
  }

  function continuePhotoDrag(point) {
    const photoTrace = getPhotoTrace();
    if (!photoTrace) {
      photoDrag = null;
      return;
    }
    const dxPx = point.x - photoDrag.x;
    const dyPx = point.y - photoDrag.y;
    photoTrace.xMm += dxPx / viewport.scalePxPerMm;
    photoTrace.yMm += dyPx / viewport.scalePxPerMm;
    photoDrag = { pointerId: photoDrag.pointerId, x: point.x, y: point.y };
    onPhotoTraceChange();
  }

  // Routes a single-touch/pen tap or a mouse-left-drag start by the currently
  // active tool. draw/erase keep the existing continuous-stroke path; fill/
  // replace/paste fire once and don't set drawStroke (so handlePointerMove's
  // stroke branch never matches for them); select starts a marquee drag;
  // move-photo starts a photo-translate drag.
  function handleSingleInteractionStart(pointerId, point) {
    const tool = getTool();
    if (STROKE_TOOLS.has(tool)) {
      if (!drawStroke) startDrawStroke(pointerId, point);
    } else if (DISCRETE_TOOLS.has(tool)) {
      performDiscreteAction(point);
    } else if (tool === 'select') {
      startSelectionDrag(pointerId, point);
    } else if (tool === 'move-photo') {
      startPhotoDrag(pointerId, point);
    }
  }

  function startDrawStroke(pointerId, point) {
    const worldPoint = screenToWorld(point.x, point.y, viewport);
    const patch = createStrokePatch();
    const changed = applyToolAtWorld(worldPoint, patch);
    drawStroke = { pointerId, lastWorld: worldPoint, patch };
    if (changed) onCellsChanged();
  }

  function continueDrawStroke(point) {
    const currentWorld = screenToWorld(point.x, point.y, viewport);
    const gridParams = getGridParams();
    if (gridParams) {
      // Half the smaller bead dimension: no cell along the path is skipped
      // regardless of zoom level or drag speed.
      const stepMm = Math.min(gridParams.beadWidthMm, gridParams.beadHeightMm) / 2;
      const points = interpolatedWorldPoints(drawStroke.lastWorld, currentWorld, stepMm);
      let anyChanged = false;
      for (const p of points) {
        if (applyToolAtWorld(p, drawStroke.patch)) anyChanged = true;
      }
      if (anyChanged) onCellsChanged();
    }
    drawStroke.lastWorld = currentWorld;
  }

  function handlePointerDown(e) {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Browser can reject capture for a pointer it no longer considers active
      // (e.g. an already-released touch); safe to continue without capture.
    }
    const point = canvasPoint(e);
    pointers.set(e.pointerId, { ...point, pointerType: e.pointerType });

    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      pinchBaseline = null; // recomputed on next move once both points are known
      const touchCount = touchLikePointers().length;
      if (touchCount >= 2) {
        commitStroke(); // second finger landed — hand off to pan/zoom, not a stray bead
        selectionDrag = null; // last onSelectionChange already left the selection at its value
        photoDrag = null; // hand off to pinch-scale instead
      } else if (touchCount === 1) {
        handleSingleInteractionStart(e.pointerId, point);
      }
    } else if (e.pointerType === 'mouse' && e.button === 0) {
      if (spacePressed) {
        mouseDrag = point;
      } else {
        handleSingleInteractionStart(e.pointerId, point);
      }
    }
  }

  function handlePointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const point = canvasPoint(e);
    pointers.set(e.pointerId, { ...point, pointerType: e.pointerType });

    const touchPointers = touchLikePointers();
    if (touchPointers.length === 2) {
      const mid = midpoint(touchPointers[0], touchPointers[1]);
      const dist = distance(touchPointers[0], touchPointers[1]);
      if (pinchBaseline && pinchBaseline.distance > 0) {
        const anchorWorld = screenToWorld(
          pinchBaseline.midpoint.x,
          pinchBaseline.midpoint.y,
          viewport
        );
        const scaleFactor = dist / pinchBaseline.distance;
        const photoTrace = getTool() === 'move-photo' ? getPhotoTrace() : null;
        // Structurally identical pinch math either way — only the target and the
        // change-notification hook differ, based on which tool is active.
        if (photoTrace) {
          Object.assign(photoTrace, scalePhotoToAnchor(photoTrace, anchorWorld, scaleFactor));
          onPhotoTraceChange();
        } else {
          zoomToAnchor(viewport, anchorWorld, mid, scaleFactor);
          onViewportChange();
        }
      }
      pinchBaseline = { midpoint: mid, distance: dist };
    } else if (drawStroke && drawStroke.pointerId === e.pointerId) {
      continueDrawStroke(point);
    } else if (selectionDrag && selectionDrag.pointerId === e.pointerId) {
      continueSelectionDrag(point);
    } else if (photoDrag && photoDrag.pointerId === e.pointerId) {
      continuePhotoDrag(point);
    } else if (e.pointerType === 'mouse' && mouseDrag) {
      const dxPx = point.x - mouseDrag.x;
      const dyPx = point.y - mouseDrag.y;
      viewport.originXmm -= dxPx / viewport.scalePxPerMm;
      viewport.originYmm -= dyPx / viewport.scalePxPerMm;
      mouseDrag = point;
      onViewportChange();
    }
  }

  function handlePointerEnd(e) {
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (drawStroke && drawStroke.pointerId === e.pointerId) {
      commitStroke();
    }
    if (selectionDrag && selectionDrag.pointerId === e.pointerId) {
      selectionDrag = null; // last onSelectionChange already left the selection at its final value
    }
    if (photoDrag && photoDrag.pointerId === e.pointerId) {
      photoDrag = null;
    }
    if (touchLikePointers().length < 2) {
      pinchBaseline = null; // next gesture starts a fresh baseline, no jump
    }
    if (e.pointerType === 'mouse') {
      mouseDrag = null;
    }
  }

  // Ctrl+wheel is the trackpad/mouse pinch-to-zoom convention (Safari/Chrome both
  // synthesize it from a trackpad pinch). When the 'move-photo' tool is active this
  // is the only desktop-friendly way to resize the photo trace — touch pinch (see
  // the two-pointer branch in handlePointerMove) covers the iPad case, but a Mac
  // trackpad/mouse session has no multi-touch gesture at all otherwise.
  function handleWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      const point = canvasPoint(e);
      const anchorWorld = screenToWorld(point.x, point.y, viewport);
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const photoTrace = getTool() === 'move-photo' ? getPhotoTrace() : null;
      if (photoTrace) {
        Object.assign(photoTrace, scalePhotoToAnchor(photoTrace, anchorWorld, zoomFactor));
        onPhotoTraceChange();
      } else {
        zoomToAnchor(viewport, anchorWorld, point, zoomFactor);
        onViewportChange();
      }
    } else {
      viewport.originXmm += e.deltaX / viewport.scalePxPerMm;
      viewport.originYmm += e.deltaY / viewport.scalePxPerMm;
      onViewportChange();
    }
  }

  function handleKeyDown(e) {
    if (e.code === 'Space') spacePressed = true;
  }

  function handleKeyUp(e) {
    if (e.code === 'Space') spacePressed = false;
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerEnd);
  canvas.addEventListener('pointercancel', handlePointerEnd);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  return function detach() {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerEnd);
    canvas.removeEventListener('pointercancel', handlePointerEnd);
    canvas.removeEventListener('wheel', handleWheel);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
}
