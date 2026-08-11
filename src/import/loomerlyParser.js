// Parses the plain text pdfText.js extracts from a Loomerly pattern-export PDF into a
// typed, structured representation. Pure text-in/data-out — no DOM, no pdf.js awareness
// — see .work/feature-loomerly-import-plan.md for the full derivation this is built from.
//
// Deliberately does NOT read the printed direction arrow (→/←) for each word-chart row:
// pdf.js's text layer gives back an *empty string* for that glyph against every real
// sample PDF checked (the font's subset has no ToUnicode mapping for it — confirmed by
// inspecting raw text items, not just the joined text). Direction is derivable anyway —
// see loomerlyImport.js — so this is a real constraint the parser designs around, not a
// gap it leaves unresolved.

const ROW_LINE_RE = /^Row (\d+)(?:&(\d+))?\s*\([^)]*\)\s*(.+)$/;
const RUN_RE = /\((\d+)\)([A-Za-z-]+)/g;
const COUNT_LINE_RE = /^Count:\s*([\d,]+)$/;
const CODE_LINE_RE = /^[A-Z]{1,3}$/;
const PAGE_FOOTER_RE = /^Page \d+ of \d+$/;
const NON_DATA_HEADING_LINES = new Set(['Word Chart', 'Color List']);
const SECTION_RE = /Section (\d+) of (\d+)/;
const BEAD_TYPE_HEADER_RE = /^Miyuki\s+(\S+)\s+11\/0/i;

// "-" alone (no leading count) means this pass placed zero beads — the fully-tapered-off
// end of a shaped piece. An interior "(14)-" run is a different thing (14 literal blank
// cells inside an otherwise-occupied pass) and is handled by the general run loop below.
function decodeRuns(runsText) {
  const trimmed = runsText.trim();
  if (trimmed === '-') return [];
  const beads = [];
  let match;
  RUN_RE.lastIndex = 0;
  while ((match = RUN_RE.exec(trimmed))) {
    const count = Number(match[1]);
    const code = match[2];
    for (let i = 0; i < count; i++) beads.push(code === '-' ? null : code);
  }
  return beads;
}

function parseHeader(lines) {
  const get = (label) => {
    const line = lines.find((l) => l.startsWith(label));
    return line ? line.slice(label.length).trim() : null;
  };
  const typeText = get('Type:');
  const widthText = get('Width:');
  const heightText = get('Height:');
  const finishedSizeIn = get('Finished size:');
  const totalBeadsText = get('Total beads:');

  if (!typeText || !widthText || !heightText || !totalBeadsText) {
    return { error: 'Could not find this PDF’s header stats (Type/Width/Height/Total beads) — it may not be a Loomerly pattern export.' };
  }
  return {
    meta: {
      type: typeText,
      width: Number(widthText),
      height: Number(heightText),
      finishedSizeIn,
      totalBeads: Number(totalBeadsText.replace(/,/g, '')),
    },
  };
}

function parseSection(lines) {
  const line = lines.find((l) => SECTION_RE.test(l));
  if (!line) return { sectionInfo: null }; // not reliably extractable — see module header note
  const match = SECTION_RE.exec(line);
  const section = Number(match[1]);
  const total = Number(match[2]);
  return { sectionInfo: { section, total } };
}

function parseWordChart(lines) {
  const startingBeadLine = lines.find((l) => l.startsWith('Starting bead:'));
  const startingBead = startingBeadLine ? startingBeadLine.slice('Starting bead:'.length).trim() : null;

  const rowEntries = [];
  let lastRowLineIndex = -1;
  lines.forEach((line, index) => {
    const match = ROW_LINE_RE.exec(line);
    if (!match) return;
    const rowNumbers = match[2] ? [Number(match[1]), Number(match[2])] : [Number(match[1])];
    rowEntries.push({ rowNumbers, runs: decodeRuns(match[3]) });
    lastRowLineIndex = index;
  });
  return { startingBead, rowEntries, lastRowLineIndex };
}

// Classifies every non-footer, non-header line after the word chart into one of the four
// repeating color-list fields by shape (codes are pure letters, catalog numbers always
// contain a digit and no lowercase, counts have their own fixed prefix) and zips them back
// together positionally. Loomerly's own layout prints these as separate same-y "columns"
// (see pdfText.js's line reconstruction) in a fixed repeating cycle, left-to-right then
// top-to-bottom, so codes[i]/catalogs[i]/names[i]/counts[i] all describe the same color —
// confirmed against every real sample gathered for this feature, single- and multi-color,
// with and without a bead-type header line.
//
// Every real sample's per-page footer repeats "Word Chart"/"Color List", "Page N of M",
// and the pattern's own title as their own separate lines (see pdfText.js's line
// reconstruction) — and a footer for the *last* word-chart page sits right at the
// word-chart/color-list boundary, so it lands inside this function's body slice unless
// explicitly excluded. "Page N of M" and the two section headings have fixed, safe-to-match
// text; the title is arbitrary user text, but it reliably reappears as the document's very
// last line (confirmed on every real sample), so matching against that catches every
// repeat of it without needing to guess what a title might look like.
function parseColorList(lines, lastRowLineIndex) {
  const headerLine = lines.find((l) => BEAD_TYPE_HEADER_RE.test(l));
  const beadTypeHeaderMatch = headerLine ? BEAD_TYPE_HEADER_RE.exec(headerLine) : null;
  const titleLine = lines.at(-1);

  const body = lines
    .slice(lastRowLineIndex + 1)
    .filter((l) => l !== headerLine && l !== titleLine && !PAGE_FOOTER_RE.test(l) && !NON_DATA_HEADING_LINES.has(l));

  const codes = [];
  const catalogs = [];
  const names = [];
  const counts = [];
  for (const line of body) {
    if (COUNT_LINE_RE.test(line)) {
      counts.push(Number(COUNT_LINE_RE.exec(line)[1].replace(/,/g, '')));
    } else if (CODE_LINE_RE.test(line)) {
      codes.push(line);
    } else if (/\d/.test(line) && !/[a-z]/.test(line)) {
      // catalog numbers contain a digit and no lowercase letters (e.g. "M137", "DB2281",
      // a bare "01" when no bead-type header is present at all)
      catalogs.push(line);
    } else if (line.length > 0) {
      names.push(line);
    }
  }

  const colors = codes.map((code, i) => ({
    code,
    catalogNumber: catalogs[i] ?? null,
    name: names[i] ?? null,
    count: counts[i] ?? null,
  }));

  return {
    beadTypeHeaderRaw: headerLine ?? null,
    beadTypeCatalogPrefix: beadTypeHeaderMatch ? beadTypeHeaderMatch[1] : null,
    colors,
  };
}

export function parseLoomerlyExport(pageTexts) {
  const lines = pageTexts.flatMap((text) => text.split('\n')).map((l) => l.trim()).filter(Boolean);

  const headerResult = parseHeader(lines);
  if (headerResult.error) return { error: headerResult.error };
  const { meta } = headerResult;

  if (meta.type !== 'Peyote') {
    return { error: `This importer only supports Peyote patterns — this file is "${meta.type}", which isn’t supported yet.` };
  }

  const { sectionInfo } = parseSection(lines);
  if (sectionInfo && (sectionInfo.section !== 1 || sectionInfo.total !== 1)) {
    return { error: `This importer only supports single-section patterns — this file is section ${sectionInfo.section} of ${sectionInfo.total}.` };
  }

  const { startingBead, rowEntries, lastRowLineIndex } = parseWordChart(lines);
  if (rowEntries.length === 0) {
    return { error: 'Could not find any word chart rows in this PDF — it may not be a Loomerly pattern export, or its layout may have changed.' };
  }

  const { beadTypeHeaderRaw, beadTypeCatalogPrefix, colors } = parseColorList(lines, lastRowLineIndex);

  if (colors.length === 0) {
    return { error: 'Could not find a color list in this PDF — it may not be a Loomerly pattern export, or its layout may have changed.' };
  }

  return {
    meta,
    startingBead,
    rowEntries,
    colors,
    beadTypeHeaderRaw,
    beadTypeCatalogPrefix,
  };
}

export { decodeRuns };
