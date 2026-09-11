import {
  PRICE_SCALE,
  parseDecimalAt,
  type Asset,
  type CurrencyCode,
  type Decimal,
  type Listing,
  type PriceProvider,
} from '@finant/core';
import type { MonthlyCloses } from './yahoo';
import { fetchJson } from './http';

/**
 * Quotes for crypto, which Yahoo's equity endpoints do not cover cleanly.
 *
 * CoinGecko's public endpoint needs no key and prices directly in the currency
 * asked for, so no conversion is involved. The ticker-to-id map is deliberately
 * short: it holds what a broker export has actually been seen to contain, and
 * an unknown ticker returns null rather than guessing an id that might price a
 * different coin entirely.
 */
const SIMPLE_PRICE = 'https://api.coingecko.com/api/v3/simple/price';
const MARKET_CHART = 'https://api.coingecko.com/api/v3/coins';

const COIN_IDS: Readonly<Record<string, string>> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  XRP: 'ripple',
  DOT: 'polkadot',
  LTC: 'litecoin',
  DOGE: 'dogecoin',
};

export const coingeckoProvider: PriceProvider = {
  id: 'coingecko',

  supports(asset: Asset) {
    return asset.assetClass === 'crypto';
  },

  async resolve(asset: Asset): Promise<Listing | null> {
    const id = COIN_IDS[asset.symbol.toUpperCase()];
    return id ? { symbol: id, currency: asset.currency } : null;
  },

  async quote(asset: Asset, listing: Listing) {
    const vs = asset.currency.toLowerCase();
    const body = await fetchJson<Record<string, Record<string, number>>>(
      `${SIMPLE_PRICE}?ids=${encodeURIComponent(listing.symbol)}&vs_currencies=${encodeURIComponent(vs)}`,
    );
    const value = body?.[listing.symbol]?.[vs];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    const price = parseDecimalAt(value.toFixed(PRICE_SCALE), PRICE_SCALE);
    return price ? { price, currency: asset.currency } : null;
  },
};

/**
 * Monthly closes for a coin, taken from the daily series.
 *
 * CoinGecko's free tier serves at most a year of history, so a position older
 * than that has no line before it starts. That is left as a gap rather than
 * filled: `portfolioValueSeries` marks a month it cannot fully price as
 * `partial`, which is the truthful answer, and the headline figure comes from
 * today's live quote either way.
 */
export async function coinMonthlyCloses(
  coinId: string,
  currency: CurrencyCode,
): Promise<MonthlyCloses | null> {
  const vs = currency.toLowerCase();
  const body = await fetchJson<{ prices?: [number, number][] }>(
    `${MARKET_CHART}/${encodeURIComponent(coinId)}/market_chart?vs_currency=${encodeURIComponent(vs)}&days=365&interval=daily`,
  );
  const prices = body?.prices;
  if (!prices || prices.length === 0) return null;

  // Last reading of each month wins, which is the month's close.
  const byMonth = new Map<string, Decimal>();
  for (const [stamp, value] of prices) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const exact = parseDecimalAt(value.toFixed(PRICE_SCALE), PRICE_SCALE);
    if (exact) byMonth.set(new Date(stamp).toISOString().slice(0, 7), exact);
  }
  const closes = [...byMonth.entries()]
    .map(([month, close]) => ({ month, close }))
    .sort((a, b) => a.month.localeCompare(b.month));
  return closes.length === 0 ? null : { currency, closes };
}
