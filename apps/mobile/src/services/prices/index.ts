import {
  QUOTE_MAX_AGE_MS,
  assetsNeedingQuote,
  convertPrice,
  fxPairSymbol,
  normaliseQuoteCurrency,
  type Asset,
  type PriceHistoryPoint,
  type PriceProvider,
  type Quote,
} from '@finant/core';
import {
  latestHistoryMonths,
  listAssets,
  listQuotes,
  savePriceHistory,
  saveQuotes,
  setListingSymbol,
} from '../../db/investments-repo';
import { coinMonthlyCloses, coingeckoProvider } from './coingecko';
import { fxRate, monthlyCloses, yahooProvider } from './yahoo';

export { QUOTE_MAX_AGE_MS };

const PROVIDERS: readonly PriceProvider[] = [yahooProvider, coingeckoProvider];

/** Further back than any personal portfolio this app will meet. */
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

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

/**
 * Fills in the monthly closes behind the portfolio's value line.
 *
 * Runs after a quote refresh and only for what is missing: an asset whose
 * history already reaches the current month is skipped entirely, so this costs
 * one request per asset on the first run and nothing on most later ones.
 *
 * Each month's close is converted with *that month's* rate rather than today's.
 * Charting a 2024 holding of a dollar-quoted fund at today's dollar would draw
 * an exchange-rate move as if it were a market move, which is exactly the kind
 * of wrong figure that looks right.
 */
export async function backfillHistory(options: { since?: Date } = {}): Promise<{
  assetsFilled: number;
}> {
  const [assets, latest] = await Promise.all([listAssets(), latestHistoryMonths()]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const since = options.since ?? new Date(Date.now() - TEN_YEARS_MS);
  let assetsFilled = 0;

  for (const asset of assets) {
    if (asset.archived) continue;
    if (latest.get(asset.id) === thisMonth) continue;

    const provider = PROVIDERS.find((p) => p.supports(asset));
    if (!provider) continue;

    const listing = await provider.resolve(asset);
    if (!listing) continue;

    const series =
      provider.id === 'coingecko'
        ? await coinMonthlyCloses(listing.symbol, asset.currency)
        : await monthlyCloses(listing.symbol, since);
    if (!series) continue;

    const normalised = series.closes.map((point) =>
      normaliseQuoteCurrency({ price: point.close, currency: series.currency }),
    );
    const quoteCurrency = normalised[0]?.currency ?? series.currency;

    let rates: Map<string, ReturnType<typeof convertPrice>> | null = null;
    if (quoteCurrency.toUpperCase() !== asset.currency.toUpperCase()) {
      const fx = await monthlyCloses(fxPairSymbol(quoteCurrency, asset.currency), since);
      if (!fx) continue;
      rates = new Map(fx.closes.map((point) => [point.month, point.close]));
    }

    const points: (PriceHistoryPoint & { currency: string })[] = [];
    series.closes.forEach((point, i) => {
      const price = normalised[i]?.price ?? point.close;
      if (!rates) {
        points.push({
          assetId: asset.id,
          month: point.month,
          close: price,
          currency: asset.currency,
        });
        return;
      }
      const rate = rates.get(point.month);
      // A month with no rate is left out rather than converted at a neighbour's:
      // the series carries the last close forward, which is the honest gap.
      if (!rate) return;
      const converted = convertPrice(price, rate);
      if (converted) {
        points.push({
          assetId: asset.id,
          month: point.month,
          close: converted,
          currency: asset.currency,
        });
      }
    });

    if (points.length > 0) {
      await savePriceHistory(points);
      assetsFilled += 1;
    }
  }

  return { assetsFilled };
}
