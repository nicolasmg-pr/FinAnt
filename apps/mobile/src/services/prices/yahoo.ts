import {
  PRICE_SCALE,
  fxPairSymbol,
  parseDecimalAt,
  type Asset,
  type CurrencyCode,
  type Decimal,
  type Listing,
  type PriceProvider,
} from '@finant/core';
import { fetchJson } from './http';

/**
 * Quotes for funds, ETFs and shares.
 *
 * Yahoo retired its public finance API in 2017; these are the endpoints its own
 * web client uses. They work, they are free, they need no account, and they can
 * break without notice — which is why every failure here returns null and the
 * portfolio falls back to its cached price or to one the owner typed, rather
 * than showing an error where a figure belongs.
 *
 * Two calls, and the first is cached forever: an ISIN's ticker does not change,
 * so `listing_symbol` is written once and the search is skipped from then on.
 *
 * What leaves the device: an ISIN, then a ticker, and — when the venue prices
 * in another currency — a currency pair such as `USDEUR=X`. A pair names no
 * holding and identifies nobody.
 */
const SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';
const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

interface SearchResponse {
  quotes?: { symbol?: string; currency?: string; quoteType?: string; exchange?: string }[];
}

interface ChartResponse {
  chart?: {
    result?: { meta?: { regularMarketPrice?: number; currency?: string } }[];
  };
}

/**
 * Turns a price that arrives as a JSON number into an exact decimal.
 *
 * Through the string form rather than by multiplying: `17.742 * 1e10` is not
 * 177420000000 in binary floating point, and this is the one boundary where a
 * float is unavoidable because that is what JSON gives us.
 */
function exactFrom(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return parseDecimalAt(value.toFixed(PRICE_SCALE), PRICE_SCALE);
}

/**
 * One unit of `from`, expressed in `to`.
 *
 * Needed far more often than it looks: Yahoo's ISIN search returns whichever
 * venue it has, and for European UCITS ETFs that is usually London or Amsterdam
 * quoting in USD even when the owner bought in euro. Without this, three of a
 * typical six-holding portfolio simply cannot be valued.
 */
export async function fxRate(from: CurrencyCode, to: CurrencyCode): Promise<Decimal | null> {
  if (from.toUpperCase() === to.toUpperCase()) return parseDecimalAt('1', PRICE_SCALE);
  const body = await fetchJson<ChartResponse>(
    `${CHART}/${fxPairSymbol(from, to)}?range=1d&interval=1d`,
  );
  const rate = body?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof rate === 'number' ? exactFrom(rate) : null;
}

export const yahooProvider: PriceProvider = {
  id: 'yahoo',

  supports(asset: Asset) {
    return asset.assetClass === 'fund' || asset.assetClass === 'stock';
  },

  async resolve(asset: Asset): Promise<Listing | null> {
    if (asset.listingSymbol) {
      return { symbol: asset.listingSymbol, currency: asset.currency };
    }
    const body = await fetchJson<SearchResponse>(
      `${SEARCH}?q=${encodeURIComponent(asset.symbol)}&quotesCount=6&newsCount=0`,
    );
    const found = (body?.quotes ?? [])
      .map((q) => q.symbol)
      .filter((symbol): symbol is string => typeof symbol === 'string');
    // The search endpoint states no currency, so a listing cannot be chosen by
    // one here; the quote call reports the real currency and the caller
    // converts. Stuttgart lists many UCITS funds under the bare ISIN and prices
    // them in euro, so it is worth trying when the search finds nothing.
    const candidates = [...found, `${asset.symbol}.SG`];
    const chosen = candidates[0];
    return chosen ? { symbol: chosen, currency: asset.currency } : null;
  },

  async quote(_asset: Asset, listing: Listing) {
    const body = await fetchJson<ChartResponse>(
      `${CHART}/${encodeURIComponent(listing.symbol)}?range=1d&interval=1d`,
    );
    const meta = body?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
    const price = exactFrom(meta.regularMarketPrice);
    if (!price) return null;
    return { price, currency: meta.currency ?? listing.currency };
  },
};
