import { describe, expect, it } from 'vitest';
import { pdfTable } from '../src/pdf/table';
import type { PdfPage, PdfTextItem } from '../src/pdf/index';

const item = (text: string, x: number, y: number): PdfTextItem => ({ text, x, y, fontSize: 8 });

const HEADERS = ['DATUM', 'TYP', 'BESCHREIBUNG', 'ZAHLUNGSEINGANG', 'ZAHLUNGSAUSGANG', 'SALDO'];
const SPEC = { headers: HEADERS, anchor: 'SALDO' };

/** The header band, at the x positions the real statement uses. */
const header = (y: number): PdfTextItem[] => [
  item('DATUM', 74, y),
  item('TYP', 101, y),
  item('BESCHREIBUNG', 161, y),
  item('ZAHLUNGSEINGANG', 369, y),
  item('ZAHLUNGSAUSGANG', 423, y),
  item('SALDO', 501, y),
];

/** One movement: the date is split over two lines around the middle one. */
const movement = (
  y: number,
  parts: {
    day: string;
    year: string;
    typ: string;
    text: string;
    out?: string;
    in?: string;
    saldo: string;
  },
): PdfTextItem[] => [
  item(parts.day, 74, y + 4),
  item(parts.typ, 101, y),
  item(parts.text, 161, y),
  ...(parts.in ? [item(parts.in, 369, y)] : []),
  ...(parts.out ? [item(parts.out, 423, y)] : []),
  item(parts.saldo, 479, y),
  item(parts.year, 74, y - 4),
];

const page = (items: PdfTextItem[][], number = 1): PdfPage => ({ number, items: items.flat() });

describe('pdfTable', () => {
  const pages = [
    page([
      header(684),
      movement(664, {
        day: '05 Sep.',
        year: '2025',
        typ: 'Kartentransaktion',
        text: 'REWE',
        out: '12,34 €',
        saldo: '1.000,00 €',
      }),
      movement(632, {
        day: '04 Sep.',
        year: '2025',
        typ: 'Überweisung',
        text: 'Gehalt',
        in: '2.400,00 €',
        saldo: '1.012,34 €',
      }),
    ]),
  ];

  it('uses the header labels as the table header', () => {
    expect(pdfTable(pages, SPEC).header).toEqual(HEADERS);
  });

  it('emits one row per movement, in the order they appear down the page', () => {
    const table = pdfTable(pages, SPEC);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.[1]).toBe('Kartentransaktion');
    expect(table.rows[1]?.[1]).toBe('Überweisung');
  });

  it('joins the two halves of a date cell that straddles the row', () => {
    expect(pdfTable(pages, SPEC).rows[0]?.[0]).toBe('05 Sep. 2025');
  });

  it('keeps the incoming and outgoing columns apart', () => {
    const [expense, income] = pdfTable(pages, SPEC).rows;
    expect(expense?.[3]).toBe('');
    expect(expense?.[4]).toBe('12,34 €');
    expect(income?.[3]).toBe('2.400,00 €');
    expect(income?.[4]).toBe('');
  });

  it('assigns a right-aligned balance to its own column, not the one before it', () => {
    // SALDO's header sits at 501 but its values are right-aligned and start at
    // 479, left of the header. Nearest-header wins; a boundary at 501 would not.
    expect(pdfTable(pages, SPEC).rows[0]?.[5]).toBe('1.000,00 €');
  });

  it('gathers a wrapped description into one cell', () => {
    const wrapped = [
      page([
        header(684),
        movement(664, {
          day: '05 Sep.',
          year: '2025',
          typ: 'Handel',
          text: 'first part',
          out: '1,00 €',
          saldo: '9,00 €',
        }),
        [item('second part', 161, 650)],
        movement(632, {
          day: '04 Sep.',
          year: '2025',
          typ: 'Handel',
          text: 'next',
          out: '2,00 €',
          saldo: '8,00 €',
        }),
      ]),
    ];
    expect(pdfTable(wrapped, SPEC).rows[0]?.[2]).toBe('first part second part');
    expect(pdfTable(wrapped, SPEC).rows[1]?.[2]).toBe('next');
  });

  it('reads every page that carries the header', () => {
    const two = [pages[0]!, { ...pages[0]!, number: 2 }];
    expect(pdfTable(two, SPEC).rows).toHaveLength(4);
  });

  it('ignores a page with no header band at all', () => {
    const other = page([[item('Legal small print', 74, 700), item('9,99 €', 399, 650)]], 2);
    expect(pdfTable([pages[0]!, other], SPEC).rows).toHaveLength(2);
  });

  it('ignores a second table whose columns do not match the header', () => {
    // Pages 43 onward of the real statement carry a different grid. Anchoring on
    // the header is what keeps its ~158 money cells out of the movement list.
    const foreign = page(
      [
        [
          item('27 Sep. 2025', 74, 600),
          item('SETTLEMENT', 202, 600),
          item('9,99 €', 399, 600),
          item('999,99 €', 489, 600),
        ],
      ],
      3,
    );
    expect(pdfTable([pages[0]!, foreign], SPEC).rows).toHaveLength(2);
  });

  it('records the page a row came from, so an issue can name it', () => {
    const table = pdfTable([pages[0]!, { ...pages[0]!, number: 7 }], SPEC);
    expect(table.rowLines).toEqual([1, 1, 7, 7]);
  });

  it('ignores everything above the header, such as a page title', () => {
    const titled = page([[item('Certificado', 74, 732)], ...pages[0]!.items.map((i) => [i])]);
    expect(pdfTable([titled], SPEC).rows).toHaveLength(2);
  });
});

describe('the last row on a page', () => {
  it('does not swallow the footer beneath it', () => {
    const withFooter = [
      page([
        header(684),
        movement(664, {
          day: '05 Sep.',
          year: '2025',
          typ: 'Handel',
          text: 'one',
          out: '1,00 €',
          saldo: '9,00 €',
        }),
        movement(632, {
          day: '04 Sep.',
          year: '2025',
          typ: 'Handel',
          text: 'two',
          out: '2,00 €',
          saldo: '8,00 €',
        }),
        [item('Generated on 2026-09-03 12:35:00 Europe/Madrid', 74, 90)],
      ]),
    ];
    const table = pdfTable(withFooter, SPEC);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]?.[0]).toBe('04 Sep. 2025');
  });
});
