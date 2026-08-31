import { describe, expect, it } from 'vitest';
import { readXlsx, XlsxError } from '../src/xlsx';
import { importWorkbook, yearFromFileName } from '../src/workbook';
import { PRESUPUESTO_XLSX } from '../src/profiles/presupuesto';
import { buildXlsx, monthSheet } from './xlsx-fixture';

const ctx = { accountId: 'acc-1', year: 2025 };

const workbook = () =>
  readXlsx(
    buildXlsx([
      { name: 'Totales', cells: { A1: 'Resumen anual', B2: 12345 } },
      monthSheet(
        'Enero',
        [
          ['Nomina', 3974.35],
          ['intereses', 25.3],
          ['kaution', 3240],
        ],
        [
          ['Alquiler', 1270],
          ['supermercado', 12.69],
          ['comida fuera', 20],
          ['comida fuera', 20],
          ['comida fuera', -20],
          ['kaution', 2475],
          ['intereses', 37.74],
          ['tarjeta de credito', 150],
        ],
      ),
      monthSheet('Febrero', [['Nomina', 3974.35]], [['Alquiler', 1270]]),
      { name: 'Backend', cells: { A1: 'Spending Concetps', A2: 'supermercado' } },
      { name: 'Venta Objetivos', cells: { A1: 'ignored' } },
    ]),
  );

describe('readXlsx', () => {
  it('lists every sheet in workbook order', () => {
    expect(workbook().sheetNames).toEqual(['Totales', 'Enero', 'Febrero', 'Backend', 'Venta Objetivos']);
  });

  it('resolves shared strings rather than returning their indices', () => {
    expect(workbook().sheet('Enero')?.get('A2')?.value).toBe('Nomina');
  });

  it('returns null for a sheet that is not there', () => {
    expect(workbook().sheet('Marzo')).toBeNull();
  });

  it('rejects a file that is not a spreadsheet instead of returning nonsense', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3, 4]))).toThrow(XlsxError);
  });
});

describe('importWorkbook with the Presupuesto profile', () => {
  const result = importWorkbook(workbook(), PRESUPUESTO_XLSX, ctx);
  const enero = result.transactions.filter((t) => t.bookingDate === '2025-01-01');

  it('reads only the month sheets, ignoring summary and lookup sheets', () => {
    // Enero: 3 income + 8 expense rows; Febrero: 1 + 1.
    expect(result.transactions).toHaveLength(11 + 2);
    expect(result.issues).toHaveLength(0);
  });

  it('stays quiet about months the year has not reached yet', () => {
    // The fixture holds Enero and Febrero only; the ten absent months are not
    // errors in a year still being filled in.
    expect(result.issues.filter((i) => i.message.includes('not found'))).toHaveLength(0);
  });

  it('reports a workbook with no month sheets at all', () => {
    const wrong = importWorkbook(
      readXlsx(buildXlsx([{ name: 'Sheet1', cells: { A1: 'something else' } }])),
      PRESUPUESTO_XLSX,
      ctx,
    );
    expect(wrong.transactions).toHaveLength(0);
    expect(wrong.issues).toHaveLength(1);
    expect(wrong.issues[0]?.message).toContain('No month sheets found');
  });

  it('dates every row to the first of its month, since the sheet records no day', () => {
    expect(new Set(result.transactions.map((t) => t.bookingDate))).toEqual(
      new Set(['2025-01-01', '2025-02-01']),
    );
  });

  it('signs rows from the block they sit in', () => {
    const salary = enero.find((t) => t.description === 'Nomina');
    const rent = enero.find((t) => t.description === 'Alquiler');
    expect(salary?.amount.minor).toBe(397435);
    expect(salary?.side).toBe('income');
    expect(rent?.amount.minor).toBe(-127000);
    expect(rent?.side).toBe('expense');
  });

  it('keeps a negative expense row on the expense side as a refund', () => {
    const refunds = enero.filter((t) => t.description === 'comida fuera' && t.amount.minor > 0);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.amount.minor).toBe(2000);
    expect(refunds[0]?.side).toBe('expense');
  });

  it('reconciles each side against the sheet total, refunds included', () => {
    const income = enero.filter((t) => t.side === 'income').reduce((a, t) => a + t.amount.minor, 0);
    const expense = enero.filter((t) => t.side === 'expense').reduce((a, t) => a - t.amount.minor, 0);
    expect(income).toBe(Math.round((3974.35 + 25.3 + 3240) * 100));
    expect(expense).toBe(Math.round((1270 + 12.69 + 20 + 20 - 20 + 2475 + 37.74 + 150) * 100));
  });

  it('maps the same concept differently per block', () => {
    const incomeKaution = enero.find((t) => t.description === 'kaution' && t.side === 'income');
    const expenseKaution = enero.find((t) => t.description === 'kaution' && t.side === 'expense');
    expect(incomeKaution?.suggestedCategoryId).toBe('income-refund');
    expect(expenseKaution?.suggestedCategoryId).toBe('housing-rent');

    const incomeInterest = enero.find((t) => t.description === 'intereses' && t.side === 'income');
    const expenseInterest = enero.find((t) => t.description === 'intereses' && t.side === 'expense');
    expect(incomeInterest?.suggestedCategoryId).toBe('income-investment');
    expect(expenseInterest?.suggestedCategoryId).toBe('fees-interest');
  });

  it('matches concepts regardless of accents and case', () => {
    const accented = importWorkbook(
      readXlsx(buildXlsx([monthSheet('Enero', [], [['Transporte Público', 58]])])),
      PRESUPUESTO_XLSX,
      ctx,
    );
    expect(accented.transactions[0]?.suggestedCategoryId).toBe('transport-public');
  });

  it('gives rows the source repeats verbatim distinct dedupe hashes', () => {
    const duplicated = enero.filter((t) => t.description === 'comida fuera' && t.amount.minor === -2000);
    expect(duplicated).toHaveLength(2);
    expect(duplicated[0]?.importHash).not.toBe(duplicated[1]?.importHash);
  });

  it('produces identical hashes on re-import, so nothing doubles', () => {
    const again = importWorkbook(workbook(), PRESUPUESTO_XLSX, ctx);
    expect(again.transactions.map((t) => t.importHash)).toEqual(
      result.transactions.map((t) => t.importHash),
    );
  });

  it('keeps hashes stable when a row is inserted above', () => {
    const withInsertion = importWorkbook(
      readXlsx(
        buildXlsx([
          monthSheet(
            'Enero',
            [['Nomina', 3974.35]],
            [
              ['cafe', 3], // inserted at the top, shifting every row below it
              ['Alquiler', 1270],
              ['supermercado', 12.69],
            ],
          ),
        ]),
      ),
      PRESUPUESTO_XLSX,
      ctx,
    );
    const before = importWorkbook(
      readXlsx(
        buildXlsx([
          monthSheet('Enero', [['Nomina', 3974.35]], [['Alquiler', 1270], ['supermercado', 12.69]]),
        ]),
      ),
      PRESUPUESTO_XLSX,
      ctx,
    );
    const hashOf = (rows: typeof before.transactions, description: string) =>
      rows.find((t) => t.description === description)?.importHash;

    expect(hashOf(withInsertion.transactions, 'Alquiler')).toBe(hashOf(before.transactions, 'Alquiler'));
    expect(hashOf(withInsertion.transactions, 'supermercado')).toBe(
      hashOf(before.transactions, 'supermercado'),
    );
  });

  it('records the source cell so a figure can be traced back to the sheet', () => {
    expect(enero.find((t) => t.description === 'Alquiler')?.notes).toBe('Enero!E2');
  });

  it('reports a half-filled row as an issue instead of guessing', () => {
    const broken = importWorkbook(
      readXlsx(buildXlsx([{ name: 'Enero', cells: { D2: 'supermercado', E3: 12.5 } }])),
      PRESUPUESTO_XLSX,
      ctx,
    );
    expect(broken.transactions).toHaveLength(0);
    expect(broken.issues).toHaveLength(2);
    expect(broken.issues[0]?.message).toContain('concept without an amount');
    expect(broken.issues[1]?.message).toContain('amount without a concept');
  });

  it('leaves an unknown concept for the rule engine rather than mis-filing it', () => {
    const unknown = importWorkbook(
      readXlsx(buildXlsx([monthSheet('Enero', [], [['abogado', 226.1]])])),
      PRESUPUESTO_XLSX,
      ctx,
    );
    expect(unknown.transactions[0]?.suggestedCategoryId).toBeNull();
  });
});

describe('yearFromFileName', () => {
  it('reads the year out of the tracker filename', () => {
    expect(yearFromFileName('Presupuesto2025.xlsx')).toBe(2025);
    expect(yearFromFileName('presupuesto-2026-final.xlsx')).toBe(2026);
  });

  it('falls back when the name carries no year', () => {
    expect(yearFromFileName('budget.xlsx', 2030)).toBe(2030);
  });
});
