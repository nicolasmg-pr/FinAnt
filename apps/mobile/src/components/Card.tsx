import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, type, useElevation, useTheme } from '../design';
import { Touchable } from './ui/Touchable';

/**
 * The surface everything sits on. No border any more: separation comes from
 * elevation, which is what makes the soft-depth look work. `padded={false}`
 * is for a card whose child is a full-bleed chart or list.
 */
export function Card({
  title,
  subtitle,
  padded = true,
  onPress,
  children,
}: {
  title?: string;
  subtitle?: string;
  padded?: boolean;
  onPress?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const elevation = useElevation(1);

  const body = (
    <>
      {title ? <Text style={[type.heading, { color: theme.text }]}>{title}</Text> : null}
      {subtitle ? <Text style={[type.label, { color: theme.textMuted }]}>{subtitle}</Text> : null}
      {children}
    </>
  );

  const style = [
    styles.card,
    padded ? styles.padded : null,
    { backgroundColor: theme.surface },
    elevation,
  ];

  // A pressable card gets its feedback from Touchable rather than from a bare
  // Pressable wrapped around it, which is what banks and budgets did and which
  // gave no feedback at all.
  return onPress ? (
    <Touchable onPress={onPress} accessibilityRole="button" style={style}>
      {body}
    </Touchable>
  ) : (
    <View style={style}>{body}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  padded: { padding: spacing.lg },
});
