import { describe, expect, it } from 'vitest';
import { decimalToString } from '@finant/core';
import { readCsv } from '../src/csv';
import { applyProfile, detectProfile } from '../src/profile';
import { TRADE_REPUBLIC_CSV } from '../src/profiles/trade-republic';
import { BUILT_IN_PROFILES } from '../src/profiles';

/**
 * Hand-written from the layout documented in docs/import-formats.md. A real
 * export never reaches the repository — see the project boundaries.
 */
const HEADER =
  '"datetime","date","account_type","category","type","asset_class","name","symbol",' +
  '"shares","price","amount","fee","tax","currency","original_amount","original_currency",' +
  '"fx_rate","description","transaction_id","counterparty_name","counterparty_iban",' +
  '"payment_reference","mcc_code"';

const row = (cells: Partial<Record<string, string>>): string => {
  const order = [
    'datetime', 'date', 'account_type', 'category', 'type', 'asset_class', 'name', 'symbol',
    'shares', 'price', 'amount', 'fee', 'tax', 'currency', 'original_amount',
    'original_currency', 'fx_rate', 'description', 'transaction_id', 'counterparty_name',
    'counterparty_iban', 'payment_reference', 'mcc_code',
  ];
  return order.map((k) => `"${cells[k] ?? ''}"`).join(',');
};

const BUY = row({
  datetime: '2024-04-12T14:33:22.728Z', date: '2024-04-12', account_type: 'DEFAULT',
  category: 'TRADING', type: 'BUY', asset_class: 'FUND', name: 'Core MSCI World USD (Acc)',
  symbol: 'IE00B4L5Y983', shares: '2.0000000000', price: '17.742000', amount: '-35.48',
  fee: '-1.00', currency: 'EUR', transaction_id: 'tr-buy-1',
});

const SELL = row({
  date: '2024-06-20', category: 'TRADING', type: 'SELL', asset_class: 'FUND',
  name: 'Core MSCI World USD (Acc)', symbol: 'IE00B4L5Y983', shares: '-0.8777240000',
  price: '18.288000', amount: '16.05', currency: 'EUR', description: 'Sell trade',
  transaction_id: 'tr-sell-1',
});

const DIVIDEND = row({
  date: '2024-06-04', category: 'CASH', type: 'DIVIDEND', asset_class: 'STOCK',
  name: 'Volkswagen (Vz.)', symbol: 'DE0007664039', shares: '0.0810000000', amount: '0.73',
  currency: 'EUR', description: 'Cash Dividend', transaction_id: 'tr-div-1',
});

const SAVEBACK = row({
  date: '2024-06-03', category: 'CASH', type: 'BENEFITS_SAVEBACK', asset_class: 'FUND',
  name: 'MSCI ACWI USD (Acc)', symbol: 'IE00B6R52259', amount: '7.97', currency: 'EUR',
  description: 'Your Saveback payment', transaction_id: 'tr-sb-1',
});

const CARD = row({
  date: '2025-01-09', category: 'CASH', type: 'CARD_TRANSACTION', amount: '-12.40',
  currency: 'EUR', description: 'REWE SAGT DANKE', counterparty_name: 'REWE',
  transaction_id: 'tr-card-1',
});

const parse = (...rows: string[]) =>
  applyProfile(readCsv([HEADER, ...rows].join('\n')), TRADE_REPUBLIC_CSV, {
    accountId: 'acc-tr',
  });

describe('trade-republic-csv profile', () => {
  it('is chosen by auto-detection over the other profiles', () => {
    const table = readCsv([HEADER, CARD].join('\n'));
    expect(detectProfile(table.header, BUILT_IN_PROFILES)?.id).toBe('trade-republic-csv');
  });

  it('reads a purchase as an expense carrying an investment leg', () => {
    const [t] = parse(BUY).transactions;
    expect(t?.side).toBe('expense');
    expect(t?.amount.minor).toBe(-3548);
    expect(t?.suggestedCategoryId).toBe('investment-trade');
    expect(t?.externalId).toBe('tr-buy-1');
    expect(t?.investment?.kind).toBe('buy');
    expect(t?.investment?.assetSymbol).toBe('IE00B4L5Y983');
    expect(t?.investment?.assetClass).toBe('fund');
    expect(decimalToString(t!.investment!.shares)).toBe('2.0000000000');
    expect(decimalToString(t!.investment!.unitPrice)).toBe('17.7420000000');
    expect(t?.investment?.fee.minor).toBe(100);
  });

  it('falls back to the asset name when the description column is blank', () => {
    const [t] = parse(BUY).transactions;
    expect(t?.description).toBe('Core MSCI World USD (Acc)');
  });

  it('reads a disposal as income with negative shares', () => {
    const [t] = parse(SELL).transactions;
    expect(t?.side).toBe('income');
    expect(t?.suggestedCategoryId).toBe('investment-trade');
    expect(decimalToString(t!.investment!.shares)).toBe('-0.8777240000');
  });

  it('books a dividend as income and refuses to read its share column', () => {
    const [t] = parse(DIVIDEND).transactions;
    expect(t?.side).toBe('income');
    expect(t?.suggestedCategoryId).toBe('income-investment');
    expect(t?.investment?.kind).toBe('dividend');
    // The file writes the holding at payment time here. It is not an acquisition.
    expect(decimalToString(t!.investment!.shares)).toBe('0.0000000000');
  });

  it('books a saveback as income with no shares', () => {
    const [t] = parse(SAVEBACK).transactions;
    expect(t?.side).toBe('income');
    expect(t?.investment?.kind).toBe('benefit');
    expect(decimalToString(t!.investment!.shares)).toBe('0.0000000000');
  });

  it('leaves an ordinary card payment untouched', () => {
    const [t] = parse(CARD).transactions;
    expect(t?.investment).toBeNull();
    expect(t?.suggestedCategoryId).toBeNull();
    expect(t?.description).toBe('REWE SAGT DANKE');
    expect(t?.counterparty).toBe('REWE');
  });

  it('reads a whole mixed file without losing a row', () => {
    const result = parse(BUY, SELL, DIVIDEND, SAVEBACK, CARD);
    expect(result.transactions).toHaveLength(5);
    expect(result.issues).toHaveLength(0);
  });

  it('keeps the cash movement and reports an issue when the share count is unreadable', () => {
    const broken = row({
      date: '2024-04-12', category: 'TRADING', type: 'BUY', asset_class: 'FUND',
      name: 'Core MSCI World USD (Acc)', symbol: 'IE00B4L5Y983', shares: 'n/a',
      amount: '-35.48', currency: 'EUR', transaction_id: 'tr-bad-1',
    });
    const result = parse(broken);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.amount.minor).toBe(-3548);
    expect(result.transactions[0]?.investment).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toMatch(/share count/i);
  });

  it('refuses a share count past the exact-integer ceiling instead of wrapping', () => {
    const huge = row({
      date: '2024-04-12', category: 'TRADING', type: 'BUY', asset_class: 'CRYPTO',
      name: 'Bitcoin', symbol: 'BTC', shares: '99000000', amount: '-35.48',
      currency: 'EUR', transaction_id: 'tr-huge-1',
    });
    expect(parse(huge).issues).toHaveLength(1);
  });

  it('maps the asset classes the export uses', () => {
    const crypto = row({
      date: '2024-07-12', category: 'TRADING', type: 'BUY', asset_class: 'CRYPTO',
      name: 'Bitcoin', symbol: 'BTC', shares: '0.0008240000', price: '60633.910000',
      amount: '-49.96', currency: 'EUR', transaction_id: 'tr-btc-1',
    });
    expect(parse(crypto).transactions[0]?.investment?.assetClass).toBe('crypto');
    expect(parse(DIVIDEND).transactions[0]?.investment?.assetClass).toBe('stock');
  });
});
