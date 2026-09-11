import { PRICE_SCALE, SHARE_SCALE, decimal, zeroDecimal, type Decimal } from './decimal';
import { lastOfMonth, monthRange, yearMonthOf } from './dates';
import { money, zero, type CurrencyCode, type Money } from './money';
import type { ISODate, YearMonth } from './types';

/**
 * What the owner holds, rebuilt from the trade rows their broker exported.
 *
 * Pure, like the rest of core: legs, assets and quotes go in, a portfolio comes
 * out. Nothing here reads a database or a network — the caller has already done
 * both by the time it calls in.
 *
 * Holdings are derived on every read rather than stored. A materialised
 * holdings table is a second source of truth that drifts the first time a
 * movement is edited, deleted or re-imported, and a portfolio of a few hundred
 * legs costs nothing to sum.
 */

export type AssetClass = 'fund' | 'stock' | 'crypto';

export interface Asset {
  readonly id: string;
  /** ISIN for a security, ticker for a crypto pair. Stable, from the export. */
  readonly symbol: string;
  /** The owner names it. Never renamed from a quote payload behind their back. */
  readonly name: string;
  readonly assetClass: AssetClass;
  /** The currency its cost is booked in, which is what a valuation must match. */
  readonly currency: CurrencyCode;
  /** The provider's ticker once resolved, e.g. `EUNL.DE`. Null until looked up. */
  readonly listingSymbol: string | null;
  /** Typed by the owner. Always wins over a fetched quote. */
  readonly manualPrice: Decimal | null;
  readonly archived: boolean;
}

/**
 * One acquisition, disposal, or asset-tagged credit.
 *
 * `dividend` and `benefit` carry cash but no shares: on a dividend row the
 * broker writes the holding *at the time of payment* into the share column, and
 * a saveback or stockperk credits cash that a separate `buy` row then spends.
 * Treating either as an acquisition inflates the position, so only `buy` and
 * `sell` move it.
 */
export type LegKind = 'buy' | 'sell' | 'dividend' | 'benefit';

export interface InvestmentLeg {
  readonly id: string;
  /** The cash movement that paid for it, or that it paid out. */
  readonly transactionId: string;
  readonly assetId: string;
  readonly kind: LegKind;
  readonly bookingDate: ISODate;
  /** Signed: negative on a disposal. Zero on a dividend or benefit. */
  readonly shares: Decimal;
  /** Reference only. The basis comes from `cashAmount`. */
  readonly unitPrice: Decimal;
  /** Signed, exactly as the export booked it: negative on a purchase. */
  readonly cashAmount: Money;
  readonly fee: Money;
}

export interface Quote {
  readonly assetId: string;
  readonly price: Decimal;
  readonly currency: CurrencyCode;
  /** When the price was read. Shown on screen; a portfolio is never "live". */
  readonly asOf: string;
  /** Provider id, or `manual` when the owner typed it. */
  readonly source: string;
}

export interface Position {
  readonly asset: Asset;
  /** Net shares held. Zero or less means the position is closed. */
  readonly shares: Decimal;
  /** What the open shares cost, fees included. Zero on a closed position. */
  readonly costBasis: Money;
  /** Per share, at price scale. Null when nothing is held. */
  readonly averageCost: Decimal | null;
  /** Gain or loss booked by disposals, FIFO. */
  readonly realised: Money;
  readonly dividends: Money;
  readonly benefits: Money;
  readonly fees: Money;
  readonly quote: Quote | null;
  /** Null when no usable quote exists — never a guess, never a stale zero. */
  readonly marketValue: Money | null;
  readonly unrealised: Money | null;
  /** Percent, for display only. Nothing decides a figure from this. */
  readonly returnPct: number | null;
  /**
   * True when disposals exceeded everything the imports account for. It means
   * a buy is missing from the history, not that the owner sold short.
   */
  readonly oversold: boolean;
}

export interface ClassAllocation {
  readonly assetClass: AssetClass;
  readonly value: Money;
  /** Fraction of the valued portfolio, 0..1. */
  readonly share: number;
}

export interface AssetAllocation {
  readonly assetId: string;
  readonly value: Money;
  readonly share: number;
}

export interface Portfolio {
  readonly currency: CurrencyCode;
  /** Open positions, largest value first, then by name. */
  readonly holdings: readonly Position[];
  /** Positions fully disposed of. Kept for their realised gain. */
  readonly closed: readonly Position[];
  /** Market value of everything that could be valued. */
  readonly totalValue: Money;
  /** What the open positions cost. */
  readonly totalCost: Money;
  readonly totalUnrealised: Money;
  readonly totalRealised: Money;
  readonly totalDividends: Money;
  readonly totalBenefits: Money;
  readonly totalFees: Money;
  /** Return on the open positions, percent. Null when nothing is valued. */
  readonly returnPct: number | null;
  readonly byAssetClass: readonly ClassAllocation[];
  readonly byAsset: readonly AssetAllocation[];
  /** Held, but with no price we could use. Their value is in no total. */
  readonly assetsUnquoted: number;
  /** The oldest quote behind `totalValue`. Null when nothing is valued. */
  readonly quotedAsOf: string | null;
}

export interface PortfolioInput {
  readonly assets: readonly Asset[];
  readonly legs: readonly InvestmentLeg[];
  readonly quotes: readonly Quote[];
  readonly currency: CurrencyCode;
  readonly today: ISODate;
}

/** Exact half-up division. `denominator` must be positive. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (2n * magnitude + denominator) / (2n * denominator);
  return negative ? -quotient : quotient;
}

/**
 * Takes `part` of a lot's cost in proportion to the shares being removed.
 *
 * Through BigInt because the intermediate product overflows a double long
 * before either operand does: a lot of 900,000 shares at scale 10 against a
 * cost in cents is past `Number.MAX_SAFE_INTEGER` while both inputs are still
 * ordinary numbers.
 */
function allocateCost(costMinor: number, partScaled: number, wholeScaled: number): number {
  if (wholeScaled === 0) return 0;
  return Number(
    divideHalfUp(BigInt(costMinor) * BigInt(partScaled), BigInt(Math.abs(wholeScaled))),
  );
}

/** shares (scale 10) x price (scale 10) -> minor units of a 2-decimal currency. */
function valueOf(shares: Decimal, price: Decimal, currency: CurrencyCode): Money {
  const divisor = 10n ** BigInt(shares.scale + price.scale - 2);
  return money(
    Number(divideHalfUp(BigInt(shares.scaled) * BigInt(price.scaled), divisor)),
    currency,
  );
}

/** cost in minor units / shares (scale 10) -> a per-share price at price scale. */
function perShare(costMinor: number, shares: Decimal): Decimal | null {
  if (shares.scaled === 0) return null;
  const numerator = BigInt(costMinor) * 10n ** BigInt(PRICE_SCALE + shares.scale - 2);
  const scaled = Number(divideHalfUp(numerator, BigInt(Math.abs(shares.scaled))));
  if (!Number.isSafeInteger(scaled)) return null;
  return decimal(shares.scaled < 0 ? -scaled : scaled, PRICE_SCALE);
}

interface Lot {
  sharesScaled: number;
  costMinor: number;
}

/** One asset's legs, walked in date order. */
function walk(legs: readonly InvestmentLeg[]): {
  sharesScaled: number;
  costMinor: number;
  realisedMinor: number;
  dividendMinor: number;
  benefitMinor: number;
  feeMinor: number;
  oversold: boolean;
} {
  const lots: Lot[] = [];
  let realisedMinor = 0;
  let dividendMinor = 0;
  let benefitMinor = 0;
  let feeMinor = 0;
  let oversold = false;
  let netShares = 0;

  for (const leg of legs) {
    feeMinor += Math.abs(leg.fee.minor);
    if (leg.kind === 'dividend') {
      dividendMinor += Math.abs(leg.cashAmount.minor);
      continue;
    }
    if (leg.kind === 'benefit') {
      benefitMinor += Math.abs(leg.cashAmount.minor);
      continue;
    }

    if (leg.kind === 'buy') {
      netShares += leg.shares.scaled;
      lots.push({
        sharesScaled: leg.shares.scaled,
        // The fee is part of what the shares cost, not a separate expense.
        costMinor: Math.abs(leg.cashAmount.minor) + Math.abs(leg.fee.minor),
      });
      continue;
    }

    // A disposal. Proceeds are what the broker paid, less its fee.
    netShares += leg.shares.scaled;
    let remaining = Math.abs(leg.shares.scaled);
    const proceedsMinor = Math.abs(leg.cashAmount.minor) - Math.abs(leg.fee.minor);
    let consumedCost = 0;
    let consumedShares = 0;

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0]!;
      const take = Math.min(remaining, lot.sharesScaled);
      const cost =
        take === lot.sharesScaled
          ? lot.costMinor
          : allocateCost(lot.costMinor, take, lot.sharesScaled);
      consumedCost += cost;
      consumedShares += take;
      lot.sharesScaled -= take;
      lot.costMinor -= cost;
      remaining -= take;
      if (lot.sharesScaled <= 0) lots.shift();
    }
    // Selling more than every import accounts for means a buy is missing, not
    // that the owner went short. Book the whole proceeds and say so.
    if (remaining > 0) oversold = true;

    const proceedsForConsumed =
      consumedShares === Math.abs(leg.shares.scaled) || leg.shares.scaled === 0
        ? proceedsMinor
        : allocateCost(proceedsMinor, consumedShares, Math.abs(leg.shares.scaled));
    realisedMinor += proceedsForConsumed - consumedCost;
    if (remaining > 0) realisedMinor += proceedsMinor - proceedsForConsumed;
  }

  return {
    sharesScaled: netShares,
    costMinor: lots.reduce((acc, lot) => acc + lot.costMinor, 0),
    realisedMinor,
    dividendMinor,
    benefitMinor,
    feeMinor,
    oversold,
  };
}

function priceFor(asset: Asset, quotes: ReadonlyMap<string, Quote>): Quote | null {
  if (asset.manualPrice) {
    return {
      assetId: asset.id,
      price: asset.manualPrice,
      currency: asset.currency,
      asOf: '',
      source: 'manual',
    };
  }
  return quotes.get(asset.id) ?? null;
}

export function buildPortfolio(input: PortfolioInput): Portfolio {
  const { currency } = input;
  const quotes = new Map(input.quotes.map((q) => [q.assetId, q]));
  const byAssetId = new Map<string, InvestmentLeg[]>();
  for (const leg of input.legs) {
    const bucket = byAssetId.get(leg.assetId);
    if (bucket) bucket.push(leg);
    else byAssetId.set(leg.assetId, [leg]);
  }

  const open: Position[] = [];
  const closed: Position[] = [];

  for (const asset of input.assets) {
    const legs = (byAssetId.get(asset.id) ?? [])
      .slice()
      // A file is not guaranteed to arrive in date order, and FIFO is a
      // statement about time, not about read order.
      .sort((a, b) =>
        a.bookingDate === b.bookingDate
          ? a.id.localeCompare(b.id)
          : a.bookingDate.localeCompare(b.bookingDate),
      );
    if (legs.length === 0) continue;

    const walked = walk(legs);
    const shares = decimal(walked.sharesScaled, SHARE_SCALE);
    const isOpen = walked.sharesScaled > 0;
    const costBasis = money(isOpen ? walked.costMinor : 0, currency);

    const quote = isOpen ? priceFor(asset, quotes) : null;
    // A price in another currency is not a price: converting it needs an FX
    // rate this app has no source for, and mixing them would overstate a total.
    const usable = quote && quote.currency === currency ? quote : null;
    const marketValue = usable ? valueOf(shares, usable.price, currency) : null;
    const unrealised = marketValue ? money(marketValue.minor - costBasis.minor, currency) : null;

    const position: Position = {
      asset,
      shares,
      costBasis,
      averageCost: isOpen ? perShare(walked.costMinor, shares) : null,
      realised: money(walked.realisedMinor, currency),
      dividends: money(walked.dividendMinor, currency),
      benefits: money(walked.benefitMinor, currency),
      fees: money(walked.feeMinor, currency),
      quote: usable,
      marketValue,
      unrealised,
      returnPct:
        unrealised && costBasis.minor !== 0 ? (unrealised.minor / costBasis.minor) * 100 : null,
      oversold: walked.oversold,
    };
    (isOpen ? open : closed).push(position);
  }

  open.sort(
    (a, b) =>
      (b.marketValue?.minor ?? b.costBasis.minor) - (a.marketValue?.minor ?? a.costBasis.minor) ||
      a.asset.name.localeCompare(b.asset.name),
  );

  const every = [...open, ...closed];
  const totalValue = money(
    open.reduce((acc, p) => acc + (p.marketValue?.minor ?? 0), 0),
    currency,
  );
  // Only the cost of what we could value, so the return below compares like
  // with like: an unquoted holding contributes to neither side.
  const valuedCost = open.reduce((acc, p) => acc + (p.marketValue ? p.costBasis.minor : 0), 0);
  const totalCost = money(
    open.reduce((acc, p) => acc + p.costBasis.minor, 0),
    currency,
  );
  const totalUnrealised = money(totalValue.minor - valuedCost, currency);

  const quotedAsOfs = open
    .map((p) => p.quote?.asOf)
    .filter((asOf): asOf is string => typeof asOf === 'string' && asOf !== '');

  const classTotals = new Map<AssetClass, number>();
  for (const p of open) {
    if (!p.marketValue) continue;
    classTotals.set(
      p.asset.assetClass,
      (classTotals.get(p.asset.assetClass) ?? 0) + p.marketValue.minor,
    );
  }

  const share = (minor: number): number => (totalValue.minor === 0 ? 0 : minor / totalValue.minor);

  return {
    currency,
    holdings: open,
    closed,
    totalValue,
    totalCost,
    totalUnrealised,
    totalRealised: money(
      every.reduce((acc, p) => acc + p.realised.minor, 0),
      currency,
    ),
    totalDividends: money(
      every.reduce((acc, p) => acc + p.dividends.minor, 0),
      currency,
    ),
    totalBenefits: money(
      every.reduce((acc, p) => acc + p.benefits.minor, 0),
      currency,
    ),
    totalFees: money(
      every.reduce((acc, p) => acc + p.fees.minor, 0),
      currency,
    ),
    returnPct: valuedCost === 0 ? null : (totalUnrealised.minor / valuedCost) * 100,
    byAssetClass: [...classTotals.entries()]
      .map(([assetClass, minor]) => ({
        assetClass,
        value: money(minor, currency),
        share: share(minor),
      }))
      .sort((a, b) => b.value.minor - a.value.minor),
    byAsset: open
      .filter((p) => p.marketValue)
      .map((p) => ({
        assetId: p.asset.id,
        value: p.marketValue!,
        share: share(p.marketValue!.minor),
      })),
    assetsUnquoted: open.filter((p) => !p.marketValue).length,
    quotedAsOf: quotedAsOfs.length === 0 ? null : quotedAsOfs.sort()[0]!,
  };
}

/** True for the leg kinds that move a position. The others only carry cash. */
export function movesPosition(kind: LegKind): boolean {
  return kind === 'buy' || kind === 'sell';
}

/** An empty portfolio, for a first run with nothing imported yet. */
export function emptyPortfolio(currency: CurrencyCode): Portfolio {
  return {
    currency,
    holdings: [],
    closed: [],
    totalValue: zero(currency),
    totalCost: zero(currency),
    totalUnrealised: zero(currency),
    totalRealised: zero(currency),
    totalDividends: zero(currency),
    totalBenefits: zero(currency),
    totalFees: zero(currency),
    returnPct: null,
    byAssetClass: [],
    byAsset: [],
    assetsUnquoted: 0,
    quotedAsOf: null,
  };
}

/** Re-exported so a caller can build a zero share count without the scale. */
export function noShares(): Decimal {
  return zeroDecimal(SHARE_SCALE);
}

/**
 * A month's closing price for one asset, already in the portfolio's currency.
 *
 * Converted at the rate of *that* month, not today's: valuing a 2024 holding of
 * a dollar-quoted fund at today's dollar means charting an exchange-rate move
 * as if it were a market move.
 */
export interface PriceHistoryPoint {
  readonly assetId: string;
  readonly month: YearMonth;
  readonly close: Decimal;
}

export interface ValueSeriesInput {
  readonly assets: readonly Asset[];
  readonly legs: readonly InvestmentLeg[];
  readonly history: readonly PriceHistoryPoint[];
  readonly currency: CurrencyCode;
  /** The last month to plot, normally the current one. */
  readonly through: YearMonth;
}

export interface ValuePoint {
  readonly period: YearMonth;
  /** Always `actual`: this is measured history, never a projection. */
  readonly kind: 'actual';
  readonly total: Money;
  /** What the shares held that month had cost by then, for the second line. */
  readonly invested: Money;
  /** True when some holding that month had no price and is missing from the total. */
  readonly partial: boolean;
}

/**
 * The portfolio's worth at the end of every month it has existed.
 *
 * Shares are counted from the legs booked up to that month's end, and priced at
 * that month's close — the last close at or before it, so a month the provider
 * has no point for carries the previous one forward rather than collapsing to
 * zero. A month where some holding cannot be priced is marked `partial` instead
 * of quietly reporting a smaller total than the truth.
 */
export function portfolioValueSeries(input: ValueSeriesInput): readonly ValuePoint[] {
  const { currency } = input;
  const trades = input.legs.filter((leg) => movesPosition(leg.kind));
  if (trades.length === 0) return [];

  const first = trades.reduce(
    (earliest, leg) => (leg.bookingDate < earliest ? leg.bookingDate : earliest),
    trades[0]!.bookingDate,
  );
  const months = monthRange(yearMonthOf(first), input.through);

  // Closes per asset, in month order, so each month can walk forward to the
  // last one at or before it without rescanning.
  const closes = new Map<string, PriceHistoryPoint[]>();
  for (const point of input.history) {
    const bucket = closes.get(point.assetId);
    if (bucket) bucket.push(point);
    else closes.set(point.assetId, [point]);
  }
  for (const bucket of closes.values()) bucket.sort((a, b) => a.month.localeCompare(b.month));

  const byAsset = new Map<string, InvestmentLeg[]>();
  for (const leg of trades) {
    const bucket = byAsset.get(leg.assetId);
    if (bucket) bucket.push(leg);
    else byAsset.set(leg.assetId, [leg]);
  }

  return months.map((month) => {
    const end = lastOfMonth(month);
    let totalMinor = 0;
    let investedMinor = 0;
    let partial = false;

    for (const asset of input.assets) {
      const legs = (byAsset.get(asset.id) ?? []).filter((leg) => leg.bookingDate <= end);
      if (legs.length === 0) continue;

      const sharesScaled = legs.reduce((acc, leg) => acc + leg.shares.scaled, 0);
      if (sharesScaled <= 0) continue;
      const shares = decimal(sharesScaled, SHARE_SCALE);

      const walked = walk(legs);
      investedMinor += walked.costMinor;

      const close = lastCloseAtOrBefore(closes.get(asset.id), month);
      if (!close) {
        partial = true;
        continue;
      }
      totalMinor += valueOf(shares, close, currency).minor;
    }

    return {
      period: month,
      kind: 'actual' as const,
      total: money(totalMinor, currency),
      invested: money(investedMinor, currency),
      partial,
    };
  });
}

function lastCloseAtOrBefore(
  points: readonly PriceHistoryPoint[] | undefined,
  month: YearMonth,
): Decimal | null {
  if (!points) return null;
  let found: Decimal | null = null;
  for (const point of points) {
    if (point.month > month) break;
    found = point.close;
  }
  return found;
}
