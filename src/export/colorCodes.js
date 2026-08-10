// Spreadsheet-column-style codes (A, B, ..., Z, AA, AB, ...) for the printed word
// chart and legend, assigned only to colors actually used in the pattern so a
// printout stays compact regardless of what the underlying colorId looks like
// (see .work/phase-5-implementation-plan.md — COLOR_LIBRARIES ids are placeholder
// data today and may get longer once real Miyuki catalog numbers land).

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

// colorCounts: buildWordChart's colorCounts list. Sorted most-used-first so the
// shortest codes go to the colors that appear most on the printout; ties keep
// first-appearance order via Array#sort's stability.
export function assignColorCodes(colorCounts) {
  const sorted = [...colorCounts].sort((a, b) => b.count - a.count);
  const codes = new Map();
  sorted.forEach((entry, index) => codes.set(entry.colorId, codeForIndex(index)));
  return codes;
}
