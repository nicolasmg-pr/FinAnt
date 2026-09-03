import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { currentPeriod, type Period, type Transaction } from '@finant/core';
import { formatBookingDate } from '../i18n';

export interface PayPeriod {
  readonly period: Period;
  /** Card title: "Since 28 Aug" when anchored on a salary, "This month" otherwise. */
  readonly title: string;
}

/**
 * The window the dashboard and the budgets screen report on: from the owner's
 * last salary booking to today, or the calendar month while no salary has been
 * booked yet. Both screens derive it from the same ledger and the same `today`,
 * so their figures agree.
 */
export function usePayPeriod(transactions: readonly Transaction[], today: string): PayPeriod {
  const { t } = useTranslation();
  return useMemo(() => {
    const period = currentPeriod(transactions, today);
    const title = period.anchored
      ? t('dashboard.sincePayroll', {
          date: formatBookingDate(period.from, { day: 'numeric', month: 'short' }),
        })
      : t('dashboard.thisMonth');
    return { period, title };
  }, [transactions, today, t]);
}
