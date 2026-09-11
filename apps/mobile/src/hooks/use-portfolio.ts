import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  buildPortfolio,
  emptyPortfolio,
  portfolioValueSeries,
  yearMonthOf,
  type Portfolio,
  type ValuePoint,
} from '@finant/core';
import { loadPortfolioInput } from '../db/investments-repo';
import { backfillHistory, refreshQuotes } from '../services/prices';

const CURRENCY = 'EUR';

interface PortfolioState {
  portfolio: Portfolio;
  /** Month-end value since the first trade. Empty until history is fetched. */
  series: readonly ValuePoint[];
  loading: boolean;
  refreshing: boolean;
  /** True when the last refresh reached nothing. The screen says so and keeps
   * rendering from cache; it never becomes an error state. */
  offline: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  refresh: (options?: { force?: boolean }) => Promise<void>;
}

/**
 * The portfolio as a screen sees it: always rendered from what is stored, with
 * a price refresh layered on top rather than gating it.
 *
 * The order matters. Read the database, show the figures, then go to the
 * network — so a slow or dead provider costs the owner a stale timestamp, never
 * a blank screen. The refresh on mount is skipped entirely when every price is
 * fresh, which is what keeps this from being background traffic.
 */
export function usePortfolio(): PortfolioState {
  const [portfolio, setPortfolio] = useState<Portfolio>(() => emptyPortfolio(CURRENCY));
  const [series, setSeries] = useState<readonly ValuePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const { assets, legs, quotes, history } = await loadPortfolioInput();
      if (!mounted.current) return;
      const today = new Date().toISOString().slice(0, 10);
      setPortfolio(buildPortfolio({ assets, legs, quotes, currency: CURRENCY, today }));
      setSeries(
        portfolioValueSeries({
          assets,
          legs,
          history,
          currency: CURRENCY,
          through: yearMonthOf(today),
        }),
      );
    } catch (cause) {
      if (mounted.current) setError(cause as Error);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(
    async (options: { force?: boolean } = {}) => {
      setRefreshing(true);
      try {
        const result = await refreshQuotes({ force: options.force });
        // After the quotes, and never instead of them: the figure on screen
        // matters more than the line under it, and the line is only missing
        // months, not wrong.
        await backfillHistory();
        // Asking about nothing is not being offline; it means every price was
        // already fresh, or every asset is priced by hand.
        if (mounted.current) {
          setOffline(result.requested > 0 && result.updated === 0);
        }
        await reload();
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    },
    [reload],
  );

  useEffect(() => {
    void (async () => {
      await reload();
      await refresh();
    })();
  }, [reload, refresh]);

  // Re-read whenever the screen comes back into view.
  //
  // Without this the portfolio is whatever it was when the tab first mounted:
  // an import on another screen adds the holdings to the database and the
  // dashboard keeps showing "no investments yet" until the app is restarted,
  // which reads as the feature being broken rather than stale. Only the
  // database is re-read — the network is left to `refresh`, so coming back to
  // the tab never costs a request.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { portfolio, series, loading, refreshing, offline, error, reload, refresh };
}
