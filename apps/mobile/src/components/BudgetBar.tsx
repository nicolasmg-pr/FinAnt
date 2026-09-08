import { StyleSheet, View } from 'react-native';
import type { BudgetState } from '@finant/core';
import { radius, useTheme } from '../design';

/**
 * A limit bar, not a share bar: the track is the monthly limit, so a full bar
 * always means "nothing left" regardless of the amounts involved. Colour comes
 * from the state the domain assigned, so the bar and the caption can never
 * disagree about whether a budget is in trouble.
 */
export function BudgetBar({
  ratio,
  state,
  color,
}: {
  ratio: number;
  state: BudgetState;
  color?: string;
}) {
  const theme = useTheme();
  const fill =
    state === 'over' ? theme.expense : state === 'near' ? theme.warning : (color ?? theme.accent);
  // An overspent budget cannot draw past its track; the cap at the end says so
  // without the bar having to lie about its own width, and the caption carries
  // the excess.
  const width = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1;

  return (
    <View style={[styles.track, { backgroundColor: theme.surfaceSunken }]}>
      <View
        style={[styles.fill, { backgroundColor: fill, width: `${Math.max(2, width * 100)}%` }]}
      />
      {state === 'over' ? (
        <View style={[styles.overflow, { backgroundColor: theme.expenseSoft }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden', flexDirection: 'row' },
  fill: { height: 10, borderRadius: radius.pill },
  overflow: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 3 },
});
