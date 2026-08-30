import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseNiceTickIntervalMm } from '../../render/rulerRenderer.js';
import { mmToInches, inchesToMm, MM_PER_INCH } from '../../units/convert.js';

const MIN_TICK_SPACING_PX = 40;

// pointerRouter.js clamps live pinch-zoom to [1, 150] px/mm (MIN/MAX_SCALE_PX_PER_MM) —
// fitViewportToGrid can still go below 1 for a very large pattern, so the low end
// here is deliberately outside that clamp; the high end matches it.
const REALISTIC_SCALES = [0.05, 0.2, 1, 2.5, 5, 10, 96 / 25.4 /* CSS_PX_PER_MM, ~3.78 */, 20, 100, 150];

test('chooseNiceTickIntervalMm (mm): produces on-screen spacing >= the 40px floor, and not absurdly sparse', () => {
  for (const scalePxPerMm of REALISTIC_SCALES) {
    const { intervalMm } = chooseNiceTickIntervalMm(scalePxPerMm, 'mm');
    const onScreenPx = intervalMm * scalePxPerMm;
    assert.ok(onScreenPx >= MIN_TICK_SPACING_PX - 1e-9, `scale ${scalePxPerMm}: ${onScreenPx}px < floor`);
    // A "nice" interval never needs more than a ~6.5x jump to clear the floor —
    // catches an interval that's needlessly sparse (labels far apart for no
    // reason). The multiplier is a little looser than a round 5x specifically
    // because the inches table's finest step (1/16in ≈ 1.59mm) is coarser than
    // the mm table's (1mm), so inches can land a bit further past the floor at
    // the same zoom — a real property of the two tables, not a bug.
    assert.ok(onScreenPx < MIN_TICK_SPACING_PX * 6.5, `scale ${scalePxPerMm}: ${onScreenPx}px is needlessly sparse`);
  }
});

test('chooseNiceTickIntervalMm (in): produces on-screen spacing >= the 40px floor, and not absurdly sparse', () => {
  for (const scalePxPerMm of REALISTIC_SCALES) {
    const { intervalMm } = chooseNiceTickIntervalMm(scalePxPerMm, 'in');
    const onScreenPx = intervalMm * scalePxPerMm;
    assert.ok(onScreenPx >= MIN_TICK_SPACING_PX - 1e-9, `scale ${scalePxPerMm}: ${onScreenPx}px < floor`);
    // See the mm test above for why the multiplier is looser than 5x — the
    // inches table's finest step (1/16in) is coarser than the mm table's (1mm).
    assert.ok(onScreenPx < MIN_TICK_SPACING_PX * 6.5, `scale ${scalePxPerMm}: ${onScreenPx}px is needlessly sparse`);
  }
});

test('chooseNiceTickIntervalMm: intervalUnit/intervalMm agree with the unit conversion', () => {
  const mmResult = chooseNiceTickIntervalMm(2.5, 'mm');
  assert.equal(mmResult.intervalUnit, mmResult.intervalMm);

  const inResult = chooseNiceTickIntervalMm(2.5, 'in');
  assert.ok(Math.abs(inResult.intervalMm - inchesToMm(inResult.intervalUnit)) < 1e-9);
});

test('chooseNiceTickIntervalMm: switching units at the same zoom changes spacing/labels, not the world position ticks are computed against', () => {
  // The function itself has no notion of "world position" (that's the caller's
  // job, anchoring at world (0,0) regardless of unit) — what this checks is that
  // unit only affects *which* values are nice, not some hidden origin shift.
  const scalePxPerMm = 5;
  const mmResult = chooseNiceTickIntervalMm(scalePxPerMm, 'mm');
  const inResult = chooseNiceTickIntervalMm(scalePxPerMm, 'in');
  assert.ok(mmResult.intervalMm > 0);
  assert.ok(inResult.intervalMm > 0);
  // Both are legitimately "nice" in their own unit, so they need not be equal —
  // but both must independently satisfy the same on-screen spacing floor.
  assert.ok(mmResult.intervalMm * scalePxPerMm >= MIN_TICK_SPACING_PX - 1e-9);
  assert.ok(inResult.intervalMm * scalePxPerMm >= MIN_TICK_SPACING_PX - 1e-9);
});

test('chooseNiceTickIntervalMm: extremely zoomed out still returns a finite, positive interval', () => {
  const { intervalMm, intervalUnit } = chooseNiceTickIntervalMm(0.001, 'mm');
  assert.ok(Number.isFinite(intervalMm) && intervalMm > 0);
  assert.ok(Number.isFinite(intervalUnit) && intervalUnit > 0);
  assert.ok(intervalMm * 0.001 >= MIN_TICK_SPACING_PX - 1e-9);
});

test('chooseNiceTickIntervalMm: extremely zoomed in returns the smallest table entry', () => {
  const mmResult = chooseNiceTickIntervalMm(1000, 'mm');
  assert.equal(mmResult.intervalUnit, 1);
  const inResult = chooseNiceTickIntervalMm(1000, 'in');
  assert.equal(inResult.intervalUnit, 1 / 16);
  assert.ok(Math.abs(inResult.intervalMm - MM_PER_INCH / 16) < 1e-9);
});
