import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  decimalToNumber,
  formatDecimal,
  formatMoney,
  monthOf,
  yearOf,
  type AssetClass,
  type NetWorthPoint,
  type Portfolio,
  type Position,
  type ValuePoint,
} from '@finant/core';
import { intlLocale } from '../i18n';
import { radius, spacing, type, useTheme } from '../design';
import { Amount } from './Amount';
import { BalanceChart } from './BalanceChart';
import { Card } from './Card';
import { Button } from './ui/Button';
import { Touchable } from './ui/Touchable';

/**
 * What the owner holds, under the cash that bought it.
 *
 * Every figure here is derived and none of it is live: the timestamp under the
 * total is not decoration, it is the difference between a valuation and a
 * guess. A holding with no usable price shows its cost and says so rather than
 * being quietly counted at zero, which would understate the total — the one
 * direction a money figure must not err.
 */
export function PortfolioSection({
  portfolio,
  series,
  refreshing,
  offline,
  onRefresh,
}: {
  portfolio: Portfolio;
  series: readonly ValuePoint[];
  refreshing: boolean;
  offline: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const locale = intlLocale();

  const asOf = useMemo(() => {
    if (!portfolio.quotedAsOf) return t('portfolio.never');
    return t('portfolio.asOf', {
      time: new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(portfolio.quotedAsOf)),
    });
  }, [portfolio.quotedAsOf, locale, t]);

  if (portfolio.holdings.length === 0 && portfolio.closed.length === 0) return null;

  const gainTone = portfolio.totalUnrealised.minor < 0 ? 'expense' : 'income';

  return (
    <Card title={t('portfolio.title')}>
      <View style={styles.totals}>
        <Amount value={portfolio.totalValue} size="display" tone="neutral" fit />
        <Text style={[type.caption, { color: theme.textMuted }]}>{asOf}</Text>
      </View>

      <View style={styles.figures}>
        <Figure label={t('portfolio.invested')} value={formatMoney(portfolio.totalCost, locale)} />
        <Figure
          label={t('portfolio.unrealised')}
          value={formatMoney(portfolio.totalUnrealised, locale)}
          tone={gainTone}
          suffix={
            portfolio.returnPct === null
              ? undefined
              : `${portfolio.returnPct >= 0 ? '+' : ''}${portfolio.returnPct.toFixed(1)}%`
          }
        />
        {portfolio.totalRealised.minor !== 0 ? (
          <Figure
            label={t('portfolio.realised')}
            value={formatMoney(portfolio.totalRealised, locale)}
            tone={portfolio.totalRealised.minor < 0 ? 'expense' : 'income'}
          />
        ) : null}
        {portfolio.totalDividends.minor !== 0 ? (
          <Figure
            label={t('portfolio.dividends')}
            value={formatMoney(portfolio.totalDividends, locale)}
          />
        ) : null}
      </View>

      <ValueLine series={series} locale={locale} />

      {portfolio.byAssetClass.length > 1 ? <Allocation portfolio={portfolio} /> : null}

      <View style={styles.list}>
        {portfolio.holdings.map((holding) => (
          <HoldingRow
            key={holding.asset.id}
            position={holding}
            onPress={() =>
              router.push({
                pathname: '/portfolio/[assetId]',
                params: { assetId: holding.asset.id },
              })
            }
          />
        ))}
      </View>

      {portfolio.assetsUnquoted > 0 ? (
        <Note>{t('portfolio.unpriced', { count: portfolio.assetsUnquoted })}</Note>
      ) : null}
      {offline ? <Note>{t('portfolio.offline')}</Note> : null}

      <View style={styles.actions}>
        <Button
          label={refreshing ? t('portfolio.refreshing') : t('portfolio.refresh')}
          variant="secondary"
          onPress={onRefresh}
          disabled={refreshing}
        />
        {refreshing ? <ActivityIndicator color={theme.accent} /> : null}
      </View>
      <Text style={[type.caption, styles.privacy, { color: theme.textMuted }]}>
        {t('portfolio.privacy')}
      </Text>
    </Card>
  );
}

function Figure({
  label,
  value,
  tone,
  suffix,
}: {
  label: string;
  value: string;
  tone?: 'income' | 'expense';
  suffix?: string;
}) {
  const theme = useTheme();
  const color = tone === 'income' ? theme.income : tone === 'expense' ? theme.expense : theme.text;
  return (
    <View style={styles.figure}>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.heading, { color }]} numberOfLines={1}>
        {value}
        {suffix ? ` ${suffix}` : ''}
      </Text>
    </View>
  );
}

/**
 * The portfolio's worth month by month, drawn with the same chart the net-worth
 * line uses — it is the same kind of statement about the same kind of figure,
 * and a second chart style would imply a difference that is not there.
 *
 * Two months is the floor: a single point is not a line, and drawing one
 * suggests a history that does not exist yet.
 */
function ValueLine({ series, locale }: { series: readonly ValuePoint[]; locale: string }) {
  const points: NetWorthPoint[] = series.map((point) => ({
    period: point.period,
    kind: point.kind,
    total: point.total,
  }));
  if (points.length < 2) return null;

  // Thinned to roughly six labels: a month name every gridline is unreadable at
  // phone width, and the shape of the line is what is being read here.
  const step = Math.max(1, Math.ceil(points.length / 6));
  const labels = series.map((point, i) =>
    i % step === 0
      ? new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(
          new Date(Date.UTC(yearOf(point.period), monthOf(point.period) - 1, 1)),
        )
      : '',
  );

  return (
    <View style={styles.chart}>
      <BalanceChart points={points} labels={labels} />
    </View>
  );
}

/** A single bar rather than a pie: three or four slices read better as widths. */
function Allocation({ portfolio }: { portfolio: Portfolio }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const colors: Record<AssetClass, string> = {
    fund: theme.accent,
    stock: theme.grain,
    crypto: theme.warning,
  };

  return (
    <View style={styles.allocation}>
      <Text style={[type.caption, { color: theme.textMuted }]}>{t('portfolio.byClass')}</Text>
      <View style={[styles.bar, { backgroundColor: theme.surfaceSunken }]}>
        {portfolio.byAssetClass.map((slice) => (
          <View
            key={slice.assetClass}
            style={{
              flex: Math.max(slice.share, 0.001),
              backgroundColor: colors[slice.assetClass],
            }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {portfolio.byAssetClass.map((slice) => (
          <View key={slice.assetClass} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors[slice.assetClass] }]} />
            <Text style={[type.caption, { color: theme.textMuted }]}>
              {t(`portfolio.assetClass.${slice.assetClass}`)} {Math.round(slice.share * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function HoldingRow({ position, onPress }: { position: Position; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = intlLocale();

  return (
    <Touchable onPress={onPress}>
      <View style={[styles.row, { borderBottomColor: theme.border }]}>
        <View style={styles.rowMain}>
          <Text style={[type.body, { color: theme.text }]} numberOfLines={1}>
            {position.asset.name}
          </Text>
          <Text style={[type.caption, { color: theme.textMuted }]} numberOfLines={1}>
            {t('portfolio.shares', { count: formatDecimal(position.shares, locale, 6) })}
            {position.averageCost
              ? ` · ${t('portfolio.avgCost', {
                  amount: formatPrice(position.averageCost, position.asset.currency, locale),
                })}`
              : ''}
          </Text>
        </View>
        <View style={styles.rowFigures}>
          {position.marketValue ? (
            <>
              <Amount value={position.marketValue} tone="neutral" fit />
              {position.unrealised ? (
                <Text
                  style={[
                    type.caption,
                    { color: position.unrealised.minor < 0 ? theme.expense : theme.income },
                  ]}
                >
                  {position.unrealised.minor >= 0 ? '+' : ''}
                  {formatMoney(position.unrealised, locale)}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Amount value={position.costBasis} tone="neutral" fit />
              <Text style={[type.caption, { color: theme.textMuted }]}>{t('portfolio.never')}</Text>
            </>
          )}
        </View>
      </View>
    </Touchable>
  );
}

/** A per-share price, which is a decimal at price scale rather than a Money. */
export function formatPrice(
  price: { scaled: number; scale: number },
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    decimalToNumber(price),
  );
}

function Note({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: theme.warningSoft }]}>
      <Text style={[type.caption, { color: theme.text }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { marginTop: spacing.sm, gap: 2 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  figure: { minWidth: 92 },
  allocation: { marginTop: spacing.md, gap: spacing.xs },
  bar: { flexDirection: 'row', height: 8, borderRadius: radius.sm, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chart: { marginTop: spacing.md },
  list: { marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, gap: 2 },
  rowFigures: { alignItems: 'flex-end', gap: 2 },
  note: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  privacy: { marginTop: spacing.xs },
});
