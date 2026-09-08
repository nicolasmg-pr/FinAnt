import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MAX_FONT_SCALE, radius, spacing, type, useTheme } from '../../design';

export type StatTone = 'income' | 'expense' | 'neutral';

/**
 * A labelled figure on a tone-tinted ground. The three period figures used to
 * be bare text in a row, which left income, expenses and net reading as three
 * unrelated numbers instead of one comparison.
 */
export function StatTile({
  label,
  tone,
  children,
}: {
  label: string;
  tone: StatTone;
  children: ReactNode;
}) {
  const theme = useTheme();
  const background =
    tone === 'income'
      ? theme.incomeSoft
      : tone === 'expense'
        ? theme.expenseSoft
        : theme.surfaceAlt;

  return (
    <View style={[styles.tile, { backgroundColor: background }]}>
      <Text
        style={[type.caption, { color: theme.textMuted }]}
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
  },
});
