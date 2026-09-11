import {
  QUOTE_MAX_AGE_MS,
  assetsNeedingQuote,
  convertPrice,
  normaliseQuoteCurrency,
  type Asset,
  type PriceProvider,
  type Quote,
} from '@finant/core';
import { listAssets, listQuotes, saveQuotes, setListingSymbol } from '../../db/investments-repo';
import { coingeckoProvider } from './coingecko';
import { fxRate, yahooProvider } from './yahoo';

export { QUOTE_MAX_AGE_MS };

const PROVIDERS: readonly PriceProvider[] = [yahooProvider, coingeckoProvider];

export interface RefreshResult {
  readonly requested: number;
  readonly updated: number;
  /** Held, asked about, and still unpriced — shown so the gap is never silent. */
  readonly failed: readonly string[];
}

/**
 * Brings the cached prices up to date, and writes nothing else.
 *
 * Assets the owner priced by hand are never asked about, so their symbols do
 * not leave the device at all. An asset nothing can price keeps whatever it
 * had: a stale figure with its age on screen beats a blank, and a blank beats
 * a guess.
 */
export async function refreshQuotes(
  options: { force?: boolean; now?: Date } = {},
): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const [assets, quotes] = await Promise.all([listAssets(), listQuotes()]);

  const wanted = options.force
    ? assets.filter((a) => !a.archived && !a.manualPrice)
    : assetsNeedingQuote(assets, quotes, nowIso, QUOTE_MAX_AGE_MS);
  if (wanted.length === 0) return { requested: 0, updated: 0, failed: [] };

  const fresh: Quote[] = [];
  const failed: string[] = [];

  // Sequential on purpose. A portfolio is a handful of assets, and a burst of
  // parallel requests to a free public endpoint is the fastest way to get rate
  // limited out of the only price source the app has.
  for (const asset of wanted) {
    const quote = await quoteFor(asset);
    if (quote) fresh.push(quote);
    else failed.push(asset.id);
  }

  await saveQuotes(fresh);
  return { requested: wanted.length, updated: fresh.length, failed };
}

async function quoteFor(asset: Asset): Promise<Quote | null> {
  const provider = PROVIDERS.find((p) => p.supports(asset));
  if (!provider) return null;

  const listing = await provider.resolve(asset);
  if (!listing) return null;
  // An ISIN's ticker does not change, so the lookup is paid for once.
  if (listing.symbol !== asset.listingSymbol && provider.id === 'yahoo') {
    await setListingSymbol(asset.id, listing.symbol);
  }

  const result = await provider.quote(asset, listing);
  if (!result) return null;

  // Two corrections before a price is worth storing. London prices many UCITS
  // ETFs in pence under the label `GBp`, which is a hundredfold error if taken
  // at face value; and Yahoo's ISIN search returns whichever venue it has, so a
  // fund bought in euro is routinely quoted in dollars.
  const raw = normaliseQuoteCurrency(result);
  const priced = await inPortfolioCurrency(raw, asset.currency);
  if (!priced) return null;

  return {
    assetId: asset.id,
    price: priced,
    currency: asset.currency,
    asOf: new Date().toISOString(),
    source: provider.id,
  };
}

async function inPortfolioCurrency(
  raw: { price: Quote['price']; currency: string },
  target: string,
): Promise<Quote['price'] | null> {
  if (raw.currency.toUpperCase() === target.toUpperCase()) return raw.price;
  const rate = await fxRate(raw.currency, target);
  // No rate means no price. A figure in the wrong currency is not a smaller
  // problem than a missing one — it is a wrong total that looks right.
  return rate ? convertPrice(raw.price, rate) : null;
}
