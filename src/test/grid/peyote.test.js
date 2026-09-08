import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peyoteCellOriginMm, generatePeyoteGrid, peyoteCellAtPoint, peyoteCellAtPointClamped, peyoteCellAtPointUnbounded, peyoteNeighbors, isRaised } from '../../grid/peyote.js';

const BEAD_W = 1.6;
const BEAD_H = 1.3;

// row = which physical stitching pass (height-driving); col = a bead's position
// along that pass (width-driving) — see .work/refactor-row-col-axis-naming-plan.md.
// Most of these tests use an even COLS (10), but isRaised depends only on col's own
// parity, never on COLS itself (see peyote.js's isRaised comment — resize-stability
// matters more than any external convention) — raised is simply "col is odd," for
// any COLS, even or odd. The odd-COLS cases below exist to confirm the rule really
// is COLS-independent, not to cover separate cols-relative behavior.
const COLS = 10;

test('peyoteCellOriginMm: first cell (row 0, col 0) is offset by half a bead width (col 0 is recessed for an even COLS)', () => {
  assert.deepEqual(peyoteCellOriginMm(0, 0, BEAD_W, BEAD_H, COLS), { xMm: 0, yMm: BEAD_W / 2 });
});

test('peyoteCellOriginMm: even col is offset by half a bead width', () => {
  const origin = peyoteCellOriginMm(3, 2, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, 2 * BEAD_H);
  assert.equal(origin.yMm, 3 * BEAD_W + BEAD_W / 2);
});

test('peyoteCellOriginMm: odd col has no half-width offset', () => {
  const origin = peyoteCellOriginMm(0, 1, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, BEAD_H);
  assert.equal(origin.yMm, 0);
});

test('peyoteCellOriginMm: even col row offset stacks with half-width offset', () => {
  const origin = peyoteCellOriginMm(2, 4, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, 4 * BEAD_H);
  assert.equal(origin.yMm, 2 * BEAD_W + BEAD_W / 2);
});

test('peyoteCellOriginMm: negative even col still gets the half-width offset (JS % keeps the sign of -2, which would otherwise skip it)', () => {
  const origin = peyoteCellOriginMm(0, -2, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, -2 * BEAD_H);
  assert.equal(origin.yMm, BEAD_W / 2);
});

test('peyoteCellOriginMm: negative odd col has no offset, same as a positive odd col', () => {
  const origin = peyoteCellOriginMm(0, -1, BEAD_W, BEAD_H, COLS);
  assert.equal(origin.xMm, -1 * BEAD_H);
  assert.equal(origin.yMm, 0);
});

// Regression for the resize-stability bug found via real user reports: growing/shrinking
// columns (which changes COLS) used to silently re-flip the raised/recessed rendering for
// every cell, including ones that never moved, whenever the resize changed COLS' own
// parity — because isRaised used to be pinned relative to (cols - 1). These cases confirm
// isRaised for an odd COLS is identical to what a plain col-parity rule gives regardless of
// COLS, so a cell's rendering can no longer depend on the total col count.
test('peyoteCellOriginMm: for an odd COLS, the last col (cols-1) is recessed (col parity alone, independent of COLS)', () => {
  const oddCols = 55;
  const lastCol = oddCols - 1; // 54, even -- recessed under the col-parity-only rule
  const origin = peyoteCellOriginMm(0, lastCol, BEAD_W, BEAD_H, oddCols);
  assert.equal(origin.yMm, BEAD_W / 2); // recessed: even col
});

test('peyoteCellOriginMm: for an odd COLS, col 0 is recessed, same as it is for an even COLS', () => {
  const oddCols = 55;
  const origin = peyoteCellOriginMm(0, 0, BEAD_W, BEAD_H, oddCols);
  assert.equal(origin.yMm, BEAD_W / 2); // recessed: even col
});

test('peyoteCellOriginMm: for an odd COLS, col 1 is raised (col parity alone, independent of COLS)', () => {
  const oddCols = 55;
  const origin = peyoteCellOriginMm(0, 1, BEAD_W, BEAD_H, oddCols);
  assert.equal(origin.yMm, 0); // raised: odd col, no half-width offset
});

test('peyoteCellOriginMm: for an odd COLS, raised/recessed still strictly alternates col to col', () => {
  const oddCols = 55;
  for (let col = 0; col < oddCols - 1; col++) {
    const a = peyoteCellOriginMm(0, col, BEAD_W, BEAD_H, oddCols).yMm;
    const b = peyoteCellOriginMm(0, col + 1, BEAD_W, BEAD_H, oddCols).yMm;
    assert.notEqual(a, b, `cols ${col} and ${col + 1} should differ in stagger`);
  }
});

test('generatePeyoteGrid: bounding box for a 4x4 grid', () => {
  const grid = generatePeyoteGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.boundingBoxMm.widthMm, 4 * BEAD_H);
  assert.equal(grid.boundingBoxMm.heightMm, 4 * BEAD_W + BEAD_W / 2);
});

test('generatePeyoteGrid: passes through rows/cols/bead dimensions unchanged', () => {
  const grid = generatePeyoteGrid({ rows: 4, cols: 4, beadWidthMm: BEAD_W, beadHeightMm: BEAD_H });
  assert.equal(grid.rows, 4);
  assert.equal(grid.cols, 4);
  assert.equal(grid.beadWidthMm, BEAD_W);
  assert.equal(grid.beadHeightMm, BEAD_H);
});

test('peyoteCellAtPoint: round-trips against peyoteCellOriginMm for every cell in a sample grid (even cols)', () => {
  const rows = 10;
  const cols = 10;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const origin = peyoteCellOriginMm(row, col, BEAD_W, BEAD_H, cols);
      // Nudge toward the cell's center so we're not testing exact-boundary rounding.
      const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
      const hit = peyoteCellAtPoint(point.xMm, point.yMm, BEAD_W, BEAD_H, rows, cols);
      assert.deepEqual(hit, { row, col }, `mismatch at row ${row}, col ${col}`);
    }
  }
});

test('peyoteCellAtPoint: round-trips against peyoteCellOriginMm for every cell in a sample grid (odd cols)', () => {
  const rows = 10;
  const cols = 11;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const origin = peyoteCellOriginMm(row, col, BEAD_W, BEAD_H, cols);
      const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
      const hit = peyoteCellAtPoint(point.xMm, point.yMm, BEAD_W, BEAD_H, rows, cols);
      assert.deepEqual(hit, { row, col }, `mismatch at row ${row}, col ${col}`);
    }
  }
});

test('peyoteCellAtPoint: point above/left of the grid returns null', () => {
  assert.equal(peyoteCellAtPoint(-1, -1, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPoint: point past the last col returns null', () => {
  assert.equal(peyoteCellAtPoint(10 * BEAD_H + 1, 0, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPoint: point past the last row on a recessed col returns null', () => {
  // Col 2's usable y-range is shifted down by BEAD_W / 2 (recessed, for COLS=10), so a
  // point just past rows * beadWidthMm should fall outside — this is the case the offset
  // math could silently get wrong if col resolution didn't happen before row resolution.
  const xMm = 2 * BEAD_H + BEAD_H / 2; // inside col 2 (recessed for COLS=10)
  const yMm = 10 * BEAD_W + BEAD_W / 2 + 0.01;
  assert.equal(peyoteCellAtPoint(xMm, yMm, BEAD_W, BEAD_H, 10, 10), null);
});

test('peyoteCellAtPointClamped: matches peyoteCellAtPoint for an in-bounds point', () => {
  const origin = peyoteCellOriginMm(3, 4, BEAD_W, BEAD_H, 10);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(
    peyoteCellAtPointClamped(point.xMm, point.yMm, BEAD_W, BEAD_H, 10, 10),
    { row: 3, col: 4 }
  );
});

test('peyoteCellAtPointClamped: point above/left of the grid clamps to (0, 0)', () => {
  assert.deepEqual(peyoteCellAtPointClamped(-5, -5, BEAD_W, BEAD_H, 10, 10), { row: 0, col: 0 });
});

test('peyoteCellAtPointClamped: point past the last row/col clamps to (rows-1, cols-1)', () => {
  assert.deepEqual(
    peyoteCellAtPointClamped(100 * BEAD_H, 100 * BEAD_W, BEAD_W, BEAD_H, 10, 10),
    { row: 9, col: 9 }
  );
});

test('peyoteCellAtPointUnbounded: round-trips against peyoteCellOriginMm for an in-bounds cell, matching peyoteCellAtPoint', () => {
  const origin = peyoteCellOriginMm(3, 4, BEAD_W, BEAD_H, 10);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H, 10), { row: 3, col: 4 });
});

test('peyoteCellAtPointUnbounded: point above/left of the grid returns a genuinely negative row/col, not clamped to (0,0)', () => {
  // Nudge into the cell's interior (same convention the round-trip test above
  // uses) rather than an exact cell-boundary multiple, which is fragile to
  // floating-point rounding in either direction.
  const origin = peyoteCellOriginMm(-2, -2, BEAD_W, BEAD_H, 10);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H, 10), { row: -2, col: -2 });
});

test('peyoteCellAtPointUnbounded: point past the last row/col returns values past rows/cols, not clamped', () => {
  const origin = peyoteCellOriginMm(15, 14, BEAD_W, BEAD_H, 10);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H, 10), { row: 15, col: 14 });
});

test('peyoteCellAtPointUnbounded: negative-col parity offset matches the positive-col pattern (even cols offset, odd cols do not)', () => {
  // Col -1 is odd (no stagger); col -2 is even (stagger applies) — same
  // alternation as positive cols, not flipped by JS's sign-preserving % operator.
  const oddOrigin = peyoteCellOriginMm(0, -1, BEAD_W, BEAD_H, 10);
  const oddPoint = { xMm: oddOrigin.xMm + BEAD_H / 2, yMm: oddOrigin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(oddPoint.xMm, oddPoint.yMm, BEAD_W, BEAD_H, 10), { row: 0, col: -1 });

  const evenOrigin = peyoteCellOriginMm(0, -2, BEAD_W, BEAD_H, 10);
  const evenPoint = { xMm: evenOrigin.xMm + BEAD_H / 2, yMm: evenOrigin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(evenPoint.xMm, evenPoint.yMm, BEAD_W, BEAD_H, 10), { row: 0, col: -2 });
});

test('peyoteNeighbors: recessed col uses row/row+1 in adjacent cols', () => {
  const neighbors = peyoteNeighbors(3, 2, COLS); // col 2 is recessed for COLS=10
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[2, 2], [4, 2], [3, 1], [4, 1], [3, 3], [4, 3]].map(String).sort()
  );
});

test('peyoteNeighbors: raised col uses row-1/row in adjacent cols', () => {
  const neighbors = peyoteNeighbors(3, 1, COLS); // col 1 is raised for COLS=10
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[2, 1], [4, 1], [2, 0], [3, 0], [2, 2], [3, 2]].map(String).sort()
  );
});

// Regression confirming peyoteNeighbors' raised/recessed resolution is COLS-independent
// (col parity alone) just like peyoteCellOriginMm's dedicated tests above, or flood fill
// (fillTool.js) would compute adjacency against stale/wrong geometry for any hand-resized
// design with an odd COLS.
test('peyoteNeighbors: for an odd COLS, the last col (cols-1) is treated as recessed, not raised', () => {
  const oddCols = 55;
  const lastCol = oddCols - 1; // 54, even -- recessed under the col-parity-only rule
  const neighbors = peyoteNeighbors(3, lastCol, oddCols);
  // recessed uses row/row+1 in adjacent cols (same mapping as the COLS=10 "recessed col" case above)
  assert.deepEqual(
    neighbors.map(String).sort(),
    [[2, lastCol], [4, lastCol], [3, lastCol - 1], [4, lastCol - 1], [3, lastCol + 1], [4, lastCol + 1]].map(String).sort()
  );
});

test('peyoteNeighbors: returns exactly six cells with no duplicates', () => {
  for (const [row, col] of [[0, 0], [0, 1], [5, 5], [7, 4]]) {
    const neighbors = peyoteNeighbors(row, col, COLS);
    assert.equal(neighbors.length, 6);
    assert.equal(new Set(neighbors.map(String)).size, 6);
  }
});

test('peyoteNeighbors: adjacency is symmetric across a sample grid (even COLS)', () => {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      for (const [nRow, nCol] of peyoteNeighbors(row, col, COLS)) {
        const back = peyoteNeighbors(nRow, nCol, COLS).map(String);
        assert.ok(
          back.includes(String([row, col])),
          `(${nRow},${nCol})'s neighbors should include (${row},${col})`
        );
      }
    }
  }
});

test('peyoteNeighbors: adjacency is symmetric across a sample grid (odd COLS)', () => {
  const oddCols = 11;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < oddCols; col++) {
      for (const [nRow, nCol] of peyoteNeighbors(row, col, oddCols)) {
        const back = peyoteNeighbors(nRow, nCol, oddCols).map(String);
        assert.ok(
          back.includes(String([row, col])),
          `(${nRow},${nCol})'s neighbors should include (${row},${col})`
        );
      }
    }
  }
});

// `flipped` — a per-design constant (see appState.staggerFlipped /
// design.staggerFlipped) restoring the exact stagger a design had under an
// even earlier convention (pinned to the grid's own width, not col's own
// parity — see git history and migrateDesign.js's migrateStaggerFlip). Default
// (flipped omitted/false) must reproduce every existing test above unchanged
// — already confirmed by this file's other tests all still passing — these
// cases cover flipped=true specifically.

test('isRaised: flipped=true inverts every parity, independent of cols', () => {
  for (let col = 0; col < 8; col++) {
    assert.equal(isRaised(col, 8, true), !isRaised(col, 8, false));
  }
});

test('peyoteCellOriginMm: flipped=true inverts the raised/recessed offset for the same cell', () => {
  const normal = peyoteCellOriginMm(0, 2, BEAD_W, BEAD_H, COLS);
  const flipped = peyoteCellOriginMm(0, 2, BEAD_W, BEAD_H, COLS, true);
  assert.notEqual(normal.yMm, flipped.yMm);
  assert.equal(normal.xMm, flipped.xMm); // col-driven xMm is unaffected by stagger parity
});

test('peyoteCellAtPoint: round-trips against peyoteCellOriginMm with flipped=true, same as the unflipped round-trip test', () => {
  const rows = 6, cols = 7; // odd cols, the case flipped actually matters for
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const origin = peyoteCellOriginMm(row, col, BEAD_W, BEAD_H, cols, true);
      const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
      const hit = peyoteCellAtPoint(point.xMm, point.yMm, BEAD_W, BEAD_H, rows, cols, true);
      assert.deepEqual(hit, { row, col }, `mismatch at row ${row}, col ${col}`);
    }
  }
});

test('peyoteCellAtPointClamped: flipped=true round-trips like the unflipped version', () => {
  const origin = peyoteCellOriginMm(2, 3, BEAD_W, BEAD_H, 7, true);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(
    peyoteCellAtPointClamped(point.xMm, point.yMm, BEAD_W, BEAD_H, 6, 7, true),
    { row: 2, col: 3 }
  );
});

test('peyoteCellAtPointUnbounded: flipped=true round-trips like the unflipped version, including negative cells', () => {
  const origin = peyoteCellOriginMm(-1, -1, BEAD_W, BEAD_H, 7, true);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H, 7, true), { row: -1, col: -1 });
});

test('peyoteNeighbors: flipped=true still returns six geometrically-consistent, symmetric neighbors', () => {
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 6; col++) {
      const neighbors = peyoteNeighbors(row, col, 6, true);
      assert.equal(neighbors.length, 6);
      assert.equal(new Set(neighbors.map(String)).size, 6);
      for (const [nRow, nCol] of neighbors) {
        const back = peyoteNeighbors(nRow, nCol, 6, true).map(String);
        assert.ok(back.includes(String([row, col])), `(${nRow},${nCol})'s neighbors should include (${row},${col})`);
      }
    }
  }
});

test('peyoteNeighbors: flipped=true produces a genuinely different adjacency set than flipped=false for the same cell', () => {
  const unflipped = peyoteNeighbors(3, 2, 7, false).map(String).sort();
  const flipped = peyoteNeighbors(3, 2, 7, true).map(String).sort();
  assert.notDeepEqual(flipped, unflipped);
});

// dropCount (see .work/feature-multi-drop-peyote-plan.md) — dropCount=1 must
// reproduce every case above unchanged (already confirmed since it's the
// default and every prior test omits it); these cases cover dropCount>1
// specifically.

test('isRaised: dropCount=1 is byte-for-byte the original per-column rule', () => {
  for (let col = -5; col < 10; col++) {
    assert.equal(isRaised(col, 10, false, 1), isRaised(col, 10, false));
  }
});

test('isRaised: dropCount=2 groups columns in pairs sharing the same parity', () => {
  // group 0 = cols {0,1}, group 1 = cols {2,3}, group 2 = cols {4,5}, ...
  assert.equal(isRaised(0, 10, false, 2), isRaised(1, 10, false, 2));
  assert.equal(isRaised(2, 10, false, 2), isRaised(3, 10, false, 2));
  assert.notEqual(isRaised(1, 10, false, 2), isRaised(2, 10, false, 2));
});

test('isRaised: dropCount=2 negative columns group cleanly across zero (Math.floor, not truncation)', () => {
  // -2 and -1 both belong to group -1, matching how 0 and 1 both belong to group 0
  // (Math.floor(-1/2) === -1, not 0 — a truncating divide would have wrongly split
  // -2 and -1 into different groups).
  assert.equal(isRaised(-2, 10, false, 2), isRaised(-1, 10, false, 2));
  // Group -1 (cols -2,-1) and group 0 (cols 0,1) are adjacent groups, so their
  // parity must differ, same as any two adjacent groups do.
  assert.notEqual(isRaised(-1, 10, false, 2), isRaised(0, 10, false, 2));
});

test('isRaised: dropCount=3 groups columns in triples', () => {
  assert.equal(isRaised(0, 12, false, 3), isRaised(1, 12, false, 3));
  assert.equal(isRaised(1, 12, false, 3), isRaised(2, 12, false, 3));
  assert.notEqual(isRaised(2, 12, false, 3), isRaised(3, 12, false, 3));
});

test('peyoteCellOriginMm: dropCount=2 gives same-group columns the same yMm offset, different-group columns different offsets', () => {
  const a = peyoteCellOriginMm(0, 0, BEAD_W, BEAD_H, 10, false, 2);
  const b = peyoteCellOriginMm(0, 1, BEAD_W, BEAD_H, 10, false, 2);
  const c = peyoteCellOriginMm(0, 2, BEAD_W, BEAD_H, 10, false, 2);
  assert.equal(a.yMm, b.yMm); // same group (0)
  assert.notEqual(b.yMm, c.yMm); // group boundary
  // xMm is untouched by dropCount — each bead still occupies its own column slot.
  assert.equal(a.xMm, 0);
  assert.equal(b.xMm, BEAD_H);
  assert.equal(c.xMm, 2 * BEAD_H);
});

test('peyoteCellAtPoint: round-trips against peyoteCellOriginMm with dropCount=2, including negative-column group boundaries', () => {
  const rows = 6, cols = 9;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const origin = peyoteCellOriginMm(row, col, BEAD_W, BEAD_H, cols, false, 2);
      const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
      const hit = peyoteCellAtPoint(point.xMm, point.yMm, BEAD_W, BEAD_H, rows, cols, false, 2);
      assert.deepEqual(hit, { row, col }, `mismatch at row ${row}, col ${col}`);
    }
  }
});

test('peyoteCellAtPointUnbounded: dropCount=2 round-trips for a negative column', () => {
  const origin = peyoteCellOriginMm(0, -2, BEAD_W, BEAD_H, 10, false, 2);
  const point = { xMm: origin.xMm + BEAD_H / 2, yMm: origin.yMm + BEAD_W / 2 };
  assert.deepEqual(peyoteCellAtPointUnbounded(point.xMm, point.yMm, BEAD_W, BEAD_H, 10, false, 2), { row: 0, col: -2 });
});

test('peyoteNeighbors: dropCount=2 makes same-group columns direct same-row neighbors, not diagonal', () => {
  // Group 0 = cols {0,1}. (row,0) and (row,1) are in the same group.
  const neighbors0 = peyoteNeighbors(3, 0, 10, false, 2);
  assert.ok(neighbors0.some(([r, c]) => r === 3 && c === 1), '(3,0) should list (3,1) as a same-row neighbor');
  assert.ok(!neighbors0.some(([r, c]) => r === 2 && c === 1), '(3,0) should not list (2,1) as a neighbor');
  assert.ok(!neighbors0.some(([r, c]) => r === 4 && c === 1), '(3,0) should not list (4,1) as a neighbor');

  const neighbors1 = peyoteNeighbors(3, 1, 10, false, 2);
  assert.ok(neighbors1.some(([r, c]) => r === 3 && c === 0), '(3,1) should list (3,0) as a same-row neighbor');
});

test('peyoteNeighbors: dropCount=2 still uses the diagonal relationship across a group boundary', () => {
  // Group 0 = cols {0,1}, group 1 = cols {2,3}. (row,1) and (row,2) cross a boundary.
  const neighbors1 = peyoteNeighbors(3, 1, 10, false, 2);
  const boundaryHits = neighbors1.filter(([, c]) => c === 2);
  assert.equal(boundaryHits.length, 2, 'a group-boundary neighbor should still be diagonal (two rows)');
});

test('peyoteNeighbors: dropCount=2 returns four neighbors deep inside a group (fewer than the six at dropCount=1)', () => {
  // col 0 and col 1 are both interior to group 0 relative to each other (left of 0
  // and right of 1 still cross boundaries), but a column with same-group neighbors
  // on BOTH sides only exists for dropCount >= 3 — use dropCount=3, middle column
  // of a triple, to exercise the 4-neighbor case directly.
  const neighbors = peyoteNeighbors(3, 1, 12, false, 3); // group 0 = cols {0,1,2}
  assert.equal(neighbors.length, 4);
});

test('peyoteNeighbors: dropCount>1 adjacency is symmetric across a sample grid, for several (dropCount, flipped) combinations', () => {
  const cases = [
    { dropCount: 2, flipped: false },
    { dropCount: 2, flipped: true },
    { dropCount: 3, flipped: false },
    { dropCount: 3, flipped: true },
    { dropCount: 4, flipped: false },
  ];
  const cols = 13; // deliberately not a clean multiple of any dropCount above
  for (const { dropCount, flipped } of cases) {
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < cols; col++) {
        for (const [nRow, nCol] of peyoteNeighbors(row, col, cols, flipped, dropCount)) {
          const back = peyoteNeighbors(nRow, nCol, cols, flipped, dropCount).map(String);
          assert.ok(
            back.includes(String([row, col])),
            `dropCount=${dropCount} flipped=${flipped}: (${nRow},${nCol})'s neighbors should include (${row},${col})`
          );
        }
      }
    }
  }
});

test('peyoteNeighbors: two cells in the same drop group are always mutual same-row neighbors', () => {
  const dropCount = 3;
  const cols = 13;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const group = Math.floor(col / dropCount);
      const nextGroup = Math.floor((col + 1) / dropCount);
      if (group !== nextGroup) continue; // group boundary — diagonal, not same-row, covered elsewhere
      const forward = peyoteNeighbors(row, col, cols, false, dropCount);
      const backward = peyoteNeighbors(row, col + 1, cols, false, dropCount);
      assert.ok(forward.some(([r, c]) => r === row && c === col + 1), `(${row},${col}) should list (${row},${col + 1}) as same-row`);
      assert.ok(backward.some(([r, c]) => r === row && c === col), `(${row},${col + 1}) should list (${row},${col}) as same-row`);
    }
  }
});

test('peyoteNeighbors: dropCount=1 is byte-for-byte the original 6-neighbor formula', () => {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      assert.deepEqual(
        peyoteNeighbors(row, col, COLS, false, 1).map(String).sort(),
        peyoteNeighbors(row, col, COLS).map(String).sort()
      );
    }
  }
});
