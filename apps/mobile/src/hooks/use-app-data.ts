import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from '@finant/core';
import { listAllTransactions } from '../db/transactions-repo';

interface AppData {
  transactions: Transaction[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

/**
 * Loads the whole ledger once and hands it to the screens.
 *
 * A personal history is a few thousand rows; aggregating it in memory keeps
 * every chart consistent with the movements list, and avoids a second set of
 * SQL aggregates that could quietly disagree with the domain code.
 */
export function useAppData(): AppData {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setTransactions(await listAllTransactions());
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { transactions, loading, error, reload };
}
