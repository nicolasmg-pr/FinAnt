import {
  PRICE_SCALE,
  parseDecimalAt,
  type Asset,
  type Listing,
  type PriceProvider,
} from '@finant/core';
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
