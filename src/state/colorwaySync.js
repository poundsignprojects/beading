// The per-layer-shape/per-layer-colors split lives entirely in this module.
// Every other module keeps treating appState.cells as a plain
// Map<cellKey,{colorId}> — this is the only place that knows a persisted
// design has more than one of those, and more than one layer of those.
// Pure, plain-data-in/plain-data-out.
//
// Layers belong to exactly one colorway (see .work/feature-per-colorway-
// layers-plan.md) — a layer's shapeEntries AND colorEntries both live
// directly on the layer object, scoped inside whichever colorway owns it.
// Nothing here reaches across colorways at all: a shape edit on one
// colorway's layer can never affect another colorway's own layers, since
// they're simply different objects, not a shared shape with per-colorway
// colors layered on top (the earlier design this replaced).

// Rebuilds a colorway's materialized cells Map from a shape (every occupied
// cell key) and a matching set of color assignments. A shape key with no
// entry in colorEntries materializes as { colorId: null } — occupied,
// unassigned.
export function materializeColorwayCells(shapeEntries, colorEntries) {
  const colorMap = new Map(colorEntries);
  const cells = new Map();
  for (const key of shapeEntries) {
    cells.set(key, { colorId: colorMap.get(key) ?? null });
  }
  return cells;
}

// The inverse: what a layer's persisted fields should be after cells was
// edited while it was active. shapeEntries is every occupied key (this
// layer's canonical shape, post-edit); colorEntries is only the cells this
// layer actually has a real color for — an unassigned cell (colorId: null)
// is left out, not persisted as a null entry, since "missing" already means
// unassigned on the way back in.
export function decomposeCellsForSave(cells) {
  const shapeEntries = Array.from(cells.keys());
  const colorEntries = Array.from(cells.entries())
    .filter(([, value]) => value.colorId !== null)
    .map(([key, value]) => [key, value.colorId]);
  return { shapeEntries, colorEntries };
}

// Rebuilds one layer's materialized cells from its own shapeEntries/colorEntries.
export function materializeLayerCells(layer) {
  return materializeColorwayCells(layer.shapeEntries, layer.colorEntries);
}

// Composites every visible layer of one colorway (bottom of stack to top, by
// `order`) into one flat cells Map — the topmost visible layer's bead wins at
// any cell more than one layer occupies (confirmed with the user — layers may
// freely overlap, top-of-stack wins, matching Photoshop). This is the one
// place "as if flattened" actually happens; nothing downstream of it
// (canvasRenderer/thumbnailRenderer/wordChart/printView) needs to know layers
// exist at all — they just get an ordinary flat cells Map.
//
// overrideLayerId/overrideCells let the live editor substitute one layer's
// current, not-yet-saved cells in place of what's actually persisted for it —
// every other caller (a library preview, a design record freshly read from
// storage) omits them and gets a pure function of the colorway's own layers.
// visibleOnly: false includes every layer regardless of its own visible flag
// (not currently used by any caller, kept for symmetry/possible future use).
export function composeVisibleLayers(layers, { overrideLayerId, overrideCells, visibleOnly = true } = {}) {
  const ordered = [...layers].sort((a, b) => a.order - b.order);
  const flat = new Map();
  for (const layer of ordered) {
    if (visibleOnly && !layer.visible) continue;
    const cells = layer.id === overrideLayerId ? overrideCells : materializeLayerCells(layer);
    for (const [key, value] of cells) flat.set(key, value);
  }
  return flat;
}
