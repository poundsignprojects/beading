// Pure comparison between a printed pattern's per-color bead counts (from
// wordChart.js's buildWordChart, which already excludes blank/unassigned
// runs) and each color's optional stashCount (customColorStore.js) — used by
// printView.js to warn before printing when a design needs more of a color
// than the user has on hand. A color with no stashCount set (null/undefined,
// the default for every color until the user sets one) is never compared —
// "not tracked" is deliberately not the same as "have zero."
export function findStashShortfalls(colorCounts, customColors) {
  const shortfalls = [];
  for (const { colorId, count } of colorCounts) {
    const color = customColors.find((c) => c.id === colorId);
    if (!color || color.stashCount === null || color.stashCount === undefined) continue;
    if (count > color.stashCount) {
      shortfalls.push({ colorId, name: color.name, needed: count, stashCount: color.stashCount });
    }
  }
  return shortfalls;
}
