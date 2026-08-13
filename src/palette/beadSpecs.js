// Bead type catalog (Part A of .work/feature-bead-catalog-and-conversion-plan.md).
// Replaces the earlier fixed Delica/Rocaille pair plus the per-field override
// mechanism (beadSpecOverrides/resolveBeadSpec) that preceded it — a user can now
// define any number of custom bead types outright, stored in IndexedDB (see
// src/storage/beadCatalogStore.js), rather than only tweaking two built-in ones.
//
// DEFAULT_BEAD_CATALOG seeds the two pre-existing bead types on first boot (see
// beadCatalogStore.js's seedDefaultBeadCatalog) with the exact values the old
// hardcoded BEAD_TYPES held, so nothing visually changes for an existing design on
// upgrade. cornerRadiusFraction (a number, or null) fully replaces the old `shape`
// field: null/0 draws sharp corners (previously shape: 'cylinder'), a positive
// number draws rounded corners at that fraction of the bead's smaller dimension
// (previously shape: 'round') — see canvasRenderer.js/thumbnailRenderer.js, which
// always call ctx.roundRect() now rather than branching on a shape string.
// holeMm/diameterMm are display/reference only — nothing reads them for rendering
// or grid math.

export const DEFAULT_BEAD_CATALOG = [
  { id: 'delica11', name: 'Delica 11/0', widthMm: 1.6, heightMm: 1.3, cornerRadiusFraction: null, holeMm: 0.8, diameterMm: 1.6 },
  { id: 'rocaille11', name: 'Round Rocaille 11/0', widthMm: 2.0, heightMm: 1.4, cornerRadiusFraction: 0.25, holeMm: 0.8, diameterMm: 2.0 },
];

export function findBeadType(catalog, beadTypeKey) {
  return catalog.find((bead) => bead.id === beadTypeKey) ?? null;
}
