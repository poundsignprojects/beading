// A deliberately small PDF 1.4 writer — just what printPdf.js's printout needs:
// text in the four built-in fonts below, filled/stroked rectangles, straight
// lines, and one kind of image. No library (Decision #2); the built-in "base 14"
// fonts need no embedding, which is what keeps this short.
//
// Callers work in points with a TOP-LEFT origin (y grows downward, like the
// canvas and the DOM); the flip to PDF's bottom-left origin happens here only.

export const PDF_FONTS = {
  helvetica: { resourceName: 'F1', baseFont: 'Helvetica' },
  helveticaBold: { resourceName: 'F2', baseFont: 'Helvetica-Bold' },
  courier: { resourceName: 'F3', baseFont: 'Courier' },
  courierBold: { resourceName: 'F4', baseFont: 'Courier-Bold' },
};

// Courier's advance width, in 1/1000 em — every glyph, both weights.
const COURIER_WIDTH = 600;

// Helvetica's advance widths for ASCII 32..126, in 1/1000 em (from Adobe's own
// AFM metrics for the font). Used only to decide where to wrap a line.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// Anything outside ASCII (accented letters, dashes, the bullet) is measured as
// an average-width glyph — close enough for wrapping.
const HELVETICA_FALLBACK_WIDTH = 556;
// Helvetica-Bold runs a little wider than regular; measuring it as regular
// times this keeps a wrapped bold line from overrunning the margin.
const HELVETICA_BOLD_WIDTH_FACTOR = 1.1;

// The built-in fonts are used with WinAnsiEncoding: ASCII and Latin-1 map to
// their own code, plus this handful of punctuation marks. Anything else (emoji,
// non-Latin scripts) has no glyph in these fonts at all and becomes "?".
const WIN_ANSI_EXTRAS = new Map([
  [0x20ac, 0x80], [0x2026, 0x85], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x2122, 0x99],
]);
const UNENCODABLE_BYTE = 0x3f; // "?"

export function encodeWinAnsi(text) {
  const bytes = [];
  for (const char of String(text)) {
    const codePoint = char.codePointAt(0);
    if ((codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff)) {
      bytes.push(codePoint);
    } else {
      bytes.push(WIN_ANSI_EXTRAS.get(codePoint) ?? UNENCODABLE_BYTE);
    }
  }
  return bytes;
}

export function textWidthPt(text, font, sizePt) {
  const bytes = encodeWinAnsi(text);
  if (font === 'courier' || font === 'courierBold') return (bytes.length * COURIER_WIDTH * sizePt) / 1000;
  let units = 0;
  for (const byte of bytes) {
    units += byte >= 32 && byte <= 126 ? HELVETICA_WIDTHS[byte - 32] : HELVETICA_FALLBACK_WIDTH;
  }
  const factor = font === 'helveticaBold' ? HELVETICA_BOLD_WIDTH_FACTOR : 1;
  return (units * factor * sizePt) / 1000;
}

// "#rrggbb" -> [r, g, b] in 0..1, the form every color option below takes.
export function hexToPdfColor(hex) {
  const value = parseInt(String(hex).replace('#', ''), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

// zlib-wrapped deflate — exactly what a PDF /FlateDecode stream holds — via the
// platform's own CompressionStream (Safari 16.4+, Node 18+), so no compressor
// has to live in this codebase.
export async function deflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function num(value) {
  // Two decimals is far finer than any printer resolves, and keeps exponent
  // notation (which PDF doesn't allow) from ever appearing.
  return String(Number(value.toFixed(2)));
}

function colorOps(color, operator) {
  return `${num(color[0])} ${num(color[1])} ${num(color[2])} ${operator}`;
}

const BLACK = [0, 0, 0];

export function createPdfDocument({ widthPt, heightPt }) {
  const pages = [];
  const images = [];

  function addPage() {
    const ops = [];
    const usedImages = new Set();
    const flipY = (yFromTop) => heightPt - yFromTop;

    const page = {
      // y is the text's baseline, measured from the top of the page.
      text(x, y, text, { font = 'helvetica', sizePt = 10, color = BLACK } = {}) {
        const hex = encodeWinAnsi(text).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        if (!hex) return;
        ops.push(`BT /${PDF_FONTS[font].resourceName} ${num(sizePt)} Tf ${colorOps(color, 'rg')} ${num(x)} ${num(flipY(y))} Td <${hex}> Tj ET`);
      },
      // x/y is the rectangle's top-left corner.
      rect(x, y, width, height, { fill = null, stroke = null, lineWidthPt = 0.5 } = {}) {
        if (!fill && !stroke) return;
        const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
        const parts = ['q'];
        if (fill) parts.push(colorOps(fill, 'rg'));
        if (stroke) parts.push(colorOps(stroke, 'RG'), `${num(lineWidthPt)} w`);
        parts.push(`${num(x)} ${num(flipY(y + height))} ${num(width)} ${num(height)} re ${paint}`, 'Q');
        ops.push(parts.join(' '));
      },
      line(x1, y1, x2, y2, { color = BLACK, lineWidthPt = 0.5 } = {}) {
        ops.push(`q ${colorOps(color, 'RG')} ${num(lineWidthPt)} w ${num(x1)} ${num(flipY(y1))} m ${num(x2)} ${num(flipY(y2))} l S Q`);
      },
      image(imageRef, x, y, width, height) {
        usedImages.add(imageRef);
        ops.push(`q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(flipY(y + height))} cm /Im${imageRef.index} Do Q`);
      },
    };
    pages.push({ ops, usedImages });
    return page;
  }

  // data: the image's pixels as tightly packed 8-bit RGB (no alpha), row by
  // row from the top, already run through deflateBytes.
  function addImage({ widthPx, heightPx, data }) {
    const imageRef = { index: images.length + 1, widthPx, heightPx, data };
    images.push(imageRef);
    return imageRef;
  }

  function toBytes() {
    const encoder = new TextEncoder();
    // Object numbers are fixed up front so objects can reference each other
    // before they're written: catalog, page tree, the four fonts, every
    // image, then a (page, content stream) pair per page.
    const fontKeys = Object.keys(PDF_FONTS);
    const firstFontId = 3;
    const firstImageId = firstFontId + fontKeys.length;
    const firstPageId = firstImageId + images.length;
    const pageId = (i) => firstPageId + i * 2;
    const objectCount = firstPageId - 1 + pages.length * 2;

    const bodies = new Array(objectCount + 1);
    const stream = (dictEntries, bytes) => [`<< ${dictEntries} /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream'];

    bodies[1] = ['<< /Type /Catalog /Pages 2 0 R >>'];
    bodies[2] = [`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`];
    fontKeys.forEach((key, i) => {
      bodies[firstFontId + i] = [`<< /Type /Font /Subtype /Type1 /BaseFont /${PDF_FONTS[key].baseFont} /Encoding /WinAnsiEncoding >>`];
    });
    images.forEach((image, i) => {
      bodies[firstImageId + i] = stream(
        `/Type /XObject /Subtype /Image /Width ${image.widthPx} /Height ${image.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
        image.data
      );
    });
    const fontResources = fontKeys.map((key, i) => `/${PDF_FONTS[key].resourceName} ${firstFontId + i} 0 R`).join(' ');
    pages.forEach((page, i) => {
      const xObjects = [...page.usedImages].map((image) => `/Im${image.index} ${firstImageId + image.index - 1} 0 R`).join(' ');
      const resources = `/Font << ${fontResources} >>${xObjects ? ` /XObject << ${xObjects} >>` : ''}`;
      bodies[pageId(i)] = [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(widthPt)} ${num(heightPt)}] /Resources << ${resources} >> /Contents ${pageId(i) + 1} 0 R >>`,
      ];
      bodies[pageId(i) + 1] = stream('', encoder.encode(page.ops.join('\n')));
    });

    const chunks = [];
    let length = 0;
    const push = (part) => {
      const bytes = typeof part === 'string' ? encoder.encode(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };

    // The second line's four high-bit bytes are the conventional marker that
    // tells transfer tools this file is binary, not text.
    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const offsets = new Array(objectCount + 1);
    for (let id = 1; id <= objectCount; id++) {
      offsets[id] = length;
      push(`${id} 0 obj\n`);
      bodies[id].forEach(push);
      push('\nendobj\n');
    }
    const xrefOffset = length;
    push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= objectCount; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) {
      out.set(chunk, position);
      position += chunk.length;
    }
    return out;
  }

  return { addPage, addImage, toBytes, get pageCount() { return pages.length; } };
}
