import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, useTheme } from '../theme';

export function Card({ title, subtitle, children }: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {title ? <Text style={[styles.title, { color: theme.text }]}>{title}</Text> : null}
      {subtitle ? <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 13 },
});
