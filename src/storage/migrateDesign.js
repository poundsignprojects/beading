// Design records get migrated on read, in three independent steps, oldest first:
//   1. migrateLegacyColorways — Phase 4/5 designs saved as flat cellEntries (no
//      colorways field) get wrapped into a single default colorway.
//   2. migrateAxisConvention — pre-refactor designs (see
//      .work/refactor-row-col-axis-naming-plan.md) had row/col meaning the
//      opposite of what the UI's Rows/Cols labels said; this swaps rows/cols
//      and every shape/colorway cell key's row/col components exactly once.
//   3. migrateStaggerFlip — a still-earlier convention (pinned to the grid's
//      own width, not a cell's own column parity — see git history) rendered
//      odd-column designs with the opposite stagger from what isRaised now
//      produces; this stamps a per-design flag once, so an existing odd-column
//      design keeps rendering exactly as it always did.
// All three steps are idempotent: a record already past a given step passes
// through unchanged. designStore.js's listDesignsSorted re-saves any record
// any step changed, so migration happens once per design, system-wide.

import { generateId } from './id.js';

function migrateLegacyColorways(record) {
  if (record.colorways) return record;

  const now = Date.now();
  const { cellEntries, ...rest } = record;
  const activeColorwayId = generateId();

  return {
    ...rest,
    shapeEntries: cellEntries.map(([key]) => key),
    colorways: [{
      id: activeColorwayId,
      name: 'Colorway 1',
      colorEntries: cellEntries.map(([key, value]) => [key, value.colorId]),
      createdAt: now,
      updatedAt: now,
    }],
    activeColorwayId,
  };
}

function swapRowColInKey(key) {
  const [a, b] = key.split(',');
  return `${b},${a}`;
}

// axisVersion: 2 marks a record whose rows/cols and every cell key's row/col
// components have already been swapped to the corrected convention (see
// .work/refactor-row-col-axis-naming-plan.md). Absent/1 means the pre-refactor
// convention — every record saved before this shipped.
function migrateAxisConvention(record) {
  if (record.axisVersion === 2) return record;
  return {
    ...record,
    rows: record.cols,
    cols: record.rows,
    shapeEntries: record.shapeEntries.map(swapRowColInKey),
    colorways: record.colorways.map((cw) => ({
      ...cw,
      colorEntries: cw.colorEntries.map(([key, colorId]) => [swapRowColInKey(key), colorId]),
    })),
    axisVersion: 2,
  };
}

// Gated on field presence, not axisVersion — deliberately independent of step
// 2's own gate. A record can already be at axisVersion: 2 (migrated by a
// previous session's boot, before this step existed at all) without ever
// having had a staggerFlipped value computed, so re-checking axisVersion here
// would silently skip exactly the records this step exists for. Any record
// created fresh since this step shipped (createDesign/createConvertedDesign)
// already stamps staggerFlipped explicitly, so it never reaches the
// "needs computing" branch below.
//
// The value itself: isRaised's rule changed twice in this app's history (see
// git log for src/grid/peyote.js). The version immediately before this one
// reduces to "col odd = raised" for an even column count, but the opposite
// ("col even = raised") for an odd one — so a design whose (already
// axis-corrected) column count is odd needs the flip to keep rendering
// exactly as it always did; an even column count needs no flip at all.
function migrateStaggerFlip(record) {
  if (record.staggerFlipped !== undefined) return record;
  return { ...record, staggerFlipped: record.cols % 2 === 1 };
}

export function migrateDesign(record) {
  return migrateStaggerFlip(migrateAxisConvention(migrateLegacyColorways(record)));
}
