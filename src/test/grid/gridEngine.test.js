import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGridEngine, stitchTypeLabel, stitchTypeDetailLabel } from '../../grid/gridEngine.js';

const BEAD_W = 1.6;
const BEAD_H = 1.3;

test('resolveGridEngine: "square" resolves to an engine that produces no stagger', () => {
  const engine = resolveGridEngine('square');
  const p = { rows: 5, cols: 5, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H };
  const a = engine.cellOrigin(2, 3, p);
  const b = engine.cellOrigin(3, 3, p);
  assert.equal(a.xMm, b.xMm); // same column, no horizontal stagger between rows
});

test('resolveGridEngine: "peyote" and undefined/anything-else both resolve to the peyote engine (default/fallback)', () => {
  const p = { rows: 5, cols: 5, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H, cols_dummy: true };
  const peyoteExplicit = resolveGridEngine('peyote');
  const fallback = resolveGridEngine(undefined);
  assert.deepEqual(peyoteExplicit.cellOrigin(0, 0, p), fallback.cellOrigin(0, 0, p));
});

test('resolveGridEngine: both engines expose an identical function-name surface', () => {
  const peyote = resolveGridEngine('peyote');
  const square = resolveGridEngine('square');
  assert.deepEqual(Object.keys(peyote).sort(), Object.keys(square).sort());
});

test('resolveGridEngine: square engine generateGrid bounding box has no half-bead overhang', () => {
  const engine = resolveGridEngine('square');
  const grid = engine.generateGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.boundingBoxMm.heightMm, 4 * BEAD_W);
});

test('resolveGridEngine: peyote engine generateGrid bounding box has the half-bead overhang', () => {
  const engine = resolveGridEngine('peyote');
  const grid = engine.generateGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.boundingBoxMm.heightMm, 4 * BEAD_W + BEAD_W / 2);
});

test('resolveGridEngine: square engine neighbors returns 4 cells, peyote engine returns 6', () => {
  const p = { rows: 10, cols: 10, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H };
  assert.equal(resolveGridEngine('square').neighbors(3, 3, p).length, 4);
  assert.equal(resolveGridEngine('peyote').neighbors(3, 3, p).length, 6);
});

test('resolveGridEngine: cellAtPoint/cellOrigin round-trip for both engines', () => {
  const p = { rows: 10, cols: 10, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H, staggerFlipped: false };
  for (const stitchType of ['peyote', 'square']) {
    const engine = resolveGridEngine(stitchType);
    const origin = engine.cellOrigin(4, 5, p);
    const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
    const hit = engine.cellAtPoint(point.xMm, point.yMm, p);
    assert.deepEqual(hit, { row: 4, col: 5 }, `mismatch for stitchType ${stitchType}`);
  }
});

// dropCount threading (.work/feature-multi-drop-peyote-plan.md) — peyoteEngine
// wrappers pass p.dropCount through; squareEngine has no dropCount concept at
// all (its underlying functions never gained the parameter), so a dropCount on
// its gridParams is simply never read.

test('resolveGridEngine: peyote engine threads p.dropCount through cellOrigin (same-group columns share yMm)', () => {
  const p = { rows: 5, cols: 10, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H, staggerFlipped: false, dropCount: 2 };
  const engine = resolveGridEngine('peyote');
  const a = engine.cellOrigin(0, 0, p);
  const b = engine.cellOrigin(0, 1, p);
  assert.equal(a.yMm, b.yMm); // same drop group (0)
});

test('resolveGridEngine: peyote engine cellAtPoint/cellOrigin round-trip with p.dropCount set', () => {
  const p = { rows: 10, cols: 10, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H, staggerFlipped: false, dropCount: 3 };
  const engine = resolveGridEngine('peyote');
  const origin = engine.cellOrigin(4, 5, p);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  const hit = engine.cellAtPoint(point.xMm, point.yMm, p);
  assert.deepEqual(hit, { row: 4, col: 5 });
});

test('resolveGridEngine: peyote engine neighbors treats a same-group pair as adjacent with p.dropCount set', () => {
  const p = { rows: 10, cols: 10, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H, staggerFlipped: false, dropCount: 2 };
  const engine = resolveGridEngine('peyote');
  const neighbors = engine.neighbors(3, 0, p);
  assert.ok(neighbors.some(([r, c]) => r === 3 && c === 1));
});

test('resolveGridEngine: square engine ignores dropCount entirely (present on gridParams but never read)', () => {
  const withDropCount = { rows: 5, cols: 5, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H, dropCount: 3 };
  const withoutDropCount = { rows: 5, cols: 5, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H };
  const engine = resolveGridEngine('square');
  assert.deepEqual(engine.cellOrigin(2, 3, withDropCount), engine.cellOrigin(2, 3, withoutDropCount));
  assert.equal(engine.neighbors(3, 3, withDropCount).length, 4);
});

test('stitchTypeDetailLabel: 1-drop peyote is unlabeled, matching bare stitchTypeLabel', () => {
  assert.equal(stitchTypeDetailLabel('peyote', 1), stitchTypeLabel('peyote'));
});

test('stitchTypeDetailLabel: N-drop peyote appends a "(N-Drop)" suffix', () => {
  assert.equal(stitchTypeDetailLabel('peyote', 2), 'Peyote (2-Drop)');
  assert.equal(stitchTypeDetailLabel('peyote', 3), 'Peyote (3-Drop)');
});

test('stitchTypeDetailLabel: square stitch ignores dropCount entirely, even if it were somehow > 1', () => {
  assert.equal(stitchTypeDetailLabel('square', 1), stitchTypeLabel('square'));
  assert.equal(stitchTypeDetailLabel('square', 2), stitchTypeLabel('square'));
});

test('stitchTypeDetailLabel: dropCount undefined behaves like 1-drop (no suffix)', () => {
  assert.equal(stitchTypeDetailLabel('peyote', undefined), stitchTypeLabel('peyote'));
});
