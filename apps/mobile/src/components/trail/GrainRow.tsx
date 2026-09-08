import { StyleSheet, View } from 'react-native';
import { spacing, useTheme } from '../../design';
import { Trail } from './Trail';

/** Past this a row of dots is a texture, not a count. */
const MAX_DOTS = 12;
const SIZE = 8;

/**
 * A countable row: one grain per unit, filled for carried and hollow for not.
 * Above twelve units it hands over to `Trail`, because nobody counts thirteen
 * dots on a phone.
 */
export function GrainRow({
  total,
  filled,
  label,
}: {
  total: number;
  filled: number;
  label?: string;
}) {
  const theme = useTheme();
  const units = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const carried = Number.isFinite(filled) ? Math.min(units, Math.max(0, Math.floor(filled))) : 0;

  if (units > MAX_DOTS) {
    return <Trail parts={[{ ratio: carried / units, tone: 'grain' }]} label={label} />;
  }

  return (
    <View
      style={styles.row}
      accessible={label !== undefined}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
    >
      {Array.from({ length: units }, (_, index) => (
        <View
          key={index}
          style={[
            styles.grain,
            index < carried
              ? { backgroundColor: theme.grain }
              : { backgroundColor: theme.grainSoft, borderWidth: 1, borderColor: theme.border },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  grain: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
});
