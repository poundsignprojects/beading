// Turns a parsed Loomerly export (loomerlyParser.js) into grid data shaped like this
// app's own design records (designStore.js: shapeEntries + one colorway's colorEntries).
// Pure — no DOM, no IndexedDB. See .work/feature-loomerly-import-plan.md's "hard part"
// section for the full derivation this encodes.
//
// The core reconciliation: Loomerly's "row" is one thread pass — roughly half of one of
// this app's own physical rows (a "band"). Two consecutive Loomerly rows interleave to
// form one band, exactly generalizing this app's own rows-1&2 interleave (wordChart.js) to
// every pair, not just the first. Confirmed exactly (not approximately) against four real
// sample exports gathered for this feature: per-color bead counts reconstructed from the
// word chart matched every stated Count: value exactly, across single- and multi-color,
// tapered and solid, single- and multi-page-color-list samples.
//
// Direction is never read from the printed arrow (→/←) — pdf.js's text layer drops that
// glyph entirely on every real sample (see loomerlyParser.js) — it's derived instead: the
// first row of a pair prints in canonical (left-to-right) order already; the second row of
// a pair prints reversed. Confirmed bead-for-bead (not just by aggregate count) against a
// small hand-built ground-truth sample with real, readable arrows: Loomerly's own printed
// Row 3 text matched its picture-chart row as-is, and Row 4 matched only after reversing.

import { cellKey } from '../state/cellStore.js';
import { generatePeyoteGrid } from '../grid/peyote.js';
import { BEAD_TYPES } from '../palette/beadSpecs.js';
import { mmToInches } from '../units/convert.js';

const CATALOG_PREFIX_TO_BEAD_TYPE = {
  delica: 'delica11',
  rocaille: 'rocaille11',
  rocailles: 'rocaille11',
};

// Generous on purpose: this app's own bead-height figures are still provisional/unverified
// (CLAUDE.md's Bead Specs gap), so even a correct match against real Loomerly data carries
// some inherent size drift — see the plan's cross-check derivation. This tolerance is for
// catching a genuinely wrong bead-type guess, not for flagging that known, already-tracked
// imprecision.
const FINISHED_SIZE_TOLERANCE_IN = 0.5;

// The only "Starting bead" value seen across every real sample gathered for this
// feature (four main samples plus a dedicated ground-truth sample built to verify
// direction with real, readable arrows) — the reversal convention in bandFromPair below
// is derived from and only confirmed against this specific starting point.
const CONFIRMED_STARTING_BEAD = 'Top Right';

function groupIntoPairs(rowEntries) {
  if (rowEntries.length === 0) return { pairs: [] };
  const pairs = [];
  let i = 0;
  if (rowEntries[0].rowNumbers.length === 2) {
    pairs.push([rowEntries[0]]);
    i = 1;
  }
  while (i < rowEntries.length) {
    const a = rowEntries[i];
    const b = rowEntries[i + 1];
    if (!b) {
      return {
        error: `This file's word chart has an odd number of rows after the foundation row (row ${a.rowNumbers[0]} has no pair to interleave with) — it may be malformed or use a layout this importer doesn't support yet.`,
      };
    }
    pairs.push([a, b]);
    i += 2;
  }
  return { pairs };
}

// Direction strictly alternates per *printed line*, starting from whatever "Starting
// bead" the header states (every real sample gathered for this feature says "Top
// Right", which reads right-to-left first — see the module header note; this reversal
// convention is only confirmed for that starting point, see guessStartingBeadIsSupported
// below). The combined "Row 1&2" line is printed line 0 (even index) and shares that same
// "needs reversing to reach natural/canonical order" direction as every other even-indexed
// line (Row 4, Row 6, Row 8, ...) — it is NOT already in canonical order as originally
// assumed here. Confirmed against a real ground-truth sample's own picture-chart page:
// printed "Row 1&2 (1)B, (1)A, (1)B, (1)A" only matches the picture's band-0 rendering
// (A, B, A, B) after reversing, exactly like Row 4's printed text only matches its own
// picture-chart row after reversing. A later pair's first row (always odd-indexed) prints
// canonical as-is; its second row (always even-indexed) prints reversed, same rule.
function bandFromPair(pair) {
  if (pair.length === 1) return pair[0].runs.slice().reverse();
  const [a, b] = pair;
  const canonA = a.runs;
  const canonB = b.runs.slice().reverse();
  const band = [];
  const len = Math.max(canonA.length, canonB.length);
  for (let i = 0; i < len; i++) {
    if (i < canonA.length) band.push(canonA[i]);
    if (i < canonB.length) band.push(canonB[i]);
  }
  return band;
}

// Loomerly never prints leading/trailing blank runs on a tapered row — only "meaningful"
// bounded content — so a shaped row's reconstructed bead list is shorter than its band's
// full capacity, and the leftover must be distributed as invisible padding at both ends.
// Centering is the confirmed-correct default (not a bare guess): the source picture is
// mirror-symmetric, and paired rows are short by the same absolute amount from their own
// capacities — exactly what a symmetric trim produces. See the plan for the full evidence.
export function buildGridFromLoomerly(parsed) {
  const rows = parsed.meta.width;
  const cols = parsed.meta.height;
  const { pairs, error } = groupIntoPairs(parsed.rowEntries);
  if (error) return { error };

  const shapeEntries = [];
  const colorEntries = [];
  pairs.forEach((pair, colIndex) => {
    if (colIndex >= cols) return; // more bands than the stated Height -- ignored, flagged by computeImportWarnings
    const band = bandFromPair(pair);
    const start = Math.floor((rows - band.length) / 2);
    band.forEach((code, offset) => {
      if (code === null) return;
      const row = start + offset;
      if (row < 0 || row >= rows) return; // wider than the stated Width -- ignored, flagged by computeImportWarnings
      const key = cellKey(row, colIndex);
      shapeEntries.push(key);
      colorEntries.push([key, code]);
    });
  });

  return { rows, cols, shapeEntries, colorEntries, bandCount: pairs.length };
}

function parseFinishedSizeIn(text) {
  if (!text) return null;
  const match = /([\d.]+)\s*x\s*([\d.]+)/i.exec(text);
  if (!match) return null;
  return { widthIn: Number(match[1]), heightIn: Number(match[2]) };
}

function predictedFinishedSizeIn(rows, cols, beadTypeKey) {
  const spec = BEAD_TYPES[beadTypeKey];
  const grid = generatePeyoteGrid({ rows, cols, beadWidthMm: spec.widthMm, beadHeightMm: spec.heightMm });
  return {
    widthIn: mmToInches(grid.boundingBoxMm.widthMm),
    heightIn: mmToInches(grid.boundingBoxMm.heightMm),
  };
}

// Bead type is guessed, shown, and always confirmable/overridable by the user — never a
// silent decision (Decision #7 still bounds the choice to just these two bead types). The
// color list's own header line is preferred when present; about half of real samples
// gathered for this feature didn't have one, so the size-comparison fallback is a real
// path, not a rarely-hit edge case.
export function guessBeadType(parsed) {
  const fromHeader = parsed.beadTypeCatalogPrefix
    ? CATALOG_PREFIX_TO_BEAD_TYPE[parsed.beadTypeCatalogPrefix.toLowerCase()]
    : null;
  if (fromHeader) return { beadTypeKey: fromHeader, source: 'header' };

  const stated = parseFinishedSizeIn(parsed.meta.finishedSizeIn);
  if (!stated) return { beadTypeKey: 'delica11', source: 'default' };

  let best = null;
  for (const beadTypeKey of Object.keys(BEAD_TYPES)) {
    const predicted = predictedFinishedSizeIn(parsed.meta.width, parsed.meta.height, beadTypeKey);
    const error = Math.abs(predicted.widthIn - stated.widthIn) + Math.abs(predicted.heightIn - stated.heightIn);
    if (!best || error < best.error) best = { beadTypeKey, error, predicted };
  }
  return { beadTypeKey: best.beadTypeKey, source: 'size-guess', predicted: best.predicted };
}

// Warn, don't block (consistent with Phase 5/6's existing philosophy) — a mismatch here
// means the reconstruction may be off, not that it definitely is; the bead-type guess in
// particular is inherently approximate. Every warning is shown on the import preview
// screen, never silently swallowed; import still proceeds if the user confirms.
export function computeImportWarnings(parsed, grid, beadTypeKey) {
  const warnings = [];

  if (parsed.startingBead && parsed.startingBead.trim().toLowerCase() !== CONFIRMED_STARTING_BEAD.toLowerCase()) {
    warnings.push(
      `This file's starting bead is "${parsed.startingBead}" — every sample this importer's direction logic was verified against says "${CONFIRMED_STARTING_BEAD}". The reconstruction may be mirrored or rotated; check it against the PDF before relying on it.`
    );
  }

  if (grid.bandCount !== parsed.meta.height) {
    warnings.push(
      `This file's word chart reconstructs to ${grid.bandCount} row(s), but its header states Height: ${parsed.meta.height}.`
    );
  }

  const reconstructedBeadCount = grid.shapeEntries.length;
  if (reconstructedBeadCount !== parsed.meta.totalBeads) {
    warnings.push(
      `Reconstructed ${reconstructedBeadCount} bead(s), but this file's header states Total beads: ${parsed.meta.totalBeads}.`
    );
  }

  const stated = parseFinishedSizeIn(parsed.meta.finishedSizeIn);
  if (stated) {
    const predicted = predictedFinishedSizeIn(grid.rows, grid.cols, beadTypeKey);
    const diff = Math.abs(predicted.widthIn - stated.widthIn) + Math.abs(predicted.heightIn - stated.heightIn);
    if (diff > FINISHED_SIZE_TOLERANCE_IN) {
      warnings.push(
        `Predicted finished size as ${BEAD_TYPES[beadTypeKey].name} (${predicted.widthIn.toFixed(2)}" x ${predicted.heightIn.toFixed(2)}") differs noticeably from this file's stated size (${parsed.meta.finishedSizeIn}) — double check the bead type.`
      );
    }
  }

  const reconstructedCounts = new Map();
  for (const [, code] of grid.colorEntries) {
    reconstructedCounts.set(code, (reconstructedCounts.get(code) ?? 0) + 1);
  }
  for (const color of parsed.colors) {
    const actual = reconstructedCounts.get(color.code) ?? 0;
    if (color.count !== null && actual !== color.count) {
      warnings.push(
        `Color ${color.code} (${color.name ?? color.catalogNumber ?? color.code}): reconstructed ${actual} bead(s), but this file states Count: ${color.count}.`
      );
    }
  }

  return warnings;
}
