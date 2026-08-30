// Canvas-drawn rulers flanking the pattern canvas (top + left), toggled by
// appState.showRuler — see .work/feature-ruler-rotation-viewmode-datefix-
// plan.md §1. Ticks are anchored at the pattern's own top-left corner (world
// mm (0,0)), not the viewport's origin, so panning/zooming slides the ruler
// exactly the way the beads slide.
//
// Two independent tick systems layer together: labeled "major" ticks (spaced
// via chooseNiceTickIntervalMm so labels never crowd each other) and unlabeled
// standard-ruler hash marks in between (every mm graduating to every 5mm/10mm,
// or every 1/16in graduating to 1/8, 1/4, 1/2, 1in) — a fixed real-world
// hierarchy, not derived from the zoom-adaptive major spacing. A hash-mark
// tier is only drawn once its own on-screen spacing clears a legibility floor
// (MIN_SUBTICK_SPACING_PX) — "too zoomed out to see adequately" per-tier, so
// finer tiers silently drop out first as the user zooms out, coarser ones
// following if it gets more extreme than that.
//
// Like canvasRenderer.js/selectionOverlay.js, the actual drawing has no
// node:test coverage (canvas-context-dependent) — but chooseNiceTickIntervalMm
// below is pure and gets real coverage, since it's the one piece of genuinely
// testable logic here.

import { worldToScreen } from './viewport.js';
import { mmToInches, inchesToMm, MM_PER_INCH } from '../units/convert.js';

const RULER_BACKGROUND = '#f2f2f2';
const TICK_COLOR = '#666';
const BORDER_COLOR = '#ccc';
const LABEL_COLOR = '#444';
const TICK_FONT = '10px sans-serif';
// The labeled major tick's own length — also doubles as the tallest hash-mark
// tier's length (every 10mm/1cm, or every whole inch), since a labeled tick
// and that tier's tick are the same "biggest mark" concept at that spacing.
const MAJOR_TICK_LENGTH_PX = 8;
// Ticks must land at least this many CSS px apart on screen — the standard
// "nice numbers" ruler algorithm: compute the raw interval needed for this
// spacing at the current zoom, then snap up to the next value in a fixed table.
const MIN_TICK_SPACING_PX = 40;
// A hash-mark tier whose ticks would land closer together than this reads as
// visual noise (or literal aliasing mush) rather than a mark — dropped
// entirely rather than drawn, per-tier, so the ruler degrades gracefully as
// the user zooms out instead of turning into a solid smear.
const MIN_SUBTICK_SPACING_PX = 5;

// "Nice" spacings in each unit's own domain — chosen in-unit (not in mm) so a
// tick's label is computed as `tickIndex * intervalUnit` directly, never by
// round-tripping a tick's mm position back through mm<->in conversion (which
// would reintroduce floating-point noise like 0.24999999999999997in).
const NICE_STEPS_MM = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const NICE_STEPS_IN = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10, 25, 50, 100, 250];

// Standard ruler hash-mark hierarchy, finest first, in world mm. Drawn in this
// order (shortest tier first) so a coarser tier's tick naturally overdraws a
// finer tier's tick wherever they coincide (every 5mm position is also a 1mm
// position, every 10mm position is also a 5mm and 1mm position) — no separate
// "is this index a multiple of" bookkeeping needed, the later/taller stroke
// just wins visually at that pixel column.
const MM_SUBTICKS = [
  { stepMm: 1, lengthPx: 3 },
  { stepMm: 5, lengthPx: 5 },
  { stepMm: 10, lengthPx: MAJOR_TICK_LENGTH_PX }, // 1cm
];
const IN_SUBTICKS = [
  { stepMm: MM_PER_INCH / 16, lengthPx: 3 },
  { stepMm: MM_PER_INCH / 8, lengthPx: 4 },
  { stepMm: MM_PER_INCH / 4, lengthPx: 5.5 },
  { stepMm: MM_PER_INCH / 2, lengthPx: 6.5 },
  { stepMm: MM_PER_INCH, lengthPx: MAJOR_TICK_LENGTH_PX },
];

// Picks a tick spacing such that labeled ticks land at least MIN_TICK_SPACING_PX
// apart on screen at the given zoom. Returns both the spacing in the caller's
// own display unit (for labels) and the same spacing converted to world mm
// (for screen-position math) — pure, no DOM.
export function chooseNiceTickIntervalMm(scalePxPerMm, unit) {
  const rawIntervalMm = MIN_TICK_SPACING_PX / scalePxPerMm;
  const rawIntervalUnit = unit === 'in' ? mmToInches(rawIntervalMm) : rawIntervalMm;
  const steps = unit === 'in' ? NICE_STEPS_IN : NICE_STEPS_MM;

  let intervalUnit = null;
  for (const candidate of steps) {
    if (candidate >= rawIntervalUnit) {
      intervalUnit = candidate;
      break;
    }
  }
  if (intervalUnit === null) {
    // Zoomed out further than the table covers — keep doubling the largest entry.
    intervalUnit = steps[steps.length - 1];
    while (intervalUnit < rawIntervalUnit) intervalUnit *= 2;
  }

  const intervalMm = unit === 'in' ? inchesToMm(intervalUnit) : intervalUnit;
  return { intervalUnit, intervalMm };
}

// Rounds away float noise (e.g. 24.999999999999996) without imposing a fixed
// decimal count — tick values are already "nice" numbers, so this just
// cleans up multiplication artifacts.
function roundForDisplay(value) {
  return Math.round(value * 1e6) / 1e6;
}

// Calls tickAt(mm, lengthPx) once per unlabeled hash-mark tick whose world mm
// position falls within [minMm, maxMm], for every tier that clears the
// legibility floor at the given zoom — shared between the top (x-axis) and
// left (y-axis) rulers, which differ only in which screen axis a tick lands on.
function forEachSubTick(minMm, maxMm, scalePxPerMm, unit, tickAt) {
  const tiers = unit === 'in' ? IN_SUBTICKS : MM_SUBTICKS;
  for (const tier of tiers) {
    if (tier.stepMm * scalePxPerMm < MIN_SUBTICK_SPACING_PX) continue;
    const firstIndex = Math.floor(minMm / tier.stepMm);
    const lastIndex = Math.ceil(maxMm / tier.stepMm);
    for (let i = firstIndex; i <= lastIndex; i++) {
      tickAt(i * tier.stepMm, tier.lengthPx);
    }
  }
}

export function drawRulerTop(ctx, cssWidth, cssHeight, viewport, unit) {
  ctx.save();
  ctx.fillStyle = RULER_BACKGROUND;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const leftMm = viewport.originXmm;
  const rightMm = viewport.originXmm + cssWidth / viewport.scalePxPerMm;

  ctx.strokeStyle = TICK_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  forEachSubTick(leftMm, rightMm, viewport.scalePxPerMm, unit, (mm, lengthPx) => {
    const x = Math.round(worldToScreen(mm, 0, viewport).xPx) + 0.5;
    ctx.moveTo(x, cssHeight - lengthPx);
    ctx.lineTo(x, cssHeight);
  });
  ctx.stroke();

  const { intervalUnit, intervalMm } = chooseNiceTickIntervalMm(viewport.scalePxPerMm, unit);
  const firstIndex = Math.floor(leftMm / intervalMm);
  const lastIndex = Math.ceil(rightMm / intervalMm);

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = TICK_FONT;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.beginPath();
  for (let i = firstIndex; i <= lastIndex; i++) {
    const mm = i * intervalMm;
    const { xPx } = worldToScreen(mm, 0, viewport);
    const x = Math.round(xPx) + 0.5;
    ctx.moveTo(x, cssHeight - MAJOR_TICK_LENGTH_PX);
    ctx.lineTo(x, cssHeight);
    ctx.fillText(String(roundForDisplay(i * intervalUnit)), xPx + 3, 2);
  }
  ctx.stroke();

  ctx.strokeStyle = BORDER_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, cssHeight - 0.5);
  ctx.lineTo(cssWidth, cssHeight - 0.5);
  ctx.stroke();
  ctx.restore();
}

export function drawRulerLeft(ctx, cssWidth, cssHeight, viewport, unit) {
  ctx.save();
  ctx.fillStyle = RULER_BACKGROUND;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const topMm = viewport.originYmm;
  const bottomMm = viewport.originYmm + cssHeight / viewport.scalePxPerMm;

  ctx.strokeStyle = TICK_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  forEachSubTick(topMm, bottomMm, viewport.scalePxPerMm, unit, (mm, lengthPx) => {
    const y = Math.round(worldToScreen(0, mm, viewport).yPx) + 0.5;
    ctx.moveTo(cssWidth - lengthPx, y);
    ctx.lineTo(cssWidth, y);
  });
  ctx.stroke();

  const { intervalUnit, intervalMm } = chooseNiceTickIntervalMm(viewport.scalePxPerMm, unit);
  const firstIndex = Math.floor(topMm / intervalMm);
  const lastIndex = Math.ceil(bottomMm / intervalMm);

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = TICK_FONT;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.beginPath();
  for (let i = firstIndex; i <= lastIndex; i++) {
    const mm = i * intervalMm;
    const { yPx } = worldToScreen(0, mm, viewport);
    const y = Math.round(yPx) + 0.5;
    ctx.moveTo(cssWidth - MAJOR_TICK_LENGTH_PX, y);
    ctx.lineTo(cssWidth, y);
    ctx.fillText(String(roundForDisplay(i * intervalUnit)), cssWidth - MAJOR_TICK_LENGTH_PX - 2, yPx - 1);
  }
  ctx.stroke();

  ctx.strokeStyle = BORDER_COLOR;
  ctx.beginPath();
  ctx.moveTo(cssWidth - 0.5, 0);
  ctx.lineTo(cssWidth - 0.5, cssHeight);
  ctx.stroke();
  ctx.restore();
}
