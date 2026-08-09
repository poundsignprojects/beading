import { screenToWorld } from '../render/viewport.js';

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
// screenPoint — the shared math behind both pinch-zoom and wheel-zoom-to-cursor.
function zoomToAnchor(viewport, anchorWorld, screenPoint, scaleFactor) {
  viewport.scalePxPerMm = clampScale(viewport.scalePxPerMm * scaleFactor);
  viewport.originXmm = anchorWorld.xMm - screenPoint.x / viewport.scalePxPerMm;
  viewport.originYmm = anchorWorld.yMm - screenPoint.y / viewport.scalePxPerMm;
}

// Wires two-finger pan/pinch-zoom (touch + Pencil) and mouse-drag-pan + wheel-zoom
// (Mac dev fallback) to the given viewport, calling onViewportChange after every
// mutation so the caller can schedule a redraw. Single-finger/Pencil touch is left
// inert here — Phase 2 claims it for the draw tool.
export function attachPanZoom(canvas, viewport, onViewportChange) {
  const pointers = new Map(); // pointerId -> { x, y, pointerType }
  let pinchBaseline = null; // { midpoint, distance } in canvas-local px
  let mouseDrag = null; // { x, y } in canvas-local px

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function touchLikePointers() {
    return [...pointers.values()].filter(
      (p) => p.pointerType === 'touch' || p.pointerType === 'pen'
    );
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
    } else if (e.pointerType === 'mouse' && e.button === 0) {
      mouseDrag = point;
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
    if (touchLikePointers().length < 2) {
      pinchBaseline = null; // next gesture starts a fresh baseline, no jump
    }
    if (e.pointerType === 'mouse') {
      mouseDrag = null;
    }
  }

  function handleWheel(e) {
    e.preventDefault();
    const point = canvasPoint(e);
    const anchorWorld = screenToWorld(point.x, point.y, viewport);
    const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
    zoomToAnchor(viewport, anchorWorld, point, zoomFactor);
    onViewportChange();
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerEnd);
  canvas.addEventListener('pointercancel', handlePointerEnd);
  canvas.addEventListener('wheel', handleWheel, { passive: false });

  return function detach() {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerEnd);
    canvas.removeEventListener('pointercancel', handlePointerEnd);
    canvas.removeEventListener('wheel', handleWheel);
  };
}
