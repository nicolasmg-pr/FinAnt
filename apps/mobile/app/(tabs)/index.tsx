import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { Empty } from '../../src/components/ui/Empty';
import { ForecastChart } from '../../src/components/ForecastChart';
import { GrainRow } from '../../src/components/trail/GrainRow';
import { ListRow } from '../../src/components/ui/ListRow';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { StatTile } from '../../src/components/ui/StatTile';
import { Touchable } from '../../src/components/ui/Touchable';
import { Trail } from '../../src/components/trail/Trail';
import { useAppData } from '../../src/hooks/use-app-data';
import { usePayPeriod } from '../../src/hooks/use-pay-period';
import { intlLocale } from '../../src/i18n';
import { radius, spacing, type, useMotion, useTheme } from '../../src/design';

const CURRENCY = 'EUR';

export default function DashboardScreen() {
  const theme = useTheme();
  const motion = useMotion();
  // The tab hides its header so the title can scroll away with the content;
  // without the inset that title would sit under the notch.
  const insets = useSafeAreaInsets();
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

  // Read on every render and passed in, rather than called inside the memos:
  // the labels are built with Intl from the active locale, and a language
  // change re-renders this screen without changing `netWorth` or `year`. As a
  // dependency the memos could not see, it left the axis in the language the
  // owner had just left.
  const locale = intlLocale();

  const netWorthLabels = useMemo(
    () =>
      periodLabels(
        netWorth.points.map((point) => point.period),
        granularity,
        locale,
      ),
    [netWorth, granularity, locale],
  );

  const monthLabels = useMemo(
    () => monthsOfYear(year).map((m) => monthLabel(m, locale)),
    [year, locale],
  );

  // Whichever of the two the card is showing; both carry the same three totals.
  const yearTotals = yearView === 'projected' ? forecast : booked;

  const savingsRate =
    summary.income.minor > 0 ? Math.round((summary.net.minor / summary.income.minor) * 100) : null;

  // Display only. The bar answers "how much of what came in went out", which
  // the savings-rate caption states as a figure underneath it.
  const spendRatio =
    summary.income.minor > 0 ? summary.expenses.minor / summary.income.minor : null;

  // Booked months only. A month that has not happened yet is not a month that
  // failed, so the row counts what is known and stops there.
  const monthsInBlack = useMemo(
    () => booked.months.filter((month) => month.net.minor >= 0).length,
    [booked],
  );

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
        contentContainerStyle={[styles.screen, { paddingTop: insets.top + spacing.lg }]}
      >
        <Text style={[type.title, { color: theme.text }]}>{t('nav.dashboard')}</Text>
        <Empty message={t('dashboard.noData')} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.screen, { paddingTop: insets.top + spacing.lg }]}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={reload} tintColor={theme.accent} />
      }
    >
      <Text style={[type.title, { color: theme.text }]}>{t('nav.dashboard')}</Text>

      {/* The hero carries no card chrome: the balance is the page, not an item
          on it. */}
      <View style={styles.hero}>
        <Text style={[type.caption, styles.heroLabel, { color: theme.textMuted }]}>
          {t('dashboard.total')}
        </Text>

        {netWorth.accountsCounted === 0 ? (
          <Touchable onPress={() => router.push('/banks')} accessibilityRole="button">
            <Text style={[type.body, { color: theme.textMuted }]}>{t('dashboard.noBalances')}</Text>
            <Text style={[type.body, { color: theme.accent }]}>{t('dashboard.setBalances')}</Text>
          </Touchable>
        ) : (
          <>
            <Amount value={netWorth.current} tone="neutral" size="display" />
            <Text style={[type.caption, { color: theme.textMuted }]}>
              {t('dashboard.asOfToday')}
            </Text>

            {netWorth.accountsSkipped > 0 ? (
              <Touchable
                onPress={() => router.push('/banks')}
                accessibilityRole="button"
                style={[styles.warning, { backgroundColor: theme.warningSoft }]}
              >
                <Feather name="alert-circle" size={14} color={theme.warning} />
                <Text style={[type.label, styles.warningText, { color: theme.warning }]}>
                  {t('dashboard.balanceMissing', { count: netWorth.accountsSkipped })}
                </Text>
              </Touchable>
            ) : null}

            {/* One point is a dot, not a line. */}
            {netWorth.points.length > 1 ? (
              <View style={styles.bleed}>
                <BalanceChart
                  points={netWorth.points}
                  labels={netWorthLabels}
                  confidence={forecast.confidence}
                />
              </View>
            ) : null}

            {/* The switch outlives the chart on purpose: a single year collapses
                to one point, and hiding the switch with the chart left no way
                back to months. */}
            {transactions.length > 0 ? (
              <SegmentedControl
                options={[
                  { value: 'month' as const, label: t('dashboard.byMonth') },
                  { value: 'year' as const, label: t('dashboard.byYear') },
                ]}
                value={granularity}
                onChange={setGranularity}
              />
            ) : null}

            {netWorth.points.length > 1 &&
            netWorth.points.some((point) => point.kind === 'projected') ? (
              <Text style={[type.caption, { color: theme.textMuted }]}>
                {t('dashboard.projectedTail')}
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* Everything below is about movements, so it waits for one. */}
      {transactions.length === 0 ? (
        <Empty message={t('dashboard.noData')} />
      ) : (
        <>
          <Card title={periodTitle}>
            <View style={styles.figures}>
              <StatTile label={t('dashboard.income')} tone="income">
                <Amount value={summary.income} tone="income" size="heading" fit />
              </StatTile>
              <StatTile label={t('dashboard.expenses')} tone="expense">
                <Amount value={summary.expenses} tone="expense" size="heading" fit />
              </StatTile>
              <StatTile label={t('dashboard.net')} tone="neutral">
                <Amount value={summary.net} size="heading" fit />
              </StatTile>
            </View>
            {spendRatio !== null ? (
              <Trail
                parts={[{ ratio: spendRatio, tone: 'accent' }]}
                state={spendRatio > 1 ? 'over' : 'under'}
              />
            ) : null}
            {savingsRate !== null ? (
              <Text style={[type.label, { color: theme.textMuted }]}>
                {t('dashboard.savingsRate')}: {savingsRate}%
              </Text>
            ) : null}
            {period.anchored ? (
              <Text style={[type.caption, { color: theme.textMuted }]}>
                {t('dashboard.payPeriodHint')}
              </Text>
            ) : null}
          </Card>

          <Card title={t('dashboard.topCategories')}>
            <CategoryBreakdown totals={summary.expensesByCategory} />
          </Card>

          <Card
            subtitle={
              yearView === 'projected'
                ? t(`dashboard.confidence.${forecast.confidence}`, {
                    months: forecast.historyMonths,
                  })
                : t('dashboard.bookedMonths', { count: booked.months.length })
            }
          >
            {/* Was a tap anywhere on the card, explained by a hint line at the
                bottom. A projection and a booked figure are different claims;
                which one you are looking at should be visible, not inferred. */}
            <SegmentedControl
              options={[
                { value: 'projected' as const, label: t('dashboard.yearForecast') },
                { value: 'booked' as const, label: t('dashboard.yearBooked') },
              ]}
              value={yearView}
              onChange={setYearView}
            />

            <Animated.View key={yearView} entering={FadeIn.duration(motion.quick)}>
              <ForecastChart
                months={yearView === 'projected' ? forecast.months : booked.months}
                labels={
                  yearView === 'projected'
                    ? monthLabels
                    : monthLabels.slice(0, booked.months.length)
                }
              />
              <View style={styles.figures}>
                <StatTile label={t('dashboard.income')} tone="income">
                  <Amount value={yearTotals.totalIncome} tone="income" size="heading" fit />
                </StatTile>
                <StatTile label={t('dashboard.expenses')} tone="expense">
                  <Amount value={yearTotals.totalExpenses} tone="expense" size="heading" fit />
                </StatTile>
                <StatTile label={t('dashboard.net')} tone="neutral">
                  <Amount value={yearTotals.totalNet} size="heading" fit />
                </StatTile>
              </View>
              {/* Only under the booked view: the row is a claim about months
                  that have happened, and next to a projection it would read as
                  a claim about months that have not. */}
              {yearView === 'booked' && booked.months.length > 0 ? (
                <>
                  <GrainRow total={booked.months.length} filled={monthsInBlack} />
                  <Text style={[type.label, { color: theme.textMuted }]}>
                    {t('dashboard.monthsInBlack', {
                      count: monthsInBlack,
                      total: booked.months.length,
                    })}
                  </Text>
                </>
              ) : null}
            </Animated.View>
          </Card>

          {recurring.length > 0 ? (
            <Card title={t('dashboard.recurring')}>
              {recurring.slice(0, 6).map((series, index) => (
                <ListRow
                  key={series.key}
                  title={series.label}
                  trailing={<Amount value={money(series.typicalAmount.minor, CURRENCY)} />}
                  divider={index < Math.min(recurring.length, 6) - 1}
                />
              ))}
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

/**
 * A month as three letters — "ene", "Sep", "sept" trimmed to fit an axis.
 *
 * Not `month: 'narrow'`, which is defined as a single letter and therefore
 * ambiguous in every language the app speaks: Spanish has marzo and mayo both
 * as M, junio and julio both as J. An axis reading "D M O D" tells the owner
 * nothing.
 */
function monthLabel(period: string, locale: string): string {
  const short = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${period}-01T00:00:00Z`),
  );
  // Some locales already give three letters, some four ("sept"); trimming to
  // three keeps twelve of them inside a phone's width.
  return short.replace('.', '').slice(0, 3);
}

/**
 * Axis labels for the balance chart, thinned to at most six so they stay
 * legible: a year label at every year, and a short month otherwise.
 */
function periodLabels(
  periods: readonly string[],
  granularity: Granularity,
  locale: string,
): string[] {
  if (granularity === 'year') return [...periods];
  const step = Math.ceil(periods.length / 6);
  return periods.map((period, i) => {
    if (i % step !== 0 && i !== periods.length - 1) return '';
    const short = monthLabel(period, locale);
    // January carries the year, so a line spanning several years says which.
    return period.endsWith('-01') ? `${short} ${period.slice(2, 4)}` : short;
  });
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  hero: { gap: spacing.sm, marginBottom: spacing.sm },
  heroLabel: { textTransform: 'uppercase' },
  // The chart reaches both screen edges; the screen's own padding is undone
  // for its width only.
  bleed: { marginHorizontal: -spacing.lg },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  warningText: { flexShrink: 1 },
  figures: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
