import { StyleSheet, Text, View } from 'react-native';
import type { Category } from '@finant/core';
import { radius, spacing, type, useTheme } from '../design';
import { Touchable } from './ui/Touchable';

/**
 * One selectable category pill: colour dot plus label. Selection is a tint of
 * the category's own colour rather than an outline, so the dot and the fill
 * say the same thing.
 */
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
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        { backgroundColor: selected ? theme.accentSoft : theme.surfaceAlt },
        selected ? { borderColor: category.color } : null,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: category.color }]} />
      <Text style={[type.label, { color: theme.text }]}>{label}</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
});
