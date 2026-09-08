import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MAX_FONT_SCALE, spacing, type, useTheme } from '../../design';
import { Touchable } from './Touchable';

/**
 * The one row shape: transaction, recurring series, exclusion rule, account,
 * budget, settings entry, category. No shadow of its own — Android composites
 * a shadow per view and a list of them is expensive; depth comes from the card
 * around the rows.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  divider = false,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  divider?: boolean;
}) {
  const theme = useTheme();

  const body = (
    <View
      style={[
        styles.row,
        divider
          ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }
          : null,
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.labels}>
        <Text
          style={[type.body, { color: theme.text }]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[type.caption, { color: theme.textMuted }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );

  return onPress ? (
    <Touchable onPress={onPress} accessibilityRole="button">
      {body}
    </Touchable>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  leading: { width: 24, alignItems: 'center' },
  labels: { flex: 1, gap: 2 },
  trailing: { alignItems: 'flex-end' },
});
