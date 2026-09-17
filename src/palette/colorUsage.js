import { decomposeCellsForSave } from '../state/colorwaySync.js';

// Finds every design that references colorId in any of its colorways (across
// every layer — see .work/feature-layers-plan.md), so the Manage Colors list
// can block deletion and say exactly where a color is used. Pure over plain
// data — `liveState` (optional) lets the currently-open design's still-
// unsaved edits count, instead of only the last-autosaved snapshot in
// `designs` (see .work/feature-color-deletion-guard-and-missing-color-plan.md's
// "How colors and usage are modeled today" section — appState.designs never
// reflects the open design's edits until the autosave debounce fires).
export function findPatternsUsingColor(designs, colorId, liveState = null) {
  const results = [];
  for (const design of designs) {
    const colorways = colorwaysFor(design, liveState);
    const colorwayNames = colorways
      .filter((cw) => Object.values(cw.layerColorEntries).some((entries) => entries.some(([, cid]) => cid === colorId)))
      .map((cw) => cw.name);
    if (colorwayNames.length > 0) {
      results.push({ designId: design.id, designName: design.name, colorwayNames });
    }
  }
  return results;
}

function colorwaysFor(design, liveState) {
  if (!liveState || design.id !== liveState.currentDesignId) return design.colorways;
  const { colorEntries } = decomposeCellsForSave(liveState.cells);
  return liveState.colorways.map((cw) => {
    if (cw.id !== liveState.activeColorwayId) return cw;
    return { ...cw, layerColorEntries: { ...cw.layerColorEntries, [liveState.activeLayerId]: colorEntries } };
  });
}
