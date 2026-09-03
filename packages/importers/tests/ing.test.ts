import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyProfile } from '../src/profile';
import { GENERIC_CSV, readStatementCsv } from '../src/profiles/index';

const FIXTURE = readFileSync(new URL('./fixtures/ing-umsatzanzeige.csv', import.meta.url), 'utf-8');

function importFixture(text = FIXTURE) {
  const { table, profile } = readStatementCsv(text);
  return { profile, ...applyProfile(table, profile, { accountId: 'acc-1' }) };
}

describe('ING Umsatzanzeige', () => {
  it('finds the table under the preamble instead of reading line 1 as the header', () => {
    const { profileId, transactions, issues } = importFixture();
    expect(profileId).toBe('ing-umsatzanzeige');
    expect(transactions).toHaveLength(3);
    expect(issues).toEqual([]);
  });

  it('takes the booking date from Buchung, not from Wertstellungsdatum', () => {
    const { transactions } = importFixture();
    expect(transactions[0]?.bookingDate).toBe('2026-03-02');
    expect(transactions[0]?.valueDate).toBe('2026-03-03');
  });

  it('reads a German signed amount as minor units on the right side', () => {
    const { transactions } = importFixture();
    expect(transactions[0]?.amount).toEqual({ minor: -2540, currency: 'EUR' });
    expect(transactions[0]?.side).toBe('expense');
    expect(transactions[1]?.amount).toEqual({ minor: 123456, currency: 'EUR' });
    expect(transactions[1]?.side).toBe('income');
  });

  it('takes the amount currency, not the balance currency that precedes it', () => {
    const withGbpBalance = FIXTURE.replace(';100,00;EUR;-25,40;EUR', ';100,00;GBP;-25,40;EUR');
    const { transactions } = importFixture(withGbpBalance);
    expect(transactions[0]?.amount.currency).toBe('EUR');
  });

  it('maps counterparty and booking text', () => {
    const { transactions } = importFixture();
    expect(transactions[0]?.counterparty).toBe('MUSTER MARKT GMBH');
    expect(transactions[0]?.description).toBe('Einkauf Filiale 12');
    expect(transactions[0]?.reference).toBe('Lastschrift');
  });

  it('falls back to the counterparty when Verwendungszweck is empty', () => {
    const { transactions } = importFixture();
    expect(transactions[2]?.description).toBe('BARGELDAUSZAHLUNG');
  });

  it('numbers an unreadable row by its line in the file, preamble included', () => {
    const broken = FIXTURE.replace('02.03.2026;03.03.2026', 'kein Datum;03.03.2026');
    const { issues } = importFixture(broken);
    // Line 14 is the header; the first movement is line 15.
    expect(issues).toEqual([
      expect.objectContaining({ row: 15, message: 'Unreadable or missing booking date' }),
    ]);
  });
});

describe('readStatementCsv', () => {
  it('falls back to the generic profile and still skips a preamble', () => {
    const text = [
      'Mein Export',
      'Erstellt am;03.09.2026',
      '',
      'Datum;Beschreibung;Betrag',
      '05.01.2026;CAFE;-3,20',
    ].join('\n');
    const { table, profile } = readStatementCsv(text);
    expect(profile.id).toBe('generic-csv');
    expect(table.header).toEqual(['Datum', 'Beschreibung', 'Betrag']);
    expect(table.rows).toHaveLength(1);
  });

  it('finds the header row for a forced profile too', () => {
    const { table, profile } = readStatementCsv(FIXTURE, { profile: GENERIC_CSV });
    expect(profile.id).toBe('generic-csv');
    expect(table.header[0]).toBe('Buchung');
  });
});
