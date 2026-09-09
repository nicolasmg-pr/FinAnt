import { useCallback, useEffect, useState } from 'react';
import { staleProvisionals } from '@finant/core';
import { listCaptures } from '../db/notification-captures-repo';
import { latestBookedDateByAccount, listProvisionalTransactions } from '../db/transactions-repo';
import type { NotificationCapture } from '../db/mappers';
import type { Transaction } from '@finant/core';

export function useCaptureInbox() {
  const [captures, setCaptures] = useState<NotificationCapture[]>([]);
  const [provisionals, setProvisionals] = useState<Transaction[]>([]);
  const [stale, setStale] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [rows, pending, coverage] = await Promise.all([
      listCaptures(['pending', 'unreadable']),
      listProvisionalTransactions(),
      latestBookedDateByAccount(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    setCaptures(rows);
    setProvisionals(pending);
    setStale(new Set(staleProvisionals(pending, coverage, today)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { captures, provisionals, stale, loading, reload };
}
