import { screenToWorld } from '../render/viewport.js';
import { peyoteCellAtPoint } from '../grid/peyote.js';
import { applyDrawAtCell } from '../tools/drawTool.js';
import { applyEraseAtCell } from '../tools/eraseTool.js';
import { interpolatedWorldPoints } from './dragTrace.js';
import { createStrokePatch, recordCellChange, strokePatchToArray } from '../state/strokePatch.js';

// Don't let a bead render under ~4px (illegible) or the scale balloon past filling
// most of the viewport on a single bead. Tune once visible on a real device.
const MIN_SCALE_PX_PER_MM = 1;
const MAX_SCALE_PX_PER_MM = 150;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

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
  onViewportChange,
  onCellsChanged,
  onStrokeCommitted,
}) {
  const pointers = new Map(); // pointerId -> { x, y, pointerType }
  let pinchBaseline = null; // { midpoint, distance } in canvas-local px
  let mouseDrag = null; // { x, y } in canvas-local px
  let drawStroke = null; // { pointerId, lastWorld: { xMm, yMm }, patch } or null
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
      } else if (touchCount === 1 && !drawStroke) {
        startDrawStroke(e.pointerId, point);
      }
    } else if (e.pointerType === 'mouse' && e.button === 0) {
      if (spacePressed) {
        mouseDrag = point;
      } else {
        startDrawStroke(e.pointerId, point);
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
        zoomToAnchor(viewport, anchorWorld, mid, dist / pinchBaseline.distance);
        onViewportChange();
      }
      pinchBaseline = { midpoint: mid, distance: dist };
    } else if (drawStroke && drawStroke.pointerId === e.pointerId) {
      continueDrawStroke(point);
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
    if (touchLikePointers().length < 2) {
      pinchBaseline = null; // next gesture starts a fresh baseline, no jump
    }
    if (e.pointerType === 'mouse') {
      mouseDrag = null;
    }
  }

  function handleWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      const point = canvasPoint(e);
      const anchorWorld = screenToWorld(point.x, point.y, viewport);
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      zoomToAnchor(viewport, anchorWorld, point, zoomFactor);
    } else {
      viewport.originXmm += e.deltaX / viewport.scalePxPerMm;
      viewport.originYmm += e.deltaY / viewport.scalePxPerMm;
    }
    onViewportChange();
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
