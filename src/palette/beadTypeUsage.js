// Finds every design using beadTypeKey, so the bead catalog manager can block
// deletion and say exactly where a bead type is used (Part A of
// .work/feature-bead-catalog-and-conversion-plan.md). Simpler than colorUsage.js's
// findPatternsUsingColor: beadTypeKey is a top-level design field that only ever
// changes via the clone-based Convert Bead Type flow (Part C), never live-edited
// in place — so unlike a color, there's no liveState substitution needed;
// appState.designs is always current for this field.
export function findPatternsUsingBeadType(designs, beadTypeKey) {
  return designs
    .filter((design) => design.beadTypeKey === beadTypeKey)
    .map((design) => ({ designId: design.id, designName: design.name }));
}
