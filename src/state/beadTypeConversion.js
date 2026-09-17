// Pure remap of every colorway's layerColorEntries onto a new bead type's color
// ids, per a source-colorId -> target-colorId mapping table (Part C of
// .work/feature-bead-catalog-and-conversion-plan.md's Convert Bead Type flow,
// generalized for layers per .work/feature-layers-plan.md — a colorway's colors
// are now scoped per layer, not a single flat colorEntries list, so every
// layer's own entries get remapped independently). Pulled out of the dialog/
// storage plumbing around it specifically so it can get node:test coverage on
// its own. A colorId with no entry in the table (e.g. it resolved to nothing in
// the source palette and was never presented for mapping) passes through
// unchanged rather than being dropped — there's nothing meaningful to remap it
// to.
export function remapColorwayColorIds(colorways, mappingTable) {
  return colorways.map((cw) => ({
    ...cw,
    layerColorEntries: Object.fromEntries(
      Object.entries(cw.layerColorEntries).map(([layerId, entries]) => [
        layerId,
        entries.map(([key, colorId]) => [key, mappingTable.get(colorId) ?? colorId]),
      ])
    ),
  }));
}
