import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, type, useTheme } from '../../design';

/** A small uppercase label over a group of rows, with room for one action. */
export function SectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <Text style={[type.caption, styles.label, { color: theme.textMuted }]}>{label}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  label: { textTransform: 'uppercase' },
});
