import { describe, expect, it } from 'vitest';
import { parseDecimalAt, decimalToString, SHARE_SCALE, PRICE_SCALE } from '../src/decimal';
import { money } from '../src/money';
import {
  buildPortfolio,
  type Asset,
  type InvestmentLeg,
  type Quote,
} from '../src/investments';

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a-world',
  symbol: 'IE00B4L5Y983',
  name: 'Core MSCI World USD (Acc)',
  assetClass: 'fund',
  currency: 'EUR',
  listingSymbol: null,
  manualPrice: null,
  archived: false,
  ...over,
});

let seq = 0;
const leg = (
  kind: InvestmentLeg['kind'],
  bookingDate: string,
  shares: string,
  cashMinor: number,
  over: Partial<InvestmentLeg> = {},
): InvestmentLeg => ({
  id: `l-${(seq += 1)}`,
  transactionId: `t-${seq}`,
  assetId: 'a-world',
  kind,
  bookingDate,
  shares: parseDecimalAt(shares, SHARE_SCALE)!,
  unitPrice: parseDecimalAt('0', PRICE_SCALE)!,
  cashAmount: money(cashMinor, 'EUR'),
  fee: money(0, 'EUR'),
  ...over,
});

const quote = (price: string, over: Partial<Quote> = {}): Quote => ({
  assetId: 'a-world',
  price: parseDecimalAt(price, PRICE_SCALE)!,
  currency: 'EUR',
  asOf: '2026-09-11T10:00:00.000Z',
  source: 'yahoo',
  ...over,
});

const opts = { currency: 'EUR' as const, today: '2026-09-11' };

describe('buildPortfolio', () => {
  it('sums shares across buys', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('buy', '2024-04-12', '2.0000000000', -3548),
        leg('buy', '2024-04-12', '0.7618080000', -1352),
      ],
      quotes: [],
      ...opts,
    });
    expect(decimalToString(p.holdings[0]!.shares)).toBe('2.7618080000');
  });

  it('takes cost basis from the cash amount, never price times shares', () => {
    // 2 shares at a 17.742 unit price is 35.484; the broker charged 35.48.
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('buy', '2024-04-12', '2.0000000000', -3548, {
          unitPrice: parseDecimalAt('17.742', PRICE_SCALE)!,
        }),
      ],
      quotes: [],
      ...opts,
    });
    expect(p.holdings[0]!.costBasis).toEqual(money(3548, 'EUR'));
  });

  it('counts a fee into the cost of the position', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [leg('buy', '2024-04-12', '1.0000000000', -5000, { fee: money(-100, 'EUR') })],
      quotes: [],
      ...opts,
    });
    expect(p.holdings[0]!.costBasis).toEqual(money(5100, 'EUR'));
    expect(p.holdings[0]!.fees).toEqual(money(100, 'EUR'));
  });

  it('adds no shares for a dividend, whose share column is the holding at the time', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('buy', '2024-04-15', '0.0810000000', -1010),
        leg('dividend', '2024-06-04', '0.0810000000', 73),
      ],
      quotes: [],
      ...opts,
    });
    expect(decimalToString(p.holdings[0]!.shares)).toBe('0.0810000000');
    expect(p.holdings[0]!.dividends).toEqual(money(73, 'EUR'));
    expect(p.totalDividends).toEqual(money(73, 'EUR'));
  });

  it('adds no shares for a saveback or stockperk benefit', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('benefit', '2024-06-03', '0', 797),
        leg('buy', '2024-06-03', '0.1050750000', -797),
      ],
      quotes: [],
      ...opts,
    });
    expect(decimalToString(p.holdings[0]!.shares)).toBe('0.1050750000');
    expect(p.holdings[0]!.benefits).toEqual(money(797, 'EUR'));
  });

  it('realises a gain FIFO against the oldest lot first', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('buy', '2024-04-12', '1.0000000000', -1000), // lot 1 @ 10.00
        leg('buy', '2024-05-12', '1.0000000000', -2000), // lot 2 @ 20.00
        leg('sell', '2024-06-20', '-1.0000000000', 1500), // sells lot 1
      ],
      quotes: [],
      ...opts,
    });
    const h = p.holdings[0]!;
    // FIFO takes the 10.00 lot: 15.00 proceeds - 10.00 cost = +5.00
    expect(h.realised).toEqual(money(500, 'EUR'));
    // The 20.00 lot remains open.
    expect(h.costBasis).toEqual(money(2000, 'EUR'));
    expect(decimalToString(h.shares)).toBe('1.0000000000');
  });

  it('splits a lot proportionally on a partial disposal', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('buy', '2024-04-12', '4.0000000000', -10000), // 25.00 each
        leg('sell', '2024-06-20', '-1.0000000000', 3000),
      ],
      quotes: [],
      ...opts,
    });
    const h = p.holdings[0]!;
    expect(h.realised).toEqual(money(500, 'EUR')); // 30.00 - 25.00
    expect(h.costBasis).toEqual(money(7500, 'EUR'));
  });

  it('values an open position against its quote', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [leg('buy', '2024-04-12', '2.0000000000', -3548)],
      quotes: [quote('20.00')],
      ...opts,
    });
    const h = p.holdings[0]!;
    expect(h.marketValue).toEqual(money(4000, 'EUR'));
    expect(h.unrealised).toEqual(money(452, 'EUR'));
    expect(h.returnPct).toBeCloseTo(12.74, 2);
    expect(p.totalValue).toEqual(money(4000, 'EUR'));
  });

  it('prefers a manual price over a fetched quote', () => {
    const p = buildPortfolio({
      assets: [asset({ manualPrice: parseDecimalAt('30.00', PRICE_SCALE)! })],
      legs: [leg('buy', '2024-04-12', '2.0000000000', -3548)],
      quotes: [quote('20.00')],
      ...opts,
    });
    expect(p.holdings[0]!.marketValue).toEqual(money(6000, 'EUR'));
    expect(p.holdings[0]!.quote?.source).toBe('manual');
  });

  it('renders an unquoted holding without inventing a value', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [leg('buy', '2024-04-12', '2.0000000000', -3548)],
      quotes: [],
      ...opts,
    });
    const h = p.holdings[0]!;
    expect(h.marketValue).toBeNull();
    expect(h.unrealised).toBeNull();
    expect(p.assetsUnquoted).toBe(1);
    // The total states only what it could value.
    expect(p.totalValue).toEqual(money(0, 'EUR'));
  });

  it('leaves a closed position out of the holdings but keeps its realised gain', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('buy', '2024-04-12', '1.0000000000', -1000),
        leg('sell', '2024-06-20', '-1.0000000000', 1500),
      ],
      quotes: [],
      ...opts,
    });
    expect(p.holdings).toHaveLength(0);
    expect(p.closed).toHaveLength(1);
    expect(p.totalRealised).toEqual(money(500, 'EUR'));
  });

  it('flags a disposal larger than the position rather than inventing a lot', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('buy', '2024-04-12', '1.0000000000', -1000),
        leg('sell', '2024-06-20', '-2.0000000000', 3000),
      ],
      quotes: [],
      ...opts,
    });
    expect(p.closed[0]!.oversold).toBe(true);
  });

  it('orders legs by date, not by the order they were read', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('sell', '2024-06-20', '-1.0000000000', 1500),
        leg('buy', '2024-05-12', '1.0000000000', -2000),
        leg('buy', '2024-04-12', '1.0000000000', -1000),
      ],
      quotes: [],
      ...opts,
    });
    expect(p.closed[0]?.oversold ?? p.holdings[0]!.realised).toEqual(money(500, 'EUR'));
  });

  it('reports average cost per share', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [
        leg('buy', '2024-04-12', '1.0000000000', -1000),
        leg('buy', '2024-05-12', '1.0000000000', -2000),
      ],
      quotes: [],
      ...opts,
    });
    expect(decimalToString(p.holdings[0]!.averageCost!)).toBe('15.0000000000');
  });

  it('allocates by asset class', () => {
    const p = buildPortfolio({
      assets: [
        asset(),
        asset({ id: 'a-btc', symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto' }),
      ],
      legs: [
        leg('buy', '2024-04-12', '1.0000000000', -7500),
        leg('buy', '2024-07-12', '1.0000000000', -2500, { assetId: 'a-btc' }),
      ],
      quotes: [quote('75.00'), quote('25.00', { assetId: 'a-btc' })],
      ...opts,
    });
    const byClass = Object.fromEntries(p.byAssetClass.map((a) => [a.assetClass, a.share]));
    expect(byClass.fund).toBeCloseTo(0.75, 6);
    expect(byClass.crypto).toBeCloseTo(0.25, 6);
  });

  it('skips a quote in a currency it cannot convert rather than mixing them', () => {
    const p = buildPortfolio({
      assets: [asset()],
      legs: [leg('buy', '2024-04-12', '2.0000000000', -3548)],
      quotes: [quote('20.00', { currency: 'USD' })],
      ...opts,
    });
    expect(p.holdings[0]!.marketValue).toBeNull();
    expect(p.assetsUnquoted).toBe(1);
  });
});
