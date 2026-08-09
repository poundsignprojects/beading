// Pure accumulator for the diffs of one in-progress draw/erase stroke. Keyed by
// cell so a cell touched more than once in a stroke (e.g. a drag that crosses back
// over itself) collapses to a single entry: first `before` seen, latest `after`.

export function createStrokePatch() {
  return new Map();
}

export function recordCellChange(strokePatch, row, col, before, after) {
  const key = `${row},${col}`;
  const existing = strokePatch.get(key);
  if (existing) {
    existing.after = after;
  } else {
    strokePatch.set(key, { row, col, before, after });
  }
}

export function strokePatchToArray(strokePatch) {
  return Array.from(strokePatch.values());
}
