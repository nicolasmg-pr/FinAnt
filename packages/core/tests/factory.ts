import { money } from '../src/money';
import { sideFromAmount } from '../src/side';
import { importHashOf } from '../src/dedupe';
import type { Transaction } from '../src/types';

let seq = 0;

export function tx(partial: {
  date: string;
  amount: number;
  description: string;
  counterparty?: string;
  categoryId?: string | null;
  excludedFromStats?: boolean;
  /** Overrides the sign-derived side, for refund cases. */
  side?: 'income' | 'expense';
  /** Explicit id when a test asserts on ordering; defaults to `t<n>`. */
  id?: string;
  /** Defaults to `acc-1`. Transfer tests need two accounts. */
  accountId?: string;
  categorySource?: 'auto' | 'manual' | 'none';
  transferPeerId?: string | null;
}): Transaction {
  seq += 1;
  const amountMinor = Math.round(partial.amount * 100);
  const accountId = partial.accountId ?? 'acc-1';
  return {
    id: partial.id ?? `t${seq}`,
    accountId,
    bookingDate: partial.date,
    valueDate: null,
    amount: money(amountMinor, 'EUR'),
    side: partial.side ?? sideFromAmount(money(amountMinor, 'EUR')),
    description: partial.description,
    counterparty: partial.counterparty ?? null,
    reference: null,
    categoryId: partial.categoryId ?? null,
    categorySource: partial.categorySource ?? 'none',
    source: 'file-import',
    externalId: null,
    importHash: importHashOf({
      accountId,
      bookingDate: partial.date,
      amountMinor,
      description: partial.description,
    }),
    notes: null,
    excludedFromStats: partial.excludedFromStats ?? false,
    transferPeerId: partial.transferPeerId ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/** 12 months of a plausible household: salary, rent, subscriptions, groceries. */
export function syntheticYear(startMonth = 1, year = 2025): Transaction[] {
  const out: Transaction[] = [];
  for (let m = startMonth; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    out.push(
      tx({
        date: `${year}-${mm}-25`,
        amount: 2600,
        description: 'NOMINA ACME SL',
        counterparty: 'ACME SL',
      }),
    );
    out.push(
      tx({
        date: `${year}-${mm}-01`,
        amount: -950,
        description: 'ALQUILER PISO',
        counterparty: 'INMOBILIARIA SUR',
      }),
    );
    out.push(
      tx({
        date: `${year}-${mm}-05`,
        amount: -12.99,
        description: 'NETFLIX.COM',
        counterparty: 'NETFLIX',
      }),
    );
    out.push(
      tx({
        date: `${year}-${mm}-08`,
        amount: -180 - m,
        description: 'COMPRA TARJ MERCADONA',
        counterparty: 'MERCADONA',
      }),
    );
    out.push(tx({ date: `${year}-${mm}-17`, amount: -45, description: 'RESTAURANTE EL PUERTO' }));
  }
  return out;
}
