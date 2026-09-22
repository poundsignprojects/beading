import { screenToWorld } from '../render/viewport.js';
import { resolveGridEngine } from '../grid/gridEngine.js';
import { resolveColShift } from '../grid/peyote.js';
import { cellKey } from '../state/cellStore.js';
import { applyDrawAtCell } from '../tools/drawTool.js';
import { applyEraseAtCell } from '../tools/eraseTool.js';
import { applyFill } from '../tools/fillTool.js';
import { applyColorReplace } from '../tools/colorReplaceTool.js';
import { selectWandContiguous, selectWandGlobal } from '../tools/magicWandTool.js';
import { scalePhotoToAnchor, normalizeRotationDeg } from '../state/photoTrace.js';
import { interpolatedWorldPoints } from './dragTrace.js';
import { createStrokePatch, recordCellChange, strokePatchToArray } from '../state/strokePatch.js';

// Don't let a bead render under ~4px (illegible) or the scale balloon past filling
// most of the viewport on a single bead. Tune once visible on a real device.
const MIN_SCALE_PX_PER_MM = 1;
const MAX_SCALE_PX_PER_MM = 150;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
// Shift+wheel is the desktop fallback for rotating the photo trace overlay
// (touch's equivalent is the two-finger twist gesture below) — same "no
// multi-touch gesture on a bare mouse/trackpad" rationale as ctrl+wheel's own
// comment on handleWheel. Degrees rotated per wheel-delta unit.
const WHEEL_ROTATE_SENSITIVITY_DEG = 0.15;

// A lone finger touch is momentarily ambiguous: it could be a tap/drag, the first
// finger of a pinch about to land, or the start of an iOS system gesture (edge
// swipe back, bottom-edge swipe-to-exit-app) that's about to cancel it. Deferring
// the actual draw/fill/select/etc. action by this long gives a second finger or a
// pointercancel time to resolve which one it is before anything is drawn — see
// schedulePendingTouchStart. Tune once visible on a real device; doesn't apply to
// mouse or pen (Apple Pencil), which can't pinch and don't trigger system swipes.
const TOUCH_DRAW_DISAMBIGUATION_MS = 120;

// How close to the canvas edge (in canvas-local px, inward or outward) a select/
// paste drag's pointer needs to be before the viewport starts auto-panning to meet
// it — without this, extending a marquee or repositioning a paste preview is
// limited by how far the physical mouse/finger can actually travel, which runs out
// well before the far edge of a grid bigger than the canvas.
const EDGE_PAN_MARGIN_PX = 48;
const EDGE_PAN_MAX_SPEED_PX_PER_FRAME = 14;

// draw/erase: continuous drag, interpolated between move events (unchanged from
// Phase 2). fill/replace: one action per pointerdown, no interpolation — a flood
// fill only makes sense at the tapped cell. wand-contiguous/wand-global are the
// selection-producing counterparts of fill/replace (see tools/magicWandTool.js) —
// same one-tap-per-action shape, but they call onSelectionChange with a selection
// instead of onStrokeCommitted with a cell patch, since neither mutates cells.
// col-select is NOT discrete — unlike a single-tap wand pick, the selected column
// is meant to follow the pointer while held down (see startColSelectDrag/
// continueColSelectDrag below), so it gets its own drag-tracking branch just like
// 'select'/'paste'/'move', rather than firing once on pointerdown. paste is no
// longer a discrete tap-to-stamp action either — it's a drag-to-position preview
// (see startPastePreviewDrag/continuePastePreviewDrag below). eyedropper is its
// own branch, not part of DISCRETE_TOOLS — unlike fill/replace it never mutates
// cells, so it has no patch to commit through onStrokeCommitted. move is a direct
// drag like draw/erase (mutates cells live, commits one patch at the end) rather
// than a position-then-confirm flow like paste — see startMoveDrag/continueMoveDrag
// below.
const STROKE_TOOLS = new Set(['draw', 'erase']);
const DISCRETE_TOOLS = new Set(['fill', 'replace', 'wand-contiguous', 'wand-global']);

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

// Angle (radians) of the line from a to b, in canvas-local px — used for the
// two-finger twist-to-rotate-photo gesture, mirroring how distance()/midpoint()
// already feed the pinch-to-zoom/scale gesture.
function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Smallest signed angular difference from `from` to `to` (radians), wrapped
// into [-π, π] — needed because pinchBaseline.angle is recomputed fresh every
// move event (see the two-pointer branch below), so a raw subtraction would
// jump by ~2π whenever the touch pair's angle crosses the atan2 branch cut.
function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// 0 in the "safe" interior; ramps up to EDGE_PAN_MAX_SPEED_PX_PER_FRAME right at the
// margin and stays there for anything further past the edge, so a pointer that's
// left the canvas entirely (pointer capture still delivers move events for it)
// doesn't accelerate without bound the further off-canvas it goes.
function edgePanDelta(pos, size) {
  if (pos < EDGE_PAN_MARGIN_PX) {
    const depth = Math.min(EDGE_PAN_MARGIN_PX, EDGE_PAN_MARGIN_PX - pos);
    return -(depth / EDGE_PAN_MARGIN_PX) * EDGE_PAN_MAX_SPEED_PX_PER_FRAME;
  }
  if (pos > size - EDGE_PAN_MARGIN_PX) {
    const depth = Math.min(EDGE_PAN_MARGIN_PX, pos - (size - EDGE_PAN_MARGIN_PX));
    return (depth / EDGE_PAN_MARGIN_PX) * EDGE_PAN_MAX_SPEED_PX_PER_FRAME;
  }
  return 0;
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
  getDisplayCells,
  getTool,
  getColorId,
  getClipboard,
  getPhotoTrace,
  getSelection,
  getMovePreview,
  getPreserveStaggerOnShift,
  onViewportChange,
  onCellsChanged,
  onStrokeCommitted,
  onSelectionChange,
  onPhotoTraceChange,
  onPastePreviewChange,
  onMovePreviewChange,
  onColorPicked,
}) {
  const pointers = new Map(); // pointerId -> { x, y, pointerType }
  let pinchBaseline = null; // { midpoint, distance } in canvas-local px
  let mouseDrag = null; // { x, y } in canvas-local px
  let drawStroke = null; // { pointerId, lastWorld: { xMm, yMm }, patch } or null
  let selectionDrag = null; // { pointerId, startRow, startCol, moved, tapOutsideExisting } or null
  let photoDrag = null; // { pointerId, x, y } in canvas-local px, or null
  let pasteDrag = null; // { pointerId } or null
  // Move is now a position-then-confirm flow like paste (see appState.movePreview,
  // editorView.js) — this only tracks THIS drag session's own pointer-start
  // reference, never touches cells directly. startDeltaRow/startDeltaCol are the
  // preview's already-accumulated offset at the moment this drag began, so a
  // second separate drag (before Confirm) continues adding on top of the first
  // rather than resetting it.
  let moveDrag = null; // { pointerId, startRow, startCol, startDeltaRow, startDeltaCol } or null
  let colSelectDrag = null; // { pointerId } or null — see startColSelectDrag/continueColSelectDrag
  let edgePanRafId = null; // rAF handle for the select/paste/col-select edge auto-pan loop, or null
  let pendingTouchStart = null; // { pointerId, point, timerId } or null — see TOUCH_DRAW_DISAMBIGUATION_MS
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
    const engine = resolveGridEngine(gridParams.stitchType);
    const hit = engine.cellAtPoint(worldPoint.xMm, worldPoint.yMm, gridParams);
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

  // One-shot action for fill/replace/magic-wand: hit-tests the tapped cell and
  // applies the active discrete tool. fill/replace mutate cells and commit the
  // result as a single undo-able patch via the same onStrokeCommitted path draw/
  // erase strokes already use; wand-contiguous/wand-global instead resolve a
  // masked selection (see tools/magicWandTool.js) and report it via
  // onSelectionChange, exactly like a marquee drag would — they never touch
  // cells, so there's nothing to commit.
  function performDiscreteAction(point) {
    const worldPoint = screenToWorld(point.x, point.y, viewport);
    const gridParams = getGridParams();
    if (!gridParams) return;
    const engine = resolveGridEngine(gridParams.stitchType);
    const hit = engine.cellAtPoint(worldPoint.xMm, worldPoint.yMm, gridParams);
    if (!hit) return;
    const cells = getCells();
    const tool = getTool();
    let patch;
    if (tool === 'fill') {
      patch = applyFill(cells, hit.row, hit.col, getColorId(), gridParams.rows, gridParams.cols, (r, c) => engine.neighbors(r, c, gridParams));
    } else if (tool === 'replace') {
      const source = cells.get(cellKey(hit.row, hit.col));
      if (!source) return; // tapped an empty cell — nothing to replace
      patch = applyColorReplace(cells, source.colorId, getColorId());
    } else if (tool === 'wand-contiguous') {
      const selection = selectWandContiguous(cells, hit.row, hit.col, gridParams.rows, gridParams.cols, (r, c) => engine.neighbors(r, c, gridParams));
      onSelectionChange(selection);
      return;
    } else if (tool === 'wand-global') {
      const source = cells.get(cellKey(hit.row, hit.col));
      if (!source) return; // tapped an empty cell — nothing to select
      onSelectionChange(selectWandGlobal(cells, source.colorId));
      return;
    }
    if (patch && patch.length > 0) {
      onCellsChanged();
      onStrokeCommitted(patch);
    }
  }

  // One-shot action for the eyedropper: hit-tests the tapped cell and, if it's
  // occupied with a real color, reports it via onColorPicked — never touches
  // cells, so there's nothing to commit through onStrokeCommitted. A tapped cell
  // that's empty, or occupied but unassigned (colorId: null, see Phase 6's
  // shared-shape colorways), has no color to pick and is a silent no-op either way.
  // Deliberately samples getDisplayCells() (the composited, visible-layers-only
  // view — see .work/feature-layers-plan.md), not getCells() (the active layer
  // alone): a user picking a color naturally means "the color I'm looking at,"
  // which could visually belong to a different, non-active layer — matching
  // Photoshop's own default eyedropper behavior (samples the merged image).
  // Every other tool keeps using getCells() (the active layer) unchanged.
  function performEyedropperAction(point) {
    const worldPoint = screenToWorld(point.x, point.y, viewport);
    const gridParams = getGridParams();
    if (!gridParams) return;
    const engine = resolveGridEngine(gridParams.stitchType);
    const hit = engine.cellAtPoint(worldPoint.xMm, worldPoint.yMm, gridParams);
    if (!hit) return;
    const cell = getDisplayCells().get(cellKey(hit.row, hit.col));
    if (!cell || cell.colorId == null) return;
    onColorPicked(cell.colorId);
  }

  function clampedHit(point) {
    const gridParams = getGridParams();
    if (!gridParams) return null;
    const worldPoint = screenToWorld(point.x, point.y, viewport);
    const engine = resolveGridEngine(gridParams.stitchType);
    return engine.cellAtPointClamped(worldPoint.xMm, worldPoint.yMm, gridParams);
  }

  // Unlike clampedHit (used for selection, which only ever marks cells that
  // already exist), a paste's anchor is allowed to land negative or past
  // rows/cols — its clipboard content can legitimately hang off any edge of the
  // grid while being positioned, not just the far/right-bottom edge that
  // clampedHit's upper bound happens to still allow content to overhang past.
  function unboundedHit(point) {
    const gridParams = getGridParams();
    if (!gridParams) return null;
    const worldPoint = screenToWorld(point.x, point.y, viewport);
    const engine = resolveGridEngine(gridParams.stitchType);
    return engine.cellAtPointUnbounded(worldPoint.xMm, worldPoint.yMm, gridParams);
  }

  // Resolves a raw column delta against grid/peyote.js's resolveColShift when
  // the "preserve pattern" preference is on — never restricts which column
  // delta is allowed (unlike an earlier version of this preference, which
  // snapped to even deltas only and silently skipped every other column);
  // instead reports whether per-cell row compensation is needed alongside the
  // (possibly dropCount-snapped) column delta itself, leaving the actual
  // per-cell application to the caller (colShiftRowDelta, applied at render
  // time and at the eventual commit — see editorView.js/pastePreviewOverlay.js/
  // movePreviewOverlay.js, all of which share this same shape). When the
  // preference is off, or square stitch (no stagger concept to protect),
  // returns the raw delta with no compensation needed at all. Shared by both
  // Move (continueMoveDrag, relative to the drag's own accumulated delta) and
  // Paste (resolvePasteAnchorCol below, relative to the clipboard's own fixed
  // origin column, not wherever a particular paste session happened to start).
  function resolveColShiftIfEnabled(rawDeltaCol, gridParams) {
    if (!getPreserveStaggerOnShift() || !gridParams || gridParams.stitchType === 'square') {
      return { deltaCol: rawDeltaCol, needsRowCompensation: false };
    }
    return resolveColShift(rawDeltaCol, gridParams.dropCount ?? 1);
  }

  // A plain tap (pointerdown -> pointerup with no movement) that lands outside the
  // selection already active when the gesture began clears it instead of leaving
  // the stray 1-cell box startSelectionDrag shows for live drag feedback — tracked
  // here and resolved in handlePointerEnd, since "did this end up being a tap" is
  // only knowable once the gesture is over.
  function startSelectionDrag(pointerId, point) {
    const hit = clampedHit(point);
    if (!hit) return;
    const existing = getSelection();
    const tapOutsideExisting = !!existing && (
      hit.row < existing.rowStart || hit.row > existing.rowEnd ||
      hit.col < existing.colStart || hit.col > existing.colEnd
    );
    selectionDrag = { pointerId, startRow: hit.row, startCol: hit.col, moved: false, tapOutsideExisting };
    onSelectionChange(normalizeSelection(hit, hit));
    startEdgePanLoop();
  }

  function continueSelectionDrag(point) {
    const hit = clampedHit(point);
    if (!hit) return;
    if (hit.row !== selectionDrag.startRow || hit.col !== selectionDrag.startCol) selectionDrag.moved = true;
    onSelectionChange(normalizeSelection({ row: selectionDrag.startRow, col: selectionDrag.startCol }, hit));
  }

  // Column select always selects a full-height, one-column-wide rectangle — no
  // two-point range to track (unlike startSelectionDrag's marquee), so every
  // update just re-resolves the column currently under the pointer, following
  // it left/right as the drag continues rather than staying pinned to wherever
  // the gesture started.
  function colSelectionAt(hit, gridParams) {
    return { rowStart: 0, rowEnd: gridParams.rows - 1, colStart: hit.col, colEnd: hit.col };
  }

  function startColSelectDrag(pointerId, point) {
    const hit = clampedHit(point);
    const gridParams = getGridParams();
    if (!hit || !gridParams) return;
    colSelectDrag = { pointerId };
    onSelectionChange(colSelectionAt(hit, gridParams));
    startEdgePanLoop();
  }

  function continueColSelectDrag(point) {
    const hit = clampedHit(point);
    const gridParams = getGridParams();
    if (!hit || !gridParams) return;
    onSelectionChange(colSelectionAt(hit, gridParams));
  }

  // Resolves a raw hit-tested anchor column against the clipboard's own true
  // origin column (appState.clipboard.originCol — the absolute column the
  // content was actually copied FROM, set once in cutCopyTool.js's
  // buildClipboard/handleSelectionRotate90 and fixed for the clipboard's whole
  // lifetime) rather than wherever a particular paste session happened to
  // start — that's what keeps compensation correct across re-entering Paste
  // from a different selection, or with none active at all (see
  // buildClipboard's own comment for why the old preview-relative version was
  // wrong). Returns both the resolved anchorCol (dropCount-snapped, only
  // relevant for dropCount>1) and whether the clipboard's own cells need
  // per-cell row compensation from that origin — both get stored on
  // appState.pastePreview so the ghost overlay and the eventual Confirm can
  // apply the identical compensation without recomputing anything. Falls back
  // to no compensation when the clipboard has no known origin yet (a freshly
  // rotated clipboard, before handleSelectionRotate90 stamps one on) or the
  // preference is off/square stitch.
  function resolvePasteAnchorCol(rawCol, gridParams) {
    const originCol = getClipboard()?.originCol;
    if (originCol == null) return { anchorCol: rawCol, needsRowCompensation: false };
    const { deltaCol, needsRowCompensation } = resolveColShiftIfEnabled(rawCol - originCol, gridParams);
    return { anchorCol: originCol + deltaCol, needsRowCompensation };
  }

  // Direct hit-testing, not a relative pixel-delta drag: on every move, the anchor
  // snaps to whichever cell is currently under the pointer, treating that cell as
  // the clipboard footprint's top-left corner — same approach clampedHit already
  // gives selection-drag, and consistent with how fill/replace hit-test directly
  // rather than tracking relative motion. Uses unboundedHit, not clampedHit — the
  // anchor is allowed to land off any edge of the grid (see unboundedHit's own
  // comment), not just clamped-in-bounds like a selection has to be.
  function startPastePreviewDrag(pointerId, point) {
    if (!getClipboard()) return;
    const hit = unboundedHit(point);
    if (!hit) return;
    pasteDrag = { pointerId };
    onPastePreviewChange({ anchorRow: hit.row, ...resolvePasteAnchorCol(hit.col, getGridParams()) });
    startEdgePanLoop();
  }

  function continuePastePreviewDrag(point) {
    const hit = unboundedHit(point);
    if (!hit) return;
    onPastePreviewChange({ anchorRow: hit.row, ...resolvePasteAnchorCol(hit.col, getGridParams()) });
  }

  // Move is now a position-then-confirm flow like paste (appState.movePreview,
  // editorView.js's handleToolMove/handleMoveConfirm/handleMoveCancel) — this
  // never touches appState.cells at all, only reports an accumulated
  // (deltaRow, deltaCol) via onMovePreviewChange for editorView.js to render as
  // a ghost and eventually apply via applyMove at Confirm. getMovePreview()
  // returning null means there's nothing to move (the entry point that creates
  // a preview already guards the "empty layer/empty selection" case), so this
  // is a no-op rather than something callers need to check themselves. Uses
  // unboundedHit, not clampedHit, so content can be dragged fully off any edge
  // while positioning, same as paste — it's simply clipped at whichever cells
  // land outside the grid, at Confirm time.
  function startMoveDrag(pointerId, point) {
    const preview = getMovePreview();
    if (!preview) return;
    const hit = unboundedHit(point);
    if (!hit) return;
    moveDrag = { pointerId, startRow: hit.row, startCol: hit.col, startDeltaRow: preview.deltaRow, startDeltaCol: preview.deltaCol };
    startEdgePanLoop();
  }

  function continueMoveDrag(point) {
    const hit = unboundedHit(point);
    if (!hit) return;
    const gridParams = getGridParams();
    if (!gridParams) return;
    const deltaRow = moveDrag.startDeltaRow + (hit.row - moveDrag.startRow);
    const rawDeltaCol = moveDrag.startDeltaCol + (hit.col - moveDrag.startCol);
    onMovePreviewChange({ deltaRow, ...resolveColShiftIfEnabled(rawDeltaCol, gridParams) });
  }

  // Auto-pans the viewport while a select/paste drag's pointer sits near or past
  // the canvas edge, so the drag can keep extending even once the physical mouse/
  // finger has nowhere further to go. Runs as its own rAF loop tied to the drag's
  // lifetime (not off pointermove) since it needs to keep panning even while the
  // pointer holds still right at the edge.
  function tickEdgePan() {
    const activeDrag = selectionDrag || colSelectDrag || pasteDrag || moveDrag;
    if (!activeDrag) {
      edgePanRafId = null;
      return;
    }
    edgePanRafId = requestAnimationFrame(tickEdgePan);
    const last = pointers.get(activeDrag.pointerId);
    if (!last) return;
    const rect = canvas.getBoundingClientRect();
    const dxPx = edgePanDelta(last.x, rect.width);
    const dyPx = edgePanDelta(last.y, rect.height);
    if (dxPx === 0 && dyPx === 0) return;
    viewport.originXmm += dxPx / viewport.scalePxPerMm;
    viewport.originYmm += dyPx / viewport.scalePxPerMm;
    onViewportChange();
    if (selectionDrag) continueSelectionDrag(last);
    else if (colSelectDrag) continueColSelectDrag(last);
    else if (pasteDrag) continuePastePreviewDrag(last);
    else if (moveDrag) continueMoveDrag(last);
  }

  function startEdgePanLoop() {
    if (edgePanRafId != null) return;
    edgePanRafId = requestAnimationFrame(tickEdgePan);
  }

  function stopEdgePanLoop() {
    if (edgePanRafId != null) {
      cancelAnimationFrame(edgePanRafId);
      edgePanRafId = null;
    }
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

  // Runs the deferred action from schedulePendingTouchStart/resolvePendingTouchStart:
  // starts it at the original down point (so a precise tap still lands exactly
  // where the finger touched down), then — if the finger has since moved on to
  // latestPoint during the disambiguation delay — feeds that movement through
  // whichever continue* function the start just armed, so a fast touch-drag that
  // begins during the delay window doesn't lose its first few pixels.
  function activatePendingTouchStart(pointerId, downPoint, latestPoint) {
    handleSingleInteractionStart(pointerId, downPoint);
    if (!latestPoint || (latestPoint.x === downPoint.x && latestPoint.y === downPoint.y)) return;
    if (drawStroke && drawStroke.pointerId === pointerId) continueDrawStroke(latestPoint);
    else if (selectionDrag && selectionDrag.pointerId === pointerId) continueSelectionDrag(latestPoint);
    else if (colSelectDrag && colSelectDrag.pointerId === pointerId) continueColSelectDrag(latestPoint);
    else if (photoDrag && photoDrag.pointerId === pointerId) continuePhotoDrag(latestPoint);
    else if (pasteDrag && pasteDrag.pointerId === pointerId) continuePastePreviewDrag(latestPoint);
    else if (moveDrag && moveDrag.pointerId === pointerId) continueMoveDrag(latestPoint);
  }

  function schedulePendingTouchStart(pointerId, point) {
    pendingTouchStart = {
      pointerId,
      point,
      timerId: setTimeout(() => {
        pendingTouchStart = null;
        activatePendingTouchStart(pointerId, point, pointers.get(pointerId));
      }, TOUCH_DRAW_DISAMBIGUATION_MS),
    };
  }

  // A second finger landing resolves the ambiguity as a pinch, not a tap — drops
  // the pending action outright rather than running it, so a pinch-zoom's first
  // finger never leaves a stray bead behind.
  function cancelPendingTouchStart() {
    if (pendingTouchStart) {
      clearTimeout(pendingTouchStart.timerId);
      pendingTouchStart = null;
    }
  }

  // Resolves a pending single-finger action at pointerup/pointercancel, ahead of
  // when the disambiguation timer would otherwise fire. pointerup (a tap/drag
  // faster than the delay) still runs the action; pointercancel (iOS took the
  // gesture for itself — the bottom-edge swipe-to-exit gesture, in particular)
  // drops it entirely, which is what stops that gesture from placing a bead.
  function resolvePendingTouchStart(pointerId, wasCancelled) {
    if (!pendingTouchStart || pendingTouchStart.pointerId !== pointerId) return;
    clearTimeout(pendingTouchStart.timerId);
    const { point } = pendingTouchStart;
    pendingTouchStart = null;
    if (!wasCancelled) activatePendingTouchStart(pointerId, point, pointers.get(pointerId));
  }

  // Routes a single-touch/pen tap or a mouse-left-drag start by the currently
  // active tool. draw/erase keep the existing continuous-stroke path; fill/
  // replace fire once and don't set drawStroke (so handlePointerMove's stroke
  // branch never matches for them); select starts a marquee drag; move-photo
  // starts a photo-translate drag; paste starts a preview-positioning drag.
  function handleSingleInteractionStart(pointerId, point) {
    const tool = getTool();
    if (STROKE_TOOLS.has(tool)) {
      if (!drawStroke) startDrawStroke(pointerId, point);
    } else if (DISCRETE_TOOLS.has(tool)) {
      performDiscreteAction(point);
    } else if (tool === 'eyedropper') {
      performEyedropperAction(point);
    } else if (tool === 'select') {
      startSelectionDrag(pointerId, point);
    } else if (tool === 'col-select') {
      startColSelectDrag(pointerId, point);
    } else if (tool === 'move-photo') {
      startPhotoDrag(pointerId, point);
    } else if (tool === 'paste') {
      startPastePreviewDrag(pointerId, point);
    } else if (tool === 'move') {
      startMoveDrag(pointerId, point);
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
        cancelPendingTouchStart(); // resolve the first finger's ambiguity as a pinch, not a tap
        commitStroke(); // second finger landed — hand off to pan/zoom, not a stray bead
        selectionDrag = null; // last onSelectionChange already left the selection at its value
        colSelectDrag = null; // last onSelectionChange already left the selection at its value
        photoDrag = null; // hand off to pinch-scale instead
        pasteDrag = null; // last onPastePreviewChange already left the preview at its value
        moveDrag = null; // last onMovePreviewChange already left the preview at its value — nothing was ever mutated to commit
        stopEdgePanLoop();
      } else if (touchCount === 1) {
        // Pen (Apple Pencil) skips the disambiguation delay — it can't be one
        // finger of a pinch and doesn't trigger iOS system swipe gestures, so it
        // stays instant, which matters since it's the primary drawing tool.
        if (e.pointerType === 'touch') {
          schedulePendingTouchStart(e.pointerId, point);
        } else {
          handleSingleInteractionStart(e.pointerId, point);
        }
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
      const angle = angleBetween(touchPointers[0], touchPointers[1]);
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
        // Rotation (twist) only applies to the photo — the viewport itself has
        // no rotation concept (whole-canvas rotation is a discrete 90° action,
        // not a pinch gesture).
        if (photoTrace) {
          Object.assign(photoTrace, scalePhotoToAnchor(photoTrace, anchorWorld, scaleFactor));
          const rotateDeltaDeg = (angleDelta(pinchBaseline.angle, angle) * 180) / Math.PI;
          photoTrace.rotationDeg = normalizeRotationDeg((photoTrace.rotationDeg ?? 0) + rotateDeltaDeg);
          onPhotoTraceChange();
        } else {
          zoomToAnchor(viewport, anchorWorld, mid, scaleFactor);
          onViewportChange();
        }
      }
      pinchBaseline = { midpoint: mid, distance: dist, angle };
    } else if (drawStroke && drawStroke.pointerId === e.pointerId) {
      continueDrawStroke(point);
    } else if (selectionDrag && selectionDrag.pointerId === e.pointerId) {
      continueSelectionDrag(point);
    } else if (colSelectDrag && colSelectDrag.pointerId === e.pointerId) {
      continueColSelectDrag(point);
    } else if (photoDrag && photoDrag.pointerId === e.pointerId) {
      continuePhotoDrag(point);
    } else if (pasteDrag && pasteDrag.pointerId === e.pointerId) {
      continuePastePreviewDrag(point);
    } else if (moveDrag && moveDrag.pointerId === e.pointerId) {
      continueMoveDrag(point);
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
    resolvePendingTouchStart(e.pointerId, e.type === 'pointercancel');
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (drawStroke && drawStroke.pointerId === e.pointerId) {
      commitStroke();
    }
    if (selectionDrag && selectionDrag.pointerId === e.pointerId) {
      // A tap (never moved) that landed outside whatever selection was already
      // active clears it, instead of leaving the stray 1-cell box startSelectionDrag
      // shows for live drag feedback.
      if (!selectionDrag.moved && selectionDrag.tapOutsideExisting) {
        onSelectionChange(null);
      }
      selectionDrag = null; // otherwise last onSelectionChange already left the selection at its final value
      stopEdgePanLoop();
    }
    if (colSelectDrag && colSelectDrag.pointerId === e.pointerId) {
      colSelectDrag = null; // last onSelectionChange already left the selection at its final value
      stopEdgePanLoop();
    }
    if (photoDrag && photoDrag.pointerId === e.pointerId) {
      photoDrag = null;
    }
    if (pasteDrag && pasteDrag.pointerId === e.pointerId) {
      pasteDrag = null; // preview itself (appState.pastePreview) persists until Confirm/Cancel
      stopEdgePanLoop();
    }
    if (moveDrag && moveDrag.pointerId === e.pointerId) {
      moveDrag = null; // preview itself (appState.movePreview) persists until Confirm/Cancel
      stopEdgePanLoop();
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
    const photoTrace = getTool() === 'move-photo' ? getPhotoTrace() : null;
    if (photoTrace && e.shiftKey && !e.ctrlKey) {
      photoTrace.rotationDeg = normalizeRotationDeg(
        (photoTrace.rotationDeg ?? 0) + e.deltaY * WHEEL_ROTATE_SENSITIVITY_DEG
      );
      onPhotoTraceChange();
    } else if (e.ctrlKey) {
      const point = canvasPoint(e);
      const anchorWorld = screenToWorld(point.x, point.y, viewport);
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
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
