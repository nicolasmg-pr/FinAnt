import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PRICE_SCALE, formatDecimal, formatMoney, parseDecimalAt } from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { Card } from '../../src/components/Card';
import { FormSheet } from '../../src/components/FormSheet';
import { formatPrice } from '../../src/components/PortfolioSection';
import { Button } from '../../src/components/ui/Button';
import { Empty } from '../../src/components/ui/Empty';
import { renameAsset, setManualPrice } from '../../src/db/investments-repo';
import { usePortfolio } from '../../src/hooks/use-portfolio';
import { intlLocale } from '../../src/i18n';
import { spacing, type, useTheme } from '../../src/design';

/**
 * One holding in full: what it cost, what it is worth, and what it has paid
 * out. The two things the owner can change live here rather than on the list —
 * its name, and a price typed by hand when no provider can price it.
 */
export default function AssetDetailScreen() {
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = intlLocale();
  const { portfolio, loading, reload } = usePortfolio();

  const [editing, setEditing] = useState<'name' | 'price' | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const position = useMemo(
    () => [...portfolio.holdings, ...portfolio.closed].find((p) => p.asset.id === assetId) ?? null,
    [portfolio, assetId],
  );

  const save = useCallback(async () => {
    if (!position) return;
    if (editing === 'name') {
      if (draft.trim().length === 0) {
        setError(t('common.required'));
        return;
      }
      await renameAsset(position.asset.id, draft);
    } else if (editing === 'price') {
      const trimmed = draft.trim();
      // Clearing is a blank field, which is why this is not a validation error.
      const price = trimmed === '' ? null : parseDecimalAt(trimmed, PRICE_SCALE);
      if (trimmed !== '' && !price) {
        setError(t('common.invalidAmount'));
        return;
      }
      await setManualPrice(position.asset.id, price);
    }
    setEditing(null);
    setError(null);
    await reload();
  }, [position, editing, draft, reload, t]);

  if (loading) return null;
  if (!position) {
    return (
      <>
        <Stack.Screen options={{ title: t('portfolio.title') }} />
        <Empty message={t('portfolio.empty')} />
      </>
    );
  }

  const { asset } = position;

  return (
    <>
      <Stack.Screen options={{ title: asset.name }} />
      <ScrollView contentContainerStyle={styles.page}>
        <Card>
          <View style={styles.hero}>
            <Amount
              value={position.marketValue ?? position.costBasis}
              size="display"
              tone="neutral"
              fit
            />
            <Text style={[type.caption, { color: theme.textMuted }]}>
              {position.marketValue ? t('portfolio.value') : t('portfolio.invested')}
              {' · '}
              {asset.symbol}
            </Text>
          </View>

          <Row label={t('portfolio.holdings')} value={formatDecimal(position.shares, locale, 8)} />
          {position.averageCost ? (
            <Row
              label={t('portfolio.avgCost', { amount: '' }).trim()}
              value={formatPrice(position.averageCost, asset.currency, locale)}
            />
          ) : null}
          {position.quote ? (
            <Row
              label={
                position.quote.source === 'manual'
                  ? t('portfolio.manualPrice')
                  : t('portfolio.price', { amount: '' }).trim()
              }
              value={formatPrice(position.quote.price, asset.currency, locale)}
            />
          ) : null}
          <Row label={t('portfolio.invested')} value={formatMoney(position.costBasis, locale)} />
          {position.unrealised ? (
            <Row
              label={t('portfolio.unrealised')}
              value={formatMoney(position.unrealised, locale)}
              tone={position.unrealised.minor < 0 ? 'expense' : 'income'}
            />
          ) : null}
          {position.realised.minor !== 0 ? (
            <Row
              label={t('portfolio.realised')}
              value={formatMoney(position.realised, locale)}
              tone={position.realised.minor < 0 ? 'expense' : 'income'}
            />
          ) : null}
          {position.dividends.minor !== 0 ? (
            <Row label={t('portfolio.dividends')} value={formatMoney(position.dividends, locale)} />
          ) : null}
          {position.benefits.minor !== 0 ? (
            <Row label={t('portfolio.benefits')} value={formatMoney(position.benefits, locale)} />
          ) : null}
          {position.fees.minor !== 0 ? (
            <Row label={t('portfolio.fees')} value={formatMoney(position.fees, locale)} />
          ) : null}

          {position.oversold ? (
            <View style={[styles.note, { backgroundColor: theme.warningSoft }]}>
              <Text style={[type.caption, { color: theme.text }]}>{t('portfolio.oversold')}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={t('portfolio.rename')}
              variant="secondary"
              onPress={() => {
                setDraft(asset.name);
                setEditing('name');
              }}
            />
            {/* Clearing is one tap: the form would offer an empty field whose
                only meaningful value is the emptiness it already has. */}
            {asset.manualPrice ? (
              <Button
                label={t('portfolio.clearManualPrice')}
                variant="secondary"
                onPress={() => {
                  void (async () => {
                    await setManualPrice(asset.id, null);
                    await reload();
                  })();
                }}
              />
            ) : (
              <Button
                label={t('portfolio.setManualPrice')}
                variant="secondary"
                onPress={() => {
                  setDraft('');
                  setEditing('price');
                }}
              />
            )}
          </View>
          <Text style={[type.caption, { color: theme.textMuted }]}>{t('portfolio.priceHint')}</Text>
        </Card>
      </ScrollView>

      <FormSheet
        visible={editing !== null}
        title={editing === 'name' ? t('portfolio.rename') : t('portfolio.setManualPrice')}
        subtitle={editing === 'price' ? t('portfolio.priceHint') : undefined}
        fields={[
          {
            key: editing ?? 'name',
            label: editing === 'name' ? t('portfolio.rename') : t('portfolio.manualPrice'),
            value: draft,
            onChangeText: setDraft,
            numeric: editing === 'price',
            autoCapitalize: editing === 'name' ? 'words' : 'none',
          },
        ]}
        error={error}
        onCancel={() => {
          setEditing(null);
          setError(null);
        }}
        onSave={() => void save()}
      />
    </>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'income' | 'expense';
}) {
  const theme = useTheme();
  const color = tone === 'income' ? theme.income : tone === 'expense' ? theme.expense : theme.text;
  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Text style={[type.body, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.body, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md },
  hero: { marginBottom: spacing.md, gap: 2 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  note: { marginTop: spacing.md, padding: spacing.sm, borderRadius: 8 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
});
