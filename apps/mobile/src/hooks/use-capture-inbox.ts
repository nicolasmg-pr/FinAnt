import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [error, setError] = useState<Error | null>(null);

  // `reload` is called from more than one site over the screen's life — the
  // mount effect below, and the inbox screen's own focus effect — so a single
  // per-effect `cancelled` local cannot guard it. A ref that flips once, on
  // unmount, covers every call instead.
  const cancelled = useRef(false);
  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [rows, pending, coverage] = await Promise.all([
        listCaptures(['pending', 'unreadable']),
        listProvisionalTransactions(),
        latestBookedDateByAccount(),
      ]);
      if (cancelled.current) return;
      const today = new Date().toISOString().slice(0, 10);
      setCaptures(rows);
      setProvisionals(pending);
      setStale(new Set(staleProvisionals(pending, coverage, today)));
    } catch (cause) {
      // Recorded rather than thrown: a failed read must not strand `loading`
      // at true forever, and the screen has somewhere to say what happened.
      if (!cancelled.current) setError(cause as Error);
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { captures, provisionals, stale, loading, error, reload };
}
