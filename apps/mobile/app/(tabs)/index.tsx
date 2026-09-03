import { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  detectRecurring,
  forecastYear,
  money,
  monthsOfYear,
  summarisePeriod,
  yearMonthOf,
} from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { Card } from '../../src/components/Card';
import { CategoryBreakdown } from '../../src/components/CategoryBreakdown';
import { ForecastChart } from '../../src/components/ForecastChart';
import { useAppData } from '../../src/hooks/use-app-data';
import { usePayPeriod } from '../../src/hooks/use-pay-period';
import { intlLocale } from '../../src/i18n';
import { spacing, useTheme } from '../../src/theme';

const CURRENCY = 'EUR';

export default function DashboardScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { transactions, loading, reload } = useAppData();

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
  const recurring = useMemo(() => detectRecurring(transactions, CURRENCY), [transactions]);

  const monthLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(intlLocale(), { month: 'narrow' });
    return monthsOfYear(year).map((m) => formatter.format(new Date(`${m}-01T00:00:00Z`)));
  }, [year]);

  const savingsRate =
    summary.income.minor > 0 ? Math.round((summary.net.minor / summary.income.minor) * 100) : null;

  if (transactions.length === 0 && !loading) {
    return (
      <ScrollView contentContainerStyle={[styles.screen, { backgroundColor: theme.background }]}>
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

      <Card
        title={t('dashboard.yearForecast')}
        subtitle={t(`dashboard.confidence.${forecast.confidence}`, {
          months: forecast.historyMonths,
        })}
      >
        <ForecastChart months={forecast.months} labels={monthLabels} />
        <View style={styles.figures}>
          <Figure label={t('dashboard.income')}>
            <Amount value={forecast.totalIncome} tone="income" style={styles.figureValue} />
          </Figure>
          <Figure label={t('dashboard.expenses')}>
            <Amount value={forecast.totalExpenses} tone="expense" style={styles.figureValue} />
          </Figure>
          <Figure label={t('dashboard.net')}>
            <Amount value={forecast.totalNet} style={styles.figureValue} />
          </Figure>
        </View>
      </Card>

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
    </ScrollView>
  );
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
