// Phase 4/5 designs were saved as flat cellEntries — no colorways field. Wraps any
// such record into a single default colorway the first time it's read. Idempotent:
// a record that already has `colorways` passes through unchanged (see Phase 6 plan's
// "Existing saved designs get migrated on load, not broken").

import { generateId } from './id.js';

export function migrateDesign(record) {
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
