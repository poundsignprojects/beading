import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrintPdf, wrapChartRuns, wrapText } from '../../export/printPdf.js';
import { textWidthPt } from '../../export/pdfWriter.js';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const pageCount = (bytes) => Number(latin1(bytes).match(/\/Type \/Pages \/Count (\d+)/)[1]);

function model(overrides = {}) {
  return {
    title: 'Test Pattern',
    infoLines: ['Delica 11/0, Peyote — 4 rows × 4 cols', 'Finished size: 5.20 mm × 7.20 mm'],
    emptyMessage: null,
    warning: null,
    materials: [{ code: 'A', hex: '#ff0000', name: 'Red', count: 8 }],
    totalBeadCount: 8,
    chartLines: [{ label: 'Row 1 & 2', reversed: false, runs: ['4A', '4-'], bold: false, isStart: true }],
    referenceImage: null,
    ...overrides,
  };
}

test('wrapText breaks on spaces and never exceeds the width', () => {
  const lines = wrapText('one two three four five six seven', 'helvetica', 10, 60);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(' '), 'one two three four five six seven');
  for (const line of lines) assert.ok(textWidthPt(line, 'helvetica', 10) <= 60);
});

test('wrapText splits a single word that is wider than the line', () => {
  const lines = wrapText('W'.repeat(40), 'helvetica', 10, 50);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), 'W'.repeat(40));
  for (const line of lines) assert.ok(textWidthPt(line, 'helvetica', 10) <= 50);
});

test('wrapText returns one empty line for empty text', () => {
  assert.deepEqual(wrapText('', 'helvetica', 10, 100), ['']);
});

test('wrapChartRuns keeps short rows on one line', () => {
  assert.deepEqual(wrapChartRuns(['4A', '2-', '1B'], 10, 84), ['4A 2- 1B']);
});

test('wrapChartRuns wraps at the space left after the prefix, never splitting a run', () => {
  // 20 chars per line minus a 10-char prefix leaves 10 for runs.
  const lines = wrapChartRuns(['11A', '22B', '33C', '4 ??', '55D'], 10, 20);
  assert.deepEqual(lines, ['11A 22B', '33C 4 ??', '55D']);
  for (const line of lines) assert.ok(line.length <= 10);
});

test('wrapChartRuns still places a run that is longer than the available space', () => {
  assert.deepEqual(wrapChartRuns(['123456789012A', '1B'], 10, 20), ['123456789012A', '1B']);
});

test('a short design fits on one page', () => {
  assert.equal(pageCount(buildPrintPdf(model())), 1);
});

test('a long word chart flows onto more pages', () => {
  const chartLines = Array.from({ length: 200 }, (_, i) => ({ label: `Row ${i + 1}`, reversed: i % 2 === 1, runs: ['4A'], bold: false, isStart: false }));
  assert.ok(pageCount(buildPrintPdf(model({ chartLines }))) >= 4);
});

test('the reference image gets a page of its own', () => {
  const referenceImage = { widthPx: 1, heightPx: 1, data: new Uint8Array([0]), widthPt: 100, heightPt: 100 };
  const text = latin1(buildPrintPdf(model({ referenceImage })));
  assert.equal(pageCount(Buffer.from(text, 'latin1')), 2);
  assert.match(text, /\/Subtype \/Image \/Width 1 \/Height 1/);
});

test('an empty design prints only the header and the message', () => {
  const text = latin1(buildPrintPdf(model({ emptyMessage: 'No beads placed yet', materials: [], chartLines: [], totalBeadCount: 0 })));
  const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
  assert.ok(text.includes(`<${hex('No beads placed yet')}>`));
  assert.ok(!text.includes(`<${hex('Materials')}>`));
});

test('tenth rows use the bold chart font and the start row gets a bullet', () => {
  const chartLines = [
    { label: 'Row 9', reversed: false, runs: ['4A'], bold: false, isStart: true },
    { label: 'Row 10', reversed: true, runs: ['4A'], bold: true, isStart: false },
  ];
  const text = latin1(buildPrintPdf(model({ chartLines })));
  const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
  assert.match(text, new RegExp(`/F3 10 Tf [^\\n]*<${hex('Row 9  : 4A')}>`));
  assert.match(text, new RegExp(`/F4 10 Tf [^\\n]*<${hex('Row 10  : 4A')}>`));
  assert.equal((text.match(/<95> Tj/g) ?? []).length, 1);
});
