import { describe, expect, it } from 'vitest';
import { PRICE_SCALE, decimalToString, parseDecimalAt } from '../src/decimal';
import type { Asset, Quote } from '../src/investments';
import {
  QUOTE_MAX_AGE_MS,
  assetsNeedingQuote,
  convertPrice,
  fxPairSymbol,
  isQuoteStale,
  normaliseQuoteCurrency,
  oldestQuoteAsOf,
} from '../src/prices';

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  symbol: 'IE00B4L5Y983',
  name: 'Core MSCI World',
  assetClass: 'fund',
  currency: 'EUR',
  listingSymbol: null,
  manualPrice: null,
  archived: false,
  ...over,
});

const quote = (asOf: string, over: Partial<Quote> = {}): Quote => ({
  assetId: 'a1',
  price: parseDecimalAt('90.00', PRICE_SCALE)!,
  currency: 'EUR',
  asOf,
  source: 'yahoo',
  ...over,
});

const NOW = '2026-09-11T12:00:00.000Z';

describe('quote freshness', () => {
  it('treats a price from a minute ago as current', () => {
    expect(isQuoteStale(quote('2026-09-11T11:59:00.000Z'), NOW)).toBe(false);
  });

  it('treats a price older than the window as stale', () => {
    expect(isQuoteStale(quote('2026-09-11T11:40:00.000Z'), NOW)).toBe(true);
  });

  it('treats an unparseable timestamp as stale rather than current', () => {
    expect(isQuoteStale(quote('not a date'), NOW)).toBe(true);
  });

  it('reports the oldest stamp behind a screen', () => {
    expect(
      oldestQuoteAsOf([quote('2026-09-11T11:59:00.000Z'), quote('2026-09-11T11:30:00.000Z')]),
    ).toBe('2026-09-11T11:30:00.000Z');
  });
});

describe('assetsNeedingQuote', () => {
  it('asks about an asset with no price at all', () => {
    expect(assetsNeedingQuote([asset()], [], NOW)).toHaveLength(1);
  });

  it('does not ask again while the price is fresh', () => {
    expect(assetsNeedingQuote([asset()], [quote('2026-09-11T11:59:00.000Z')], NOW)).toHaveLength(0);
  });

  it('never sends a symbol for an asset the owner priced by hand', () => {
    const manual = asset({ manualPrice: parseDecimalAt('30.00', PRICE_SCALE)! });
    expect(assetsNeedingQuote([manual], [], NOW)).toHaveLength(0);
  });

  it('leaves an archived asset alone', () => {
    expect(assetsNeedingQuote([asset({ archived: true })], [], NOW)).toHaveLength(0);
  });

  it('asks again once the window has passed', () => {
    const old = new Date(Date.parse(NOW) - QUOTE_MAX_AGE_MS - 1000).toISOString();
    expect(assetsNeedingQuote([asset()], [quote(old)], NOW)).toHaveLength(1);
  });
});

describe('quote currency corrections', () => {
  const price = (s: string) => parseDecimalAt(s, PRICE_SCALE)!;

  it('reads a London pence quote as pounds, not as a hundredfold holding', () => {
    const raw = normaliseQuoteCurrency({ price: price('2938.00'), currency: 'GBp' });
    expect(raw.currency).toBe('GBP');
    expect(decimalToString(raw.price)).toBe('29.3800000000');
  });

  it('leaves an ordinary currency alone', () => {
    const raw = normaliseQuoteCurrency({ price: price('103.40'), currency: 'EUR' });
    expect(raw.currency).toBe('EUR');
    expect(decimalToString(raw.price)).toBe('103.4000000000');
  });

  it('applies an exchange rate exactly', () => {
    // 146.96 USD at 0.8621 EUR per USD.
    expect(decimalToString(convertPrice(price('146.96'), price('0.8621'))!)).toBe('126.6942160000');
  });

  it('names the pair the way the rate is quoted', () => {
    expect(fxPairSymbol('usd', 'EUR')).toBe('USDEUR=X');
  });
});
