import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  bookedYear,
  detectRecurring,
  forecastYear,
  money,
  monthsOfYear,
  netWorthSeries,
  summarisePeriod,
  yearMonthOf,
  type Granularity,
  type NetWorthAccount,
  type Transaction,
} from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { BalanceChart } from '../../src/components/BalanceChart';
import { Card } from '../../src/components/Card';
import { CategoryBreakdown } from '../../src/components/CategoryBreakdown';
import { Chip } from '../../src/components/Chip';
import { ForecastChart } from '../../src/components/ForecastChart';
import { useAppData } from '../../src/hooks/use-app-data';
import { usePayPeriod } from '../../src/hooks/use-pay-period';
import { intlLocale } from '../../src/i18n';
import { spacing, useTheme } from '../../src/theme';

const CURRENCY = 'EUR';

export default function DashboardScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { transactions, accounts, loading, reload } = useAppData();
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [yearView, setYearView] = useState<'projected' | 'booked'>('projected');

  // Re-read on focus: an import happened on another screen.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const month = yearMonthOf(today);
  const year = Number(month.slice(0, 4));

  const { period, title: periodTitle } = usePayPeriod(transactions, today);
  const summary = useMemo(
    () => summarisePeriod(transactions, period, CURRENCY),
    [transactions, period],
  );
  const forecast = useMemo(
    () => forecastYear(transactions, year, CURRENCY, { today }),
    [transactions, year, today],
  );
  const booked = useMemo(
    () => bookedYear(transactions, year, CURRENCY, { today }),
    [transactions, year, today],
  );
  const recurring = useMemo(() => detectRecurring(transactions, CURRENCY), [transactions]);

  // One bucket per account: a balance is the sum of one account's own
  // movements on top of that account's opening balance, never of the ledger.
  const netWorthAccounts = useMemo<NetWorthAccount[]>(() => {
    const byAccount = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const bucket = byAccount.get(tx.accountId) ?? [];
      bucket.push(tx);
      byAccount.set(tx.accountId, bucket);
    }
    return accounts.map((row) => ({
      accountId: row.id,
      // The assertion itself, not a figure derived from it: the total is what
      // the owner said their accounts hold, adjusted only by what has moved
      // since they said it.
      anchor:
        row.balance_minor === null || row.balance_date === null
          ? null
          : {
              assertedMinor: row.balance_minor,
              asOf: row.balance_date,
              currency: row.currency,
            },
      currency: row.currency,
      movements: byAccount.get(row.id) ?? [],
    }));
  }, [transactions, accounts]);

  // Only whole months ahead: the current month's remainder is already part of
  // the balance held today, and adding it again would count it twice.
  const projected = useMemo(
    () =>
      forecast.months
        .filter((month) => month.kind === 'projected')
        .map((month) => ({ period: month.month, netMinor: month.net.minor })),
    [forecast],
  );

  const netWorth = useMemo(
    () =>
      netWorthSeries(netWorthAccounts, {
        today,
        granularity,
        currency: CURRENCY,
        projected,
      }),
    [netWorthAccounts, today, granularity, projected],
  );

  const netWorthLabels = useMemo(
    () =>
      periodLabels(
        netWorth.points.map((point) => point.period),
        granularity,
      ),
    [netWorth, granularity],
  );

  const monthLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(intlLocale(), { month: 'narrow' });
    return monthsOfYear(year).map((m) => formatter.format(new Date(`${m}-01T00:00:00Z`)));
  }, [year]);

  // Whichever of the two the card is showing; both carry the same three totals.
  const yearTotals = yearView === 'projected' ? forecast : booked;

  const savingsRate =
    summary.income.minor > 0 ? Math.round((summary.net.minor / summary.income.minor) * 100) : null;

  // Only when there is nothing at all to say. A balance the owner has
  // asserted is worth showing on its own: it answers "what do I have" without
  // a single movement having been imported.
  if (transactions.length === 0 && netWorth.accountsCounted === 0 && !loading) {
    return (
      // The colour goes on the ScrollView, not its content container: the
      // container is only as tall as the card, so everything below it fell
      // through to the navigator's own scene colour and left a grey seam.
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.screen}
      >
        <Card title={t('dashboard.title')}>
          <Text style={{ color: theme.textMuted }}>{t('dashboard.noData')}</Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.screen}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={reload} tintColor={theme.accent} />
      }
    >
      <Card
        title={t('dashboard.total')}
        subtitle={netWorth.accountsCounted > 0 ? t(`dashboard.asOfToday`) : undefined}
      >
        {netWorth.accountsCounted === 0 ? (
          <Pressable onPress={() => router.push('/banks')} accessibilityRole="button">
            <Text style={{ color: theme.textMuted }}>{t('dashboard.noBalances')}</Text>
            <Text style={[styles.hint, { color: theme.accent }]}>{t('dashboard.setBalances')}</Text>
          </Pressable>
        ) : (
          <>
            <Amount value={netWorth.current} tone="neutral" style={styles.total} />
            {netWorth.accountsSkipped > 0 ? (
              <Pressable onPress={() => router.push('/banks')} accessibilityRole="button">
                <Text style={[styles.hint, { color: theme.warning }]}>
                  {t('dashboard.balanceMissing', { count: netWorth.accountsSkipped })}
                </Text>
              </Pressable>
            ) : null}
            {/* One point is a dot, not a line. */}
            {netWorth.points.length > 1 ? (
              <BalanceChart points={netWorth.points} labels={netWorthLabels} />
            ) : null}
            {/* The switch outlives the chart on purpose: a single year collapses
                to one point, and hiding the switch with the chart left no way
                back to months. */}
            {transactions.length > 0 ? (
              <View style={styles.granularity}>
                <Chip
                  label={t('dashboard.byMonth')}
                  selected={granularity === 'month'}
                  onPress={() => setGranularity('month')}
                />
                <Chip
                  label={t('dashboard.byYear')}
                  selected={granularity === 'year'}
                  onPress={() => setGranularity('year')}
                />
              </View>
            ) : null}
            {netWorth.points.length > 1 &&
            netWorth.points.some((point) => point.kind === 'projected') ? (
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {t('dashboard.projectedTail')}
              </Text>
            ) : null}
          </>
        )}
      </Card>

      {/* Everything below is about movements, so it waits for one. */}
      {transactions.length === 0 ? (
        <Card title={t('dashboard.title')}>
          <Text style={{ color: theme.textMuted }}>{t('dashboard.noData')}</Text>
        </Card>
      ) : (
        <>
          <Card title={periodTitle}>
            <View style={styles.figures}>
              <Figure label={t('dashboard.income')}>
                <Amount value={summary.income} tone="income" style={styles.figureValue} />
              </Figure>
              <Figure label={t('dashboard.expenses')}>
                <Amount value={summary.expenses} tone="expense" style={styles.figureValue} />
              </Figure>
              <Figure label={t('dashboard.net')}>
                <Amount value={summary.net} style={styles.figureValue} />
              </Figure>
            </View>
            {savingsRate !== null ? (
              <Text style={{ color: theme.textMuted }}>
                {t('dashboard.savingsRate')}: {savingsRate}%
              </Text>
            ) : null}
            {period.anchored ? (
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {t('dashboard.payPeriodHint')}
              </Text>
            ) : null}
          </Card>

          <Card title={t('dashboard.topCategories')}>
            <CategoryBreakdown totals={summary.expensesByCategory} />
          </Card>

          <Pressable
            onPress={() => setYearView(yearView === 'projected' ? 'booked' : 'projected')}
            accessibilityRole="button"
            accessibilityHint={t('dashboard.tapToToggle')}
          >
            <Card
              title={
                yearView === 'projected' ? t('dashboard.yearForecast') : t('dashboard.yearBooked')
              }
              subtitle={
                yearView === 'projected'
                  ? t(`dashboard.confidence.${forecast.confidence}`, {
                      months: forecast.historyMonths,
                    })
                  : t('dashboard.bookedMonths', { count: booked.months.length })
              }
            >
              <ForecastChart
                months={yearView === 'projected' ? forecast.months : booked.months}
                labels={
                  yearView === 'projected'
                    ? monthLabels
                    : monthLabels.slice(0, booked.months.length)
                }
              />
              <View style={styles.figures}>
                <Figure label={t('dashboard.income')}>
                  <Amount value={yearTotals.totalIncome} tone="income" style={styles.figureValue} />
                </Figure>
                <Figure label={t('dashboard.expenses')}>
                  <Amount
                    value={yearTotals.totalExpenses}
                    tone="expense"
                    style={styles.figureValue}
                  />
                </Figure>
                <Figure label={t('dashboard.net')}>
                  <Amount value={yearTotals.totalNet} style={styles.figureValue} />
                </Figure>
              </View>
              <Text style={[styles.hint, { color: theme.accent }]}>
                {yearView === 'projected'
                  ? t('dashboard.showBooked')
                  : t('dashboard.showProjection')}
              </Text>
            </Card>
          </Pressable>

          {recurring.length > 0 ? (
            <Card title={t('dashboard.recurring')}>
              {recurring.slice(0, 6).map((series) => (
                <View key={series.key} style={styles.recurringRow}>
                  <Text style={{ color: theme.text, flexShrink: 1 }} numberOfLines={1}>
                    {series.label}
                  </Text>
                  <Amount value={money(series.typicalAmount.minor, CURRENCY)} />
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

/**
 * Axis labels for the balance chart, thinned to at most eight so they stay
 * legible: a year label at every year, and a month narrow otherwise.
 */
function periodLabels(periods: readonly string[], granularity: Granularity): string[] {
  if (granularity === 'year') return [...periods];
  const formatter = new Intl.DateTimeFormat(intlLocale(), { month: 'narrow' });
  const step = Math.ceil(periods.length / 8);
  return periods.map((period, i) => {
    if (i % step !== 0 && i !== periods.length - 1) return '';
    const narrow = formatter.format(new Date(`${period}-01T00:00:00Z`));
    // January carries the year, so a line spanning several years says which.
    return period.endsWith('-01') ? `${narrow} ${period.slice(2, 4)}` : narrow;
  });
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureLabel, { color: theme.textMuted }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  hint: { fontSize: 13 },
  total: { fontSize: 30, fontWeight: '700' },
  granularity: { flexDirection: 'row', gap: spacing.sm },
  figures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  figure: { flex: 1, gap: 2 },
  figureLabel: { fontSize: 12 },
  figureValue: { fontSize: 17, fontWeight: '700' },
  recurringRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
});
