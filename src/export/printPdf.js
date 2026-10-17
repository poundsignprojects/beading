// Lays the printout out as a PDF — the same content printView.js shows on
// screen (header, materials table, word chart, reference image), for the one
// place window.print() can't be used: an iOS home-screen web app (see
// printView.js's handlePrint). Pure: a plain model in, PDF bytes out, no DOM.
//
// This is a second layout of the same data, not a rendering of the on-screen
// HTML — a change to what the printout contains has to be made in both.

import { createPdfDocument, hexToPdfColor, textWidthPt } from './pdfWriter.js';

// US Letter. Printed on A4 it just gets scaled to fit by the print dialog.
// Portrait is one column; landscape is two columns side by side, for printing
// one sheet per page at full text size instead of shrinking two portrait pages
// onto one sheet (which takes 9pt text down to under 6pt).
export const PRINT_PDF_LAYOUTS = {
  portrait: { widthPt: 612, heightPt: 792, marginPt: 54, columns: 1, gutterPt: 0 },
  landscape: { widthPt: 792, heightPt: 612, marginPt: 36, columns: 2, gutterPt: 24 },
};

const TITLE_SIZE_PT = 15;
const TITLE_LINE_HEIGHT_PT = 19;
const HEADING_SIZE_PT = 11;
const HEADING_LINE_HEIGHT_PT = 20;
const BODY_SIZE_PT = 9;
const BODY_LINE_HEIGHT_PT = 12.5;
const CHART_SIZE_PT = 9;
const CHART_LINE_HEIGHT_PT = 12;
// Courier is monospaced at 0.6 em per character (see pdfWriter.js).
const CHART_CHAR_WIDTH_PT = CHART_SIZE_PT * 0.6;

const TABLE_ROW_PADDING_PT = 4;
const SWATCH_SIZE_PT = 8;
// Column left edges, as offsets from the left of the text column. Count's is
// measured back from the column's right edge, since column width varies.
const TABLE_CODE_X_PT = 4;
const TABLE_SWATCH_X_PT = 52;
const TABLE_NAME_X_PT = 96;
const TABLE_COUNT_FROM_RIGHT_PT = 60;

const COLOR_TEXT = [0.07, 0.07, 0.07];
const COLOR_MUTED = [0.27, 0.27, 0.27];
const COLOR_EMPTY = [0.47, 0.47, 0.47];
const COLOR_RULE = [0.87, 0.87, 0.87];
const COLOR_TOTAL_RULE = [0.6, 0.6, 0.6];
const COLOR_SWATCH_BORDER = [0.45, 0.45, 0.45];
const COLOR_WARNING_TEXT = [0.54, 0.35, 0];
const COLOR_WARNING_FILL = [1, 0.965, 0.878];
const COLOR_WARNING_BORDER = [0.91, 0.78, 0.47];

// Greedy word wrap. A single word wider than the line is split mid-word
// rather than left to run off the page.
export function wrapText(text, font, sizePt, maxWidthPt) {
  const lines = [];
  let current = '';
  const fits = (candidate) => textWidthPt(candidate, font, sizePt) <= maxWidthPt;
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    let rest = word;
    while (!fits(rest) && rest.length > 1) {
      let take = rest.length - 1;
      while (take > 1 && !fits(rest.slice(0, take))) take--;
      lines.push(rest.slice(0, take));
      rest = rest.slice(take);
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

// One word-chart instruction can hold far more runs than fit across the page;
// continuation lines are indented to sit under the first run, so the row label
// stays alone in its own column. charsPerLine/prefixLength are in characters
// (the chart is monospaced). Returns each printed line's run text.
export function wrapChartRuns(runs, prefixLength, charsPerLine) {
  const available = Math.max(1, charsPerLine - prefixLength);
  const lines = [];
  let current = '';
  for (const run of runs) {
    const candidate = current ? `${current} ${run}` : run;
    if (candidate.length <= available || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = run;
    }
  }
  lines.push(current);
  return lines;
}

// model:
//   title            string, '' for an unnamed design
//   infoLines        string[] — the spec and finished-size lines under the title
//   emptyMessage     string | null — shown instead of materials + chart
//   warning          string | null — the unassigned-color notice
//   materials        [{ code, hex, name, count }]
//   totalBeadCount   number
//   chartLines       [{ label, reversed, runs: string[], bold, isStart }]
//   referenceImage   { widthPx, heightPx, data, widthPt, heightPt } | null
//                    (data: deflated RGB, see pdfWriter.js's addImage)
// layout: a key of PRINT_PDF_LAYOUTS.
export function buildPrintPdf(model, { layout = 'portrait' } = {}) {
  const { widthPt, heightPt, marginPt, columns, gutterPt } = PRINT_PDF_LAYOUTS[layout] ?? PRINT_PDF_LAYOUTS.portrait;
  const fullWidthPt = widthPt - marginPt * 2;
  const columnWidthPt = (fullWidthPt - gutterPt * (columns - 1)) / columns;
  const pdf = createPdfDocument({ widthPt, heightPt });
  const bottomLimit = heightPt - marginPt;

  let page = pdf.addPage();
  // The text area currently being filled. The header spans the whole page
  // width; everything after it flows down one column, then the next, then
  // onto a new page.
  let columnIndex = 0;
  let x = marginPt;
  let contentWidth = fullWidthPt;
  // columnTop: where the current column starts (below the header on page 1).
  // y: top edge of the next thing to be placed.
  let columnTop = marginPt;
  let y = marginPt;

  function startColumns() {
    columnIndex = 0;
    x = marginPt;
    contentWidth = columnWidthPt;
    columnTop = y;
  }
  function newPage() {
    page = pdf.addPage();
    columnIndex = 0;
    x = marginPt;
    columnTop = marginPt;
    y = marginPt;
  }
  function nextColumn() {
    if (columnIndex + 1 < columns) {
      columnIndex++;
      x = marginPt + columnIndex * (columnWidthPt + gutterPt);
      y = columnTop;
    } else {
      newPage();
    }
  }
  // Keeps a block together: moves to a fresh column if it won't fit in this
  // one (unless it's taller than a whole column, where that wouldn't help).
  function ensureSpace(blockHeightPt) {
    if (y + blockHeightPt > bottomLimit && y > columnTop) nextColumn();
  }
  // A line of text occupying one lineHeight slot, baseline set so the text
  // sits visually centered in it. xOffset is from the current column's left.
  function textLine(xOffset, text, { font = 'helvetica', sizePt = BODY_SIZE_PT, lineHeightPt = BODY_LINE_HEIGHT_PT, color = COLOR_TEXT } = {}) {
    ensureSpace(lineHeightPt);
    page.text(x + xOffset, y + lineHeightPt / 2 + sizePt * 0.35, text, { font, sizePt, color });
    y += lineHeightPt;
  }
  function heading(text) {
    ensureSpace(HEADING_LINE_HEIGHT_PT + CHART_LINE_HEIGHT_PT * 2); // never strand a heading at the foot of a column
    textLine(0, text, { font: 'helveticaBold', sizePt: HEADING_SIZE_PT, lineHeightPt: HEADING_LINE_HEIGHT_PT });
  }

  // ---- Header (full page width) ----
  if (model.title) {
    for (const line of wrapText(model.title, 'helveticaBold', TITLE_SIZE_PT, contentWidth)) {
      textLine(0, line, { font: 'helveticaBold', sizePt: TITLE_SIZE_PT, lineHeightPt: TITLE_LINE_HEIGHT_PT });
    }
    y += 2;
  }
  for (const info of model.infoLines) {
    for (const line of wrapText(info, 'helvetica', BODY_SIZE_PT, contentWidth)) {
      textLine(0, line, { color: COLOR_MUTED });
    }
  }
  y += 10;

  if (model.emptyMessage) {
    for (const line of wrapText(model.emptyMessage, 'helvetica', BODY_SIZE_PT, contentWidth)) {
      textLine(0, line, { color: COLOR_EMPTY });
    }
    return pdf.toBytes();
  }

  startColumns();

  // ---- Materials ----
  heading('Materials');

  if (model.warning) {
    const padding = 7;
    const lines = wrapText(model.warning, 'helvetica', BODY_SIZE_PT, contentWidth - padding * 2);
    const boxHeight = lines.length * BODY_LINE_HEIGHT_PT + padding * 2;
    ensureSpace(boxHeight + 8);
    page.rect(x, y, contentWidth, boxHeight, { fill: COLOR_WARNING_FILL, stroke: COLOR_WARNING_BORDER });
    y += padding;
    for (const line of lines) textLine(padding, line, { color: COLOR_WARNING_TEXT });
    y += padding + 8;
  }

  const tableCountX = contentWidth - TABLE_COUNT_FROM_RIGHT_PT;
  const rule = (color, lineWidthPt = 0.5) => page.line(x, y, x + contentWidth, y, { color, lineWidthPt });
  const rowBaseline = (rowTop) => rowTop + TABLE_ROW_PADDING_PT + BODY_LINE_HEIGHT_PT / 2 + BODY_SIZE_PT * 0.35;

  function tableHeader() {
    const baseline = rowBaseline(y);
    const cell = (xOffset, text) => page.text(x + xOffset, baseline, text, { font: 'helveticaBold', sizePt: BODY_SIZE_PT, color: COLOR_TEXT });
    cell(TABLE_CODE_X_PT, 'Code');
    cell(TABLE_SWATCH_X_PT, 'Color');
    cell(TABLE_NAME_X_PT, 'Name');
    cell(tableCountX, 'Count');
    y += BODY_LINE_HEIGHT_PT + TABLE_ROW_PADDING_PT * 2;
    rule(COLOR_RULE);
  }
  tableHeader();

  const nameWidth = tableCountX - TABLE_NAME_X_PT - 8;
  for (const material of model.materials) {
    const nameLines = wrapText(material.name, 'helvetica', BODY_SIZE_PT, nameWidth);
    const rowHeight = nameLines.length * BODY_LINE_HEIGHT_PT + TABLE_ROW_PADDING_PT * 2;
    if (y + rowHeight > bottomLimit) {
      nextColumn();
      tableHeader();
    }
    const baseline = rowBaseline(y);
    page.text(x + TABLE_CODE_X_PT, baseline, material.code, { sizePt: BODY_SIZE_PT, color: COLOR_TEXT });
    page.rect(
      x + TABLE_SWATCH_X_PT,
      y + TABLE_ROW_PADDING_PT + (BODY_LINE_HEIGHT_PT - SWATCH_SIZE_PT) / 2,
      SWATCH_SIZE_PT,
      SWATCH_SIZE_PT,
      { fill: hexToPdfColor(material.hex), stroke: COLOR_SWATCH_BORDER }
    );
    nameLines.forEach((line, i) => {
      page.text(x + TABLE_NAME_X_PT, baseline + i * BODY_LINE_HEIGHT_PT, line, { sizePt: BODY_SIZE_PT, color: COLOR_TEXT });
    });
    page.text(x + tableCountX, baseline, String(material.count), { sizePt: BODY_SIZE_PT, color: COLOR_TEXT });
    y += rowHeight;
    rule(COLOR_RULE);
  }

  // Total row — replaces the last row's hairline with a heavier rule above it.
  ensureSpace(BODY_LINE_HEIGHT_PT + TABLE_ROW_PADDING_PT * 2);
  rule(COLOR_TOTAL_RULE, 1.5);
  const totalBaseline = rowBaseline(y);
  page.text(x + TABLE_CODE_X_PT, totalBaseline, 'Total beads', { font: 'helveticaBold', sizePt: BODY_SIZE_PT, color: COLOR_TEXT });
  page.text(x + tableCountX, totalBaseline, String(model.totalBeadCount), { font: 'helveticaBold', sizePt: BODY_SIZE_PT, color: COLOR_TEXT });
  y += BODY_LINE_HEIGHT_PT + TABLE_ROW_PADDING_PT * 2 + 14;

  // ---- Word chart ----
  if (model.chartLines.length > 0) heading('Word chart');

  const charsPerLine = Math.floor(contentWidth / CHART_CHAR_WIDTH_PT);
  for (const chartLine of model.chartLines) {
    const font = chartLine.bold ? 'courierBold' : 'courier';
    // "<label> <arrow>: " — the arrow takes one character cell and is drawn,
    // not typed: the built-in fonts have no arrow glyphs.
    const prefix = `${chartLine.label}  : `;
    const runLines = wrapChartRuns(chartLine.runs, prefix.length, charsPerLine);
    ensureSpace(runLines.length * CHART_LINE_HEIGHT_PT);

    runLines.forEach((runText, i) => {
      // A row with more run lines than fit in a whole column still has to
      // break somewhere.
      if (y + CHART_LINE_HEIGHT_PT > bottomLimit) nextColumn();
      const baseline = y + CHART_LINE_HEIGHT_PT / 2 + CHART_SIZE_PT * 0.35;
      const lead = i === 0 ? prefix : ' '.repeat(prefix.length);
      page.text(x, baseline, lead + runText, { font, sizePt: CHART_SIZE_PT, color: COLOR_TEXT });

      if (i === 0) {
        const arrowCellX = x + (chartLine.label.length + 1) * CHART_CHAR_WIDTH_PT;
        const midY = baseline - CHART_SIZE_PT * 0.3;
        const left = arrowCellX + 0.4;
        const right = arrowCellX + CHART_CHAR_WIDTH_PT - 0.4;
        const tip = chartLine.reversed ? left : right;
        const barb = chartLine.reversed ? 2.2 : -2.2;
        const stroke = { color: COLOR_TEXT, lineWidthPt: chartLine.bold ? 1.1 : 0.7 };
        page.line(left, midY, right, midY, stroke);
        page.line(tip, midY, tip + barb, midY - 2, stroke);
        page.line(tip, midY, tip + barb, midY + 2, stroke);

        // The Start Row marker hangs in the margin (or, in a second column,
        // the gutter) so the row's own text stays aligned with every other row.
        if (chartLine.isStart) {
          page.text(x - 9, baseline, '•', { font: 'helveticaBold', sizePt: CHART_SIZE_PT + 2, color: COLOR_TEXT });
        }
      }
      y += CHART_LINE_HEIGHT_PT;
    });
  }

  // ---- Reference image, on its own page ----
  if (model.referenceImage) {
    newPage();
    heading('Reference Image');
    y += 4;
    const { widthPt: imageWidthPt, heightPt: imageHeightPt } = model.referenceImage;
    const imageRef = pdf.addImage(model.referenceImage);
    page.image(imageRef, x, y, imageWidthPt, imageHeightPt);
    page.rect(x, y, imageWidthPt, imageHeightPt, { stroke: [0.8, 0.8, 0.8] });
  }

  return pdf.toBytes();
}
