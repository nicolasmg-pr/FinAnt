import { money } from '@finant/core';
import type { ISODate, Transaction, TransactionSide } from '@finant/core';

let counter = 0;

/**
 * A movement with everything the assistant does not care about already filled
 * in. Hand-written, never copied from a real export.
 */
export function tx(overrides: Partial<Transaction> = {}): Transaction {
  counter += 1;
  const side: TransactionSide = overrides.side ?? 'expense';
  const base: Transaction = {
    id: `tx-${counter}`,
    accountId: 'acc-current',
    bookingDate: '2026-09-01' as ISODate,
    valueDate: null,
    amount: money(side === 'expense' ? -1000 : 1000, 'EUR'),
    side,
    description: 'Test movement',
    counterparty: null,
    reference: null,
    categoryId: null,
    categorySource: 'none',
    source: 'file-import',
    externalId: null,
    importHash: `hash-${counter}`,
    notes: null,
    excludedFromStats: false,
    transferPeerId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

export function resetFactory(): void {
  counter = 0;
}
