// Spreadsheet-column-style codes (A, B, ..., Z, AA, AB, ...) for the printed word
// chart and legend, assigned only to colors actually used in the pattern so a
// printout stays compact regardless of what the underlying colorId (a generated
// custom-color id — see src/storage/customColorStore.js) looks like.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 0->A, 25->Z, 26->AA, 27->AB, ...
function codeForIndex(index) {
  let n = index;
  let code = '';
  do {
    code = ALPHABET[n % 26] + code;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return code;
}

// colorCounts: buildWordChart's colorCounts list, already in first-appearance
// order (the order a color is first encountered scanning the pattern row by
// row) — codes are assigned in that same order, not sorted by count, so a
// printout's materials table reads A, B, C, ... straight down the page instead
// of jumping around whenever the most-used color isn't the first one a
// stitcher would encounter. (Quantity is still shown in its own Count column
// for whoever wants to shop by that instead.)
export function assignColorCodes(colorCounts) {
  const codes = new Map();
  colorCounts.forEach((entry, index) => codes.set(entry.colorId, codeForIndex(index)));
  return codes;
}
