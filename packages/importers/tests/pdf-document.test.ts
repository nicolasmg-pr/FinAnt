import { describe, expect, it } from 'vitest';
import { asName, asNumber, latin1 } from '../src/pdf/objects';
import { openPdf } from '../src/pdf/document';
import { buildClassicPdf, buildModernPdf, pdfBytes, type PdfObject } from './pdf-fixture';

/** Two pages under a nested Pages node, with Resources inherited from the root. */
const OBJECTS: readonly PdfObject[] = [
  { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>', compressed: true },
  {
    num: 2,
    body: '<< /Type /Pages /Kids [3 0 R] /Count 2 /Resources << /Font << /F1 6 0 R >> >> >>',
    compressed: true,
  },
  {
    num: 3,
    body: '<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 >>',
    compressed: true,
  },
  { num: 4, body: '<< /Type /Page /Parent 3 0 R /Contents 7 0 R >>', compressed: true },
  { num: 5, body: '<< /Type /Page /Parent 3 0 R /Contents 8 0 R >>', compressed: true },
  { num: 6, body: '<< /Type /Font /BaseFont /Probe >>', compressed: true },
  { num: 7, body: '<< >>', stream: pdfBytes('first page content') },
  { num: 8, body: '<< >>', stream: pdfBytes('second page content') },
];

const TRAILER = '/Root 1 0 R';

describe.each([
  ['a classic xref table', () => buildClassicPdf(OBJECTS, TRAILER)],
  ['a PDF 2.0 xref stream with an object stream', () => buildModernPdf(OBJECTS, TRAILER)],
])('%s', (_label, build) => {
  it('finds every page in the tree', () => {
    expect(openPdf(build()).pages).toHaveLength(2);
  });

  it('inflates a page content stream', () => {
    const doc = openPdf(build());
    expect(latin1({ bytes: doc.contentOf(doc.pages[0]!) })).toBe('first page content');
    expect(latin1({ bytes: doc.contentOf(doc.pages[1]!) })).toBe('second page content');
  });

  it('inherits Resources from an ancestor node', () => {
    const doc = openPdf(build());
    const font = doc.fontsOf(doc.pages[0]!).get('F1');
    expect(asName(font?.get('BaseFont'))).toBe('Probe');
  });

  it('resolves an indirect reference to its object', () => {
    const doc = openPdf(build());
    expect(asNumber(doc.resolve({ num: 2, gen: 0 }) instanceof Map ? 1 : 0)).toBe(1);
  });
});

describe('joined content streams', () => {
  it('concatenates a Contents array, which splits mid-operator', () => {
    const objects: readonly PdfObject[] = [
      { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /Contents [4 0 R 5 0 R] >>' },
      { num: 4, body: '<< >>', stream: pdfBytes('(split ') },
      { num: 5, body: '<< >>', stream: pdfBytes('here) Tj') },
    ];
    const doc = openPdf(buildClassicPdf(objects, TRAILER));
    expect(latin1({ bytes: doc.contentOf(doc.pages[0]!) })).toBe('(split \nhere) Tj');
  });
});

describe('refusing what it cannot read', () => {
  it('rejects an encrypted document rather than returning empty pages', () => {
    const bytes = buildClassicPdf(OBJECTS, '/Root 1 0 R /Encrypt 9 0 R');
    expect(() => openPdf(bytes)).toThrow(/encrypted/i);
  });

  it('rejects a file that is not a PDF at all', () => {
    expect(() => openPdf(pdfBytes('Fecha;Concepto;Importe\n'))).toThrow(/not a pdf/i);
  });
});
