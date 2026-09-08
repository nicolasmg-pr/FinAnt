import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CategoryTotal } from '@finant/core';
import { Amount } from './Amount';
import { useCategories } from '../hooks/use-categories';
import { radius, rampColorFor, spacing, type, useTheme } from '../design';

/**
 * Ranked spending per category as proportional bars. A pie chart of 20 slices
 * is unreadable at phone width; a sorted bar list answers "where did it go"
 * in one glance and stays legible at any count.
 */
export function CategoryBreakdown({
  totals,
  limit = 6,
}: {
  totals: readonly CategoryTotal[];
  limit?: number;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { byId } = useCategories();

  return (
    <View style={{ gap: spacing.md }}>
      {totals.slice(0, limit).map((entry) => {
        const category = byId.get(entry.categoryId);
        const label = category?.labelKey
          ? t(category.labelKey)
          : (category?.name ?? entry.categoryId);
        // A category that cannot be resolved still gets a stable colour of its
        // own, rather than borrowing the accent and looking like every other
        // unresolved row.
        const color = category?.color ?? rampColorFor(entry.categoryId);
        return (
          <View key={entry.categoryId} style={{ gap: spacing.xs }}>
            <View style={styles.row}>
              <Text style={[type.body, styles.label, { color: theme.text }]} numberOfLines={1}>
                {label}
              </Text>
              <Amount value={entry.total} tone="neutral" size="label" />
            </View>
            <View style={[styles.track, { backgroundColor: theme.surfaceSunken }]}>
              <View
                style={[
                  styles.fill,
                  { backgroundColor: color, width: `${Math.max(2, entry.share * 100)}%` },
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  label: { flexShrink: 1 },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
});
