// Phase 8 retired the placeholder Miyuki-catalog swatches in favor of a user-built
// palette (see src/storage/customColorStore.js, appState.customColors) — sourcing
// the real Miyuki DB/RR catalogs (900+ SKUs each, no machine-readable hex data)
// wasn't practical (CLAUDE.md's Bead Specs gap). This file now only holds
// UNASSIGNED_SWATCH, which is independent of any catalog — it's a colorway concept,
// not bead-catalog data.

// A cell that's occupied (part of the shared shape — see colorwaySync.js) but has
// no color of its own in the currently active colorway renders with this fixed
// placeholder rather than an absence, so it still reads as "a bead goes here" while
// staying visually distinct from every real swatch (Phase 6 plan). `id: null`
// matches the actual colorId stored for an unassigned cell, so `resolveColor(null)`
// finding this via a lookup table works the same way a real swatch lookup does.
// Fully opaque/matte — an unassigned placeholder cell shouldn't itself look
// transparent or shiny (.work/feature-bead-finish-effects-mvp-plan.md).
export const UNASSIGNED_SWATCH = { id: null, name: 'Unassigned', hex: '#d9cdf0', alphaPercent: 100, luster: 'matte' };

// Shared fallback for a colorId that no longer resolves to a real swatch (a
// deleted color still referenced by an old cell, or data predating this app's
// model) — used by canvasRenderer.js's X-marked bead fill and by the other
// render/print call sites that are too small to draw an X of their own.
export const MISSING_COLOR_FALLBACK_HEX = '#c0392b';

// Shared by editorView.js/printView.js/thumbnailRenderer's caller — colorId === null
// means "occupied, no color assigned in this colorway" (see UNASSIGNED_SWATCH above,
// unchanged); colorId set but not found in customColors means a dangling reference
// (the color it pointed to was deleted, or predates this app's data model) — returns
// null so callers can render that state distinctly instead of guessing a color.
// Returns the finish info alongside the hex ({hex, alphaPercent, luster}) rather
// than a bare string, so paintBeadFill (beadFill.js) can render transparency/
// luster without a second lookup.
export function resolveSwatchAppearance(customColors, colorId) {
  if (colorId === null) return UNASSIGNED_SWATCH;
  const swatch = customColors.find((c) => c.id === colorId);
  return swatch ? { hex: swatch.hex, alphaPercent: swatch.alphaPercent, luster: swatch.luster } : null;
}
