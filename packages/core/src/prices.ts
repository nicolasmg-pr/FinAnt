import { PRICE_SCALE, multiplyDecimal, type Decimal } from './decimal';
import type { Asset, Quote } from './investments';
import type { CurrencyCode } from './money';

/**
 * What a price source has to offer, and when it is worth asking.
 *
 * The interface lives here and performs no I/O, so the rules about staleness
 * and what may be sent are testable in plain node. The adapters that actually
 * reach the network live in the app, beside the other platform code.
 *
 * FinAnt sends a provider one thing: the symbols in the portfolio. Never an
 * amount, a share count, a balance, an account, or a narrative. The privacy
 * cost is real and worth naming — the provider learns which securities the
 * owner holds — and it is the whole reason the surface is this narrow.
 */

/** How long a cached price is treated as current. */
export const QUOTE_MAX_AGE_MS = 15 * 60 * 1000;

/** A provider's own identifier for a security, once resolved. */
export interface Listing {
  readonly symbol: string;
  readonly currency: CurrencyCode;
}

export interface PriceProvider {
  readonly id: string;
  /** Whether this provider handles the asset at all. */
  supports(asset: Asset): boolean;
  /** ISIN to the provider's ticker. Null when it does not recognise it. */
  resolve(asset: Asset): Promise<Listing | null>;
  /** A price for an already-resolved listing. Null when the lookup fails. */
  quote(asset: Asset, listing: Listing): Promise<{ price: Decimal; currency: CurrencyCode } | null>;
}

/**
 * A price exactly as a provider stated it, before anything is done to it.
 *
 * Kept separate from `Quote` because the two corrections below have to happen
 * somewhere testable, and a provider adapter is the wrong place: it would be
 * repeated per provider and silently wrong in whichever one forgot.
 */
export interface RawQuote {
  readonly price: Decimal;
  readonly currency: CurrencyCode;
}

/**
 * Currencies some venues quote in a minor unit, and the factor to major units.
 *
 * The London Stock Exchange prices many ETFs in pence and labels the result
 * `GBp`, lower-case p — one character away from `GBP`, and a hundred times the
 * value. Reading 2938 GBp as 2938 pounds overstates a holding by 100x, and
 * nothing downstream would look wrong.
 */
const MINOR_UNIT_CURRENCIES: Readonly<Record<string, { major: string; per: number }>> = {
  GBp: { major: 'GBP', per: 100 },
  ZAc: { major: 'ZAR', per: 100 },
  ILA: { major: 'ILS', per: 100 },
};

/** Turns a pence-style quote into its major unit. Anything else passes through. */
export function normaliseQuoteCurrency(raw: RawQuote): RawQuote {
  const minor = MINOR_UNIT_CURRENCIES[raw.currency];
  if (!minor) return raw;
  const factor = multiplyDecimal(
    { scaled: 10 ** PRICE_SCALE / minor.per, scale: PRICE_SCALE },
    { scaled: 10 ** PRICE_SCALE, scale: PRICE_SCALE },
    PRICE_SCALE,
  );
  const converted = factor ? multiplyDecimal(raw.price, factor, PRICE_SCALE) : null;
  return converted ? { price: converted, currency: minor.major } : raw;
}

/**
 * Applies an exchange rate to a price.
 *
 * The rate is `1 unit of from` expressed in `to`, which is the direction the
 * pair `FROMTO=X` quotes. Null when the result would not be exact.
 */
export function convertPrice(price: Decimal, rate: Decimal): Decimal | null {
  return multiplyDecimal(price, rate, PRICE_SCALE);
}

/** The pair symbol a rate is fetched under, e.g. `USDEUR=X`. */
export function fxPairSymbol(from: CurrencyCode, to: CurrencyCode): string {
  return `${from.toUpperCase()}${to.toUpperCase()}=X`;
}

export function quoteAgeMs(quote: Quote, nowIso: string): number {
  const asOf = Date.parse(quote.asOf);
  const now = Date.parse(nowIso);
  if (Number.isNaN(asOf) || Number.isNaN(now)) return Number.POSITIVE_INFINITY;
  return now - asOf;
}

export function isQuoteStale(
  quote: Quote,
  nowIso: string,
  maxAgeMs: number = QUOTE_MAX_AGE_MS,
): boolean {
  return quoteAgeMs(quote, nowIso) >= maxAgeMs;
}

/**
 * Which assets are worth asking about right now.
 *
 * An asset the owner priced by hand is never asked about: their figure wins, so
 * a lookup would send a symbol to a provider and change nothing. Neither is an
 * archived one, or one with a fresh enough price already.
 */
export function assetsNeedingQuote(
  assets: readonly Asset[],
  quotes: readonly Quote[],
  nowIso: string,
  maxAgeMs: number = QUOTE_MAX_AGE_MS,
): readonly Asset[] {
  const byId = new Map(quotes.map((q) => [q.assetId, q]));
  return assets.filter((asset) => {
    if (asset.archived || asset.manualPrice) return false;
    const quote = byId.get(asset.id);
    return !quote || isQuoteStale(quote, nowIso, maxAgeMs);
  });
}

/** The oldest price behind a set of quotes — what the screen dates itself by. */
export function oldestQuoteAsOf(quotes: readonly Quote[]): string | null {
  const stamps = quotes.map((q) => q.asOf).filter((s) => s !== '');
  return stamps.length === 0 ? null : stamps.sort()[0]!;
}
