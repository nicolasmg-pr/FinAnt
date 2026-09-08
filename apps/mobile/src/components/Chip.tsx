import { StyleSheet, Text } from 'react-native';
import { radius, spacing, type, useTheme } from '../design';
import { Touchable } from './ui/Touchable';

/** A selectable pill: filled with the soft accent when chosen, so selection
 * reads at a glance instead of hinging on a hairline border colour. */
export function Chip({
  label,
  selected,
  onPress,
}: {
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
      style={[styles.chip, { backgroundColor: selected ? theme.accentSoft : theme.surfaceAlt }]}
    >
      <Text style={[type.label, { color: selected ? theme.accent : theme.text }]}>{label}</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
});
