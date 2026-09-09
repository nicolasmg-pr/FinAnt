import { describe, expect, it } from 'vitest';
import { fnv1aHash, importHashOf } from '../src/dedupe';

describe('importHashOf', () => {
  // Golden values. These hashes are stored in every existing database as
  // transactions.import_hash and are the dedupe key: if this test fails, the
  // change under it would re-import the owner's whole history as new rows.
  it('has not changed', () => {
    expect(
      importHashOf({
        accountId: 'acc-1',
        bookingDate: '2026-01-15',
        amountMinor: -1299,
        description: 'NETFLIX.COM',
      }),
    ).toBe('h7d630bf823');
  });

  it('has not changed for a discriminated row', () => {
    expect(
      importHashOf({
        accountId: 'acc-1',
        bookingDate: '2026-01-15',
        amountMinor: -1299,
        description: 'NETFLIX.COM',
        discriminator: 2,
      }),
    ).toBe('h2ceb8efe24');
  });
});

describe('fnv1aHash', () => {
  it('is stable and differs by input', () => {
    expect(fnv1aHash('abc')).toBe(fnv1aHash('abc'));
    expect(fnv1aHash('abc')).not.toBe(fnv1aHash('abd'));
  });
});
