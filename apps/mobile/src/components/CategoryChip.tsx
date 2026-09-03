import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Category } from '@finant/core';
import { radius, spacing, useTheme } from '../theme';

/** One selectable category pill: colour dot plus label, outlined in the category colour when chosen. */
export function CategoryChip({
  category,
  label,
  selected,
  onPress,
}: {
  category: Category;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          borderColor: selected ? category.color : theme.border,
          backgroundColor: selected ? theme.surfaceAlt : 'transparent',
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: category.color }]} />
      <Text style={{ color: theme.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
});
