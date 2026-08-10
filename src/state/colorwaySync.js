// The shared-shape/per-colorway-color split (see .work/phase-6-implementation-plan.md)
// lives entirely in this module. Every other module keeps treating appState.cells as
// a plain Map<cellKey,{colorId}> — this is the only place that knows a persisted
// design has more than one of those. Pure, plain-data-in/plain-data-out.

// Rebuilds a colorway's materialized cells Map from the shared shape (every
// occupied cell key) and that colorway's own color assignments. A shape key with
// no entry in colorEntries materializes as { colorId: null } — occupied, unassigned.
export function materializeColorwayCells(shapeEntries, colorEntries) {
  const colorMap = new Map(colorEntries);
  const cells = new Map();
  for (const key of shapeEntries) {
    cells.set(key, { colorId: colorMap.get(key) ?? null });
  }
  return cells;
}

// The inverse: what a colorway's persisted fields should be after cells was edited
// while it was active. shapeEntries is every occupied key (this pattern's canonical
// shape, post-edit); colorEntries is only the cells this colorway actually has a
// real color for — an unassigned cell (colorId: null) is left out, not persisted
// as a null entry, since "missing" already means unassigned on the way back in.
export function decomposeCellsForSave(cells) {
  const shapeEntries = Array.from(cells.keys());
  const colorEntries = Array.from(cells.entries())
    .filter(([, value]) => value.colorId !== null)
    .map(([key, value]) => [key, value.colorId]);
  return { shapeEntries, colorEntries };
}

// After a shape edit (draw adds a key, erase removes one), every colorway's stored
// colorEntries needs to agree with the new shape — erased cells must not leave a
// stale color behind that could resurface if the same key is ever redrawn.
export function pruneColorwaysToShape(colorways, shapeEntries) {
  const shapeSet = new Set(shapeEntries);
  return colorways.map((cw) => ({
    ...cw,
    colorEntries: cw.colorEntries.filter(([key]) => shapeSet.has(key)),
  }));
}
