import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Confidence, Granularity, NetWorthSeries } from '@finant/core';
import { radius, spacing, type, useTheme } from '../../design';
import { Amount } from '../Amount';
import { BalanceChart } from '../BalanceChart';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Touchable } from '../ui/Touchable';

/**
 * What the accounts hold, and how they got there.
 *
 * Lifted out of the dashboard screen unchanged when the view selector arrived:
 * three heroes now compete for the same slot, and a screen that inlines all of
 * them is a screen nobody can read. The behaviour here is exactly what it was.
 */
export function CashHero({
  netWorth,
  labels,
  confidence,
  granularity,
  onGranularityChange,
  hasTransactions,
}: {
  netWorth: NetWorthSeries;
  labels: readonly string[];
  confidence: Confidence;
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  hasTransactions: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  if (netWorth.accountsCounted === 0) {
    return (
      <Touchable onPress={() => router.push('/banks')} accessibilityRole="button">
        <Text style={[type.body, { color: theme.textMuted }]}>{t('dashboard.noBalances')}</Text>
        <Text style={[type.body, { color: theme.accent }]}>{t('dashboard.setBalances')}</Text>
      </Touchable>
    );
  }

  return (
    <>
      <Amount value={netWorth.current} tone="neutral" size="display" />
      <Text style={[type.caption, { color: theme.textMuted }]}>{t('dashboard.asOfToday')}</Text>

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
          <BalanceChart points={netWorth.points} labels={labels} confidence={confidence} />
        </View>
      ) : null}

      {/* The switch outlives the chart on purpose: a single year collapses to
          one point, and hiding the switch with the chart left no way back to
          months. */}
      {hasTransactions ? (
        <SegmentedControl
          options={[
            { value: 'month' as const, label: t('dashboard.byMonth') },
            { value: 'year' as const, label: t('dashboard.byYear') },
          ]}
          value={granularity}
          onChange={onGranularityChange}
        />
      ) : null}

      {netWorth.points.length > 1 && netWorth.points.some((point) => point.kind === 'projected') ? (
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {t('dashboard.projectedTail')}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  warningText: { flexShrink: 1 },
  // The chart reaches both screen edges; the screen's own padding is undone
  // for its width only.
  bleed: { marginHorizontal: -spacing.lg },
});
