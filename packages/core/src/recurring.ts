import { daysBetween } from './dates';
import { money, type CurrencyCode, type Money } from './money';
import { merchantKey } from './normalise';
import { coefficientOfVariation, median } from './stats';
import type { ISODate, Transaction } from './types';

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  monthly: 30.44,
  quarterly: 91.3,
  yearly: 365.25,
};

export interface RecurringSeries {
  /** Normalised merchant key the series was grouped on. */
  readonly key: string;
  /** Raw narrative of the most recent occurrence, for display. */
  readonly label: string;
  readonly categoryId: string | null;
  readonly cadence: Cadence;
  /** Signed typical amount (negative for a subscription). */
  readonly typicalAmount: Money;
  readonly occurrences: number;
  readonly lastDate: ISODate;
  readonly amountStability: number;
}

interface Options {
  /** Minimum occurrences before a pattern is called recurring. Two points are a coincidence. */
  readonly minOccurrences?: number;
  /** Max coefficient of variation on amount. Rent varies by 0; electricity by a lot. */
  readonly maxAmountVariation?: number;
  /** How far a median gap may drift from the ideal cadence, as a fraction. */
  readonly cadenceTolerance?: number;
}

function classifyCadence(medianGapDays: number, tolerance: number): Cadence | null {
  for (const [cadence, days] of Object.entries(CADENCE_DAYS) as [Cadence, number][]) {
    if (Math.abs(medianGapDays - days) <= days * tolerance) return cadence;
  }
  return null;
}

/**
 * Finds subscriptions, rent, salary and other repeating movements by grouping on
 * merchant key and checking that both the interval and the amount are stable.
 * Feeds the forecast: a known EUR 900 rent on the 1st is not a statistic, it is
 * a certainty, and should not be blended into a median with restaurant spend.
 */
export function detectRecurring(
  transactions: readonly Transaction[],
  currency: CurrencyCode,
  options: Options = {},
): RecurringSeries[] {
  const minOccurrences = options.minOccurrences ?? 3;
  const maxAmountVariation = options.maxAmountVariation ?? 0.25;
  const cadenceTolerance = options.cadenceTolerance ?? 0.25;

  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.excludedFromStats) continue;
    const key = merchantKey(tx.counterparty ?? tx.description);
    if (key.length < 4) continue;
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }

  const series: RecurringSeries[] = [];
  for (const [key, txsUnsorted] of groups) {
    if (txsUnsorted.length < minOccurrences) continue;
    const txs = [...txsUnsorted].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));

    const gaps: number[] = [];
    for (let i = 1; i < txs.length; i += 1) {
      gaps.push(daysBetween(txs[i - 1]!.bookingDate, txs[i]!.bookingDate));
    }
    const cadence = classifyCadence(median(gaps), cadenceTolerance);
    if (!cadence) continue;

    const amounts = txs.map((t) => t.amount.minor);
    const stability = coefficientOfVariation(amounts.map(Math.abs));
    if (stability > maxAmountVariation) continue;

    const last = txs[txs.length - 1]!;
    series.push({
      key,
      label: last.counterparty ?? last.description,
      categoryId: last.categoryId,
      cadence,
      typicalAmount: money(Math.round(median(amounts)), currency),
      occurrences: txs.length,
      lastDate: last.bookingDate,
      amountStability: stability,
    });
  }

  return series.sort((a, b) => Math.abs(b.typicalAmount.minor) - Math.abs(a.typicalAmount.minor));
}
