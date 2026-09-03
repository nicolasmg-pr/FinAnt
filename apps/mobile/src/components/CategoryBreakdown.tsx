import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CategoryTotal } from '@finant/core';
import { Amount } from './Amount';
import { useCategories } from '../hooks/use-categories';
import { radius, spacing, useTheme } from '../theme';

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
        return (
          <View key={entry.categoryId} style={{ gap: spacing.xs }}>
            <View style={styles.row}>
              <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>
                {label}
              </Text>
              <Amount value={entry.total} tone="neutral" style={styles.value} />
            </View>
            <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: category?.color ?? theme.accent,
                    width: `${Math.max(2, entry.share * 100)}%`,
                  },
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
  label: { fontSize: 14, flexShrink: 1 },
  value: { fontSize: 14, fontWeight: '600' },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
});
