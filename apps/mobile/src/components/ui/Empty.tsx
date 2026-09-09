import { StyleSheet, Text, View } from 'react-native';
import { spacing, type, useTheme } from '../../design';
import { Ant } from '../mascot/Ant';

/**
 * What a screen shows when it has nothing to show. The ant is in `searching`:
 * empty-handed, because there is nothing yet to carry.
 *
 * The ant is decorative and hidden from the accessibility tree; `message` is
 * what a screen reader gets, and nothing is lost with the drawing removed.
 */
export function Empty({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Ant pose="searching" size={96} />
      <Text style={[type.body, styles.text, { color: theme.textMuted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  text: { textAlign: 'center' },
});
