import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, type, useTheme } from '../../design';
import { Touchable } from './Touchable';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/**
 * Replaces four separate `addButton` implementations plus the bare
 * Pressable+Text actions that were scattered through settings, import and
 * transaction detail.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  onPress,
}: {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  icon?: keyof typeof Feather.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  const background =
    variant === 'primary'
      ? theme.accent
      : variant === 'secondary'
        ? theme.accentSoft
        : 'transparent';
  const foreground =
    variant === 'primary' ? theme.onAccent : variant === 'danger' ? theme.expense : theme.accent;

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        styles.button,
        size === 'lg' ? styles.lg : styles.md,
        { backgroundColor: background },
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={foreground} size="small" />
        ) : (
          <>
            {icon ? <Feather name={icon} size={16} color={foreground} /> : null}
            <Text style={[type.heading, { color: foreground }]}>{label}</Text>
          </>
        )}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  md: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  lg: { paddingVertical: spacing.lg, paddingHorizontal: spacing.xl },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
