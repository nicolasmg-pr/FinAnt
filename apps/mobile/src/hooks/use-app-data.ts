import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from '@finant/core';
import { listAccounts, type AccountRow } from '../db/accounts-repo';
import { listAllTransactions } from '../db/transactions-repo';

interface AppData {
  transactions: Transaction[];
  /** Non-archived accounts, so screens can name where a movement came from. */
  accounts: AccountRow[];
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
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [rows, known] = await Promise.all([listAllTransactions(), listAccounts()]);
      setTransactions(rows);
      setAccounts(known);
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { transactions, accounts, loading, error, reload };
}
