// Design records get migrated on read, in two independent steps, oldest first:
//   1. migrateLegacyColorways — Phase 4/5 designs saved as flat cellEntries (no
//      colorways field) get wrapped into a single default colorway.
//   2. migrateAxisConvention — pre-refactor designs (see
//      .work/refactor-row-col-axis-naming-plan.md) had row/col meaning the
//      opposite of what the UI's Rows/Cols labels said; this swaps rows/cols
//      and every shape/colorway cell key's row/col components exactly once.
// Both steps are idempotent: a record already past a given step passes through
// unchanged. designStore.js's listDesignsSorted re-saves any record either step
// changed, so migration happens once per design, system-wide.

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

export function migrateDesign(record) {
  return migrateAxisConvention(migrateLegacyColorways(record));
}
