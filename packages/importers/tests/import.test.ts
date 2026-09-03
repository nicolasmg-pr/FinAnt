import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCsv } from '../src/csv';
import { applyProfile, type ImportProfile } from '../src/profile';
import { GENERIC_CSV } from '../src/profiles/generic';
import { parseCamt053 } from '../src/camt053';
import { inspectCsv } from '../src/inspect';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const ctx = { accountId: 'acc-1' };

/**
 * A profile written in the test rather than shipped: it documents what the CSV
 * mapping engine can express (a category column carried across, a Spanish
 * header set) without tying the assertions to any one shipped profile.
 */
const SHEET_PROFILE: ImportProfile = {
  id: 'test-sheet',
  label: 'Test sheet',
  dateFormat: 'auto',
  decimalSeparator: 'auto',
  defaultCurrency: 'EUR',
  columns: {
    bookingDate: { headerAny: ['fecha', 'date'] },
    description: { headerAny: ['concepto', 'description'] },
    amount: { headerAny: ['importe', 'amount'] },
    debit: { headerAny: ['gasto', 'expense'] },
    credit: { headerAny: ['ingreso', 'income'] },
    category: { headerAny: ['categoria', 'category'] },
    notes: { headerAny: ['notas', 'notes'] },
  },
  signConvention: 'signed',
  categoryMap: {
    supermercado: 'food-groceries',
    nomina: 'income-salary',
    suscripciones: 'subscriptions',
    groceries: 'food-groceries',
    salary: 'income-salary',
    subscriptions: 'subscriptions',
  },
};

describe('generic CSV profile', () => {
  it('reads a single signed amount column with Spanish headers and formatting', () => {
    const result = applyProfile(readCsv(fixture('sheet-signed.csv')), SHEET_PROFILE, ctx);
    expect(result.transactions).toHaveLength(3);
    const [groceries, salary] = result.transactions;
    expect(groceries?.bookingDate).toBe('2026-01-05');
    expect(groceries?.amount.minor).toBe(-5240);
    expect(salary?.amount.minor).toBe(260000);
  });

  it("carries the sheet's own category across instead of re-guessing it", () => {
    const result = applyProfile(readCsv(fixture('sheet-signed.csv')), SHEET_PROFILE, ctx);
    expect(result.transactions[0]?.suggestedCategoryId).toBe('food-groceries');
    expect(result.transactions[2]?.suggestedCategoryId).toBe('subscriptions');
  });

  it('reports the totals row as an issue rather than importing or hiding it', () => {
    const result = applyProfile(readCsv(fixture('sheet-signed.csv')), SHEET_PROFILE, ctx);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('booking date');
    expect(result.issues[0]?.row).toBe(4);
  });

  it('reads a sheet that splits income and expense into two columns', () => {
    const result = applyProfile(readCsv(fixture('sheet-two-column.csv')), SHEET_PROFILE, {
      ...ctx,
    });
    expect(result.transactions.map((t) => t.amount.minor)).toEqual([-5240, 260000, -1299]);
  });

  it('gives every row a stable import hash so a re-import does not double it', () => {
    const once = applyProfile(readCsv(fixture('sheet-signed.csv')), SHEET_PROFILE, ctx);
    const twice = applyProfile(readCsv(fixture('sheet-signed.csv')), SHEET_PROFILE, ctx);
    expect(once.transactions.map((t) => t.importHash)).toEqual(
      twice.transactions.map((t) => t.importHash),
    );
    expect(new Set(once.transactions.map((t) => t.importHash)).size).toBe(3);
  });

  it('flips signs when the sheet writes expenses as positive numbers', () => {
    const flipped: ImportProfile = { ...SHEET_PROFILE, signConvention: 'expense-positive' };
    const result = applyProfile(readCsv(fixture('sheet-signed.csv')), flipped, ctx);
    expect(result.transactions[0]?.amount.minor).toBe(5240);
  });
});

describe('GENERIC_CSV fallback', () => {
  it('recognises income/expense column names used by hand-kept sheets', () => {
    const result = applyProfile(readCsv(fixture('sheet-two-column.csv')), GENERIC_CSV, ctx);
    expect(result.transactions.map((t) => t.amount.minor)).toEqual([-5240, 260000, -1299]);
    expect(result.transactions.map((t) => t.side)).toEqual(['expense', 'income', 'expense']);
  });
});

describe('inspectCsv', () => {
  it('classifies columns so a profile can be written from evidence', () => {
    const report = inspectCsv(fixture('sheet-two-column.csv'));
    expect(report.delimiter).toBe(',');
    expect(report.columns[0]?.guess).toBe('date');
    expect(report.columns[3]?.guess).toBe('amount');
  });
});

describe('parseCamt053', () => {
  const result = parseCamt053(fixture('statement.camt053.xml'), ctx);

  it('signs entries from CdtDbtInd, not from the amount', () => {
    expect(result.transactions.map((t) => t.amount.minor)).toEqual([-5240, 260000]);
  });

  it('reads counterparty and remittance information', () => {
    expect(result.transactions[0]?.counterparty).toBe('MERCADONA SA');
    expect(result.transactions[0]?.description).toContain('MERCADONA');
  });

  it('keeps the end-to-end id for dedupe but drops the NOTPROVIDED placeholder', () => {
    expect(result.transactions[0]?.externalId).toBe('E2E-0001');
    expect(result.transactions[1]?.externalId).toBeNull();
  });

  it('reports a non-camt file as an issue instead of throwing', () => {
    const bad = parseCamt053('<html><body>nope</body></html>', ctx);
    expect(bad.transactions).toHaveLength(0);
    expect(bad.issues).toHaveLength(1);
  });

  it('reads which account the statement belongs to', () => {
    expect(result.statementAccount).toEqual({
      iban: 'ES9121000418450200051332',
      name: 'Banco de Pruebas',
    });
  });

  it('returns an empty account when the statement does not name one', () => {
    const bare = parseCamt053(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">' +
        '<BkToCstmrStmt><Stmt><Id>S-1</Id></Stmt></BkToCstmrStmt></Document>',
      ctx,
    );
    expect(bare.statementAccount).toEqual({ iban: null, name: null });
    expect(bare.issues).toHaveLength(0);

    const bad = parseCamt053('<html><body>nope</body></html>', ctx);
    expect(bad.statementAccount).toEqual({ iban: null, name: null });
  });

  it('compacts an IBAN written with spaces', () => {
    const spaced = parseCamt053(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>' +
        '<Acct><Id><IBAN>es91 2100 0418 4502 0005 1332</IBAN></Id></Acct>' +
        '</Stmt></BkToCstmrStmt></Document>',
      ctx,
    );
    expect(spaced.statementAccount.iban).toBe('ES9121000418450200051332');
    expect(spaced.statementAccount.name).toBeNull();
  });

  it('warns when one file carries statements for more than one account', () => {
    const stmt = (iban: string) => `<Stmt><Acct><Id><IBAN>${iban}</IBAN></Id></Acct></Stmt>`;
    const two = parseCamt053(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>' +
        stmt('ES9121000418450200051332') +
        stmt('DE89370400440532013000') +
        '</BkToCstmrStmt></Document>',
      ctx,
    );
    expect(two.statementAccount.iban).toBe('ES9121000418450200051332');
    expect(two.issues).toHaveLength(1);
    expect(two.issues[0]?.message).toContain('2 accounts');
    expect(two.issues[0]?.message).not.toContain('ES91');

    const same = parseCamt053(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>' +
        stmt('ES9121000418450200051332') +
        stmt('es91 2100 0418 4502 0005 1332') +
        '</BkToCstmrStmt></Document>',
      ctx,
    );
    expect(same.issues).toHaveLength(0);
  });
});
