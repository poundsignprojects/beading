import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPdfDocument, deflateBytes, encodeWinAnsi, hexToPdfColor, textWidthPt } from '../../export/pdfWriter.js';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

test('encodeWinAnsi keeps ASCII and Latin-1, maps known punctuation, and replaces the rest', () => {
  assert.deepEqual(encodeWinAnsi('Az'), [0x41, 0x7a]);
  assert.deepEqual(encodeWinAnsi('é×'), [0xe9, 0xd7]);
  assert.deepEqual(encodeWinAnsi('—•'), [0x97, 0x95]);
  // One "?" per character, including one outside the Basic Multilingual Plane.
  assert.deepEqual(encodeWinAnsi('→😀'), [0x3f, 0x3f]);
});

test('textWidthPt: Courier is 0.6 em per character, Helvetica uses per-glyph widths', () => {
  assert.equal(textWidthPt('abcde', 'courier', 10), 30);
  assert.equal(textWidthPt('abcde', 'courierBold', 10), 30);
  // i = 222, W = 944 (1/1000 em)
  assert.ok(Math.abs(textWidthPt('i', 'helvetica', 10) - 2.22) < 1e-9);
  assert.ok(Math.abs(textWidthPt('W', 'helvetica', 10) - 9.44) < 1e-9);
  assert.ok(textWidthPt('Wide', 'helveticaBold', 10) > textWidthPt('Wide', 'helvetica', 10));
});

test('hexToPdfColor converts to 0..1 components', () => {
  assert.deepEqual(hexToPdfColor('#ff0000'), [1, 0, 0]);
  assert.deepEqual(hexToPdfColor('#000000'), [0, 0, 0]);
});

test('toBytes writes a cross-reference table whose offsets point at each object', async () => {
  const pdf = createPdfDocument({ widthPt: 612, heightPt: 792 });
  const image = pdf.addImage({ widthPx: 1, heightPx: 1, data: await deflateBytes(new Uint8Array([255, 0, 0])) });
  const first = pdf.addPage();
  first.text(54, 60, 'Hello');
  first.rect(54, 80, 10, 10, { fill: [1, 0, 0], stroke: [0, 0, 0] });
  first.image(image, 54, 100, 20, 20);
  pdf.addPage().line(0, 0, 10, 10);

  const bytes = pdf.toBytes();
  const text = latin1(bytes);
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  assert.match(text, /\/Type \/Pages \/Count 2 /);

  const xrefOffset = Number(text.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 5), 'xref\n');
  const entries = [...text.slice(xrefOffset).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  // catalog + page tree + 4 fonts + 1 image + 2 x (page, contents)
  assert.equal(entries.length, 11);
  entries.forEach((offset, i) => {
    assert.equal(text.slice(offset, offset + `${i + 1} 0 obj\n`.length), `${i + 1} 0 obj\n`);
  });
});

test('every stream declares its exact byte length', () => {
  const pdf = createPdfDocument({ widthPt: 612, heightPt: 792 });
  pdf.addPage().text(10, 10, 'abc');
  const text = latin1(pdf.toBytes());
  const match = text.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.equal(match[2].length, Number(match[1]));
});

test('text is written as hex in WinAnsi, with y flipped to PDF space', () => {
  const pdf = createPdfDocument({ widthPt: 612, heightPt: 792 });
  pdf.addPage().text(54, 100, 'A—', { font: 'courierBold', sizePt: 10 });
  const text = latin1(pdf.toBytes());
  assert.match(text, /BT \/F4 10 Tf 0 0 0 rg 54 692 Td <4197> Tj ET/);
});
