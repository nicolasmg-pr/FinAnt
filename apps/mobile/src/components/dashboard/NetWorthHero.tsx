import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, type CombinedWorth, type Granularity } from '@finant/core';
import { intlLocale } from '../../i18n';
import { radius, spacing, type, useTheme } from '../../design';
import { Amount } from '../Amount';
import { BalanceChart } from '../BalanceChart';
import { SegmentedControl } from '../ui/SegmentedControl';

/**
 * Everything the owner has, in one figure and one line.
 *
 * The two halves are shown under the total rather than folded into it: the
 * whole point of the view is that the money is in two different shapes, and a
 * single figure hides which shape moved.
 *
 * The line carries no projected tail, unlike the cash hero's. The forecast
 * behind that tail is built from the owner's own recurring movements; nothing
 * here can forecast a share price, and the only way to extend the line would be
 * to hold the portfolio flat — a claim about the market dressed up as
 * arithmetic. It stops where the facts do, and the caption says so.
 */
export function NetWorthHero({
  worth,
  labels,
  granularity,
  onGranularityChange,
  hasTransactions,
}: {
  worth: CombinedWorth;
  labels: readonly string[];
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  hasTransactions: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const locale = intlLocale();

  return (
    <>
      <Amount value={worth.current} tone="neutral" size="display" />
      <Text style={[type.caption, { color: theme.textMuted }]}>{t('dashboard.asOfTodayAll')}</Text>

      <View style={[styles.split, { backgroundColor: theme.surfaceSunken }]}>
        <Part label={t('dashboard.cashPart')} value={formatMoney(worth.cashCurrent, locale)} />
        <View style={[styles.rule, { backgroundColor: theme.border }]} />
        <Part
          label={t('dashboard.portfolioPart')}
          value={formatMoney(worth.portfolioCurrent, locale)}
        />
      </View>

      {worth.points.length > 1 ? (
        <View style={styles.bleed}>
          <BalanceChart points={worth.points} labels={labels} />
        </View>
      ) : null}

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

      <Text style={[type.caption, { color: theme.textMuted }]}>{t('dashboard.netWorthHint')}</Text>
    </>
  );
}

function Part({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.part}>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.heading, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  split: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  part: { flex: 1, gap: 2 },
  rule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginHorizontal: spacing.md },
  bleed: { marginHorizontal: -spacing.lg },
});
