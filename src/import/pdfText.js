// Thin wrapper around vendored pdf.js (see /vendor/pdfjs/, .work/feature-loomerly-import-plan.md):
// hands back one page-text string per page, no Loomerly-specific parsing here — that's
// loomerlyParser.js's job. Dynamically imported only when Import is actually used, so this
// (the app's first third-party dependency — deliberate, narrow exception to CLAUDE.md
// Decision #2) costs nothing on every other page load.

// A same-y "line" from getTextContent() can actually be several unrelated table columns
// printed at the same vertical position (confirmed against Loomerly's real color-list
// pages — e.g. three colors' catalog numbers/names/counts all sharing a y-coordinate,
// with no space character between them in the raw item stream). Normal word/glyph gaps in
// this font run well under 10pt; real column gaps run 100pt+. Splitting on any gap past
// this threshold reconstructs each table cell onto its own line without disturbing
// ordinary prose/word-chart lines (verified against real sample PDFs — see the plan).
const COLUMN_GAP_THRESHOLD_PT = 20;
const SAME_LINE_Y_TOLERANCE_PT = 2;

// items: [{str, x, y, width}], already in a text-content-item shape (pdf.js's own items
// have this shape directly — transform[4]/transform[5] give x/y). Pure and independently
// testable without pdf.js or a real PDF.
export function reconstructPageText(items) {
  const sorted = items
    .filter((it) => it.str.length > 0)
    .slice()
    .sort((a, b) => b.y - a.y);

  // Cluster into visual lines first, comparing each item against the cluster's own
  // anchor y (the first item that started it) rather than the last-seen item — a
  // sliding comparison lets small per-item jitter drift the cluster's y over a whole
  // line and can also scramble reading order when two items on the same line happen
  // to differ slightly in y (their arrival order from the sort above isn't guaranteed
  // to match left-to-right x order in that case).
  const lineClusters = [];
  for (const it of sorted) {
    const cluster = lineClusters.find((c) => Math.abs(it.y - c.anchorY) <= SAME_LINE_Y_TOLERANCE_PT);
    if (cluster) cluster.items.push(it);
    else lineClusters.push({ anchorY: it.y, items: [it] });
  }

  const lines = [];
  for (const cluster of lineClusters) {
    const byX = cluster.items.slice().sort((a, b) => a.x - b.x);
    let current = [];
    let lastEndX = null;
    for (const it of byX) {
      const bigGap = lastEndX !== null && it.x - lastEndX > COLUMN_GAP_THRESHOLD_PT;
      if (bigGap) {
        if (current.length) lines.push(current.join('').trim());
        current = [];
      }
      current.push(it.str);
      lastEndX = it.x + (it.width || 0);
    }
    if (current.length) lines.push(current.join('').trim());
  }

  return lines.filter((line) => line.length > 0).join('\n');
}

function itemsFromTextContent(content) {
  return content.items.map((it) => ({
    str: it.str,
    x: it.transform[4],
    y: it.transform[5],
    width: it.width || 0,
  }));
}

let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('../../vendor/pdfjs/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

export async function extractPdfPageTexts(arrayBuffer) {
  const pdfjsLib = await loadPdfjs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pageTexts = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    pageTexts.push(reconstructPageText(itemsFromTextContent(content)));
  }
  return pageTexts;
}
