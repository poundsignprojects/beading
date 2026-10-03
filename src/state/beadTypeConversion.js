// Pure remap of every colorway's own layers' colorEntries onto a new bead
// type's color ids, per a source-colorId -> target-colorId mapping table
// (Part C of .work/feature-bead-catalog-and-conversion-plan.md's Convert Bead
// Type flow). Layers belong to exactly one colorway (see .work/feature-per-
// colorway-layers-plan.md), so remapping one colorway's layers never touches
// another's. Pulled out of the dialog/storage plumbing around it specifically
// so it can get node:test coverage on its own. A colorId with no entry in the
// table (e.g. it resolved to nothing in the source palette and was never
// presented for mapping) passes through unchanged rather than being dropped —
// there's nothing meaningful to remap it to.
//
// workingColorIds (a colorway's own Working Colors quick-access list — see
// appState.js) is remapped the same way, but a colorId with no entry in the
// table is DROPPED instead of passed through: unlike a colorEntries cell,
// nothing on the grid depends on a working color still existing, and
// carrying over a bare id into a design under a different bead type's
// palette would just be a dangling reference forever. Only remapped when the
// field is actually present on the input, so a colorway from before this
// feature existed (no workingColorIds at all) comes out the same way —
// consuming code already reads `cw.workingColorIds ?? []`, same convention
// as every other additive, optional colorway field.
export function remapColorwayColorIds(colorways, mappingTable) {
  return colorways.map((cw) => ({
    ...cw,
    ...(cw.workingColorIds
      ? { workingColorIds: cw.workingColorIds.map((id) => mappingTable.get(id)).filter((id) => id !== undefined) }
      : {}),
    layers: cw.layers.map((layer) => ({
      ...layer,
      colorEntries: layer.colorEntries.map(([key, colorId]) => [key, mappingTable.get(colorId) ?? colorId]),
    })),
  }));
}
