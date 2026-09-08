import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { BudgetState } from '@finant/core';
import { radius, segmentsFor, useMotion, useTheme, type Palette } from '../../design';

/** One run of the same colour along a shared track. */
export interface TrailPart {
  readonly ratio: number;
  readonly tone: keyof Palette;
  /** Overrides the tone, for a colour the owner chose themselves. */
  readonly color?: string;
}

const HEIGHT = 10;

/**
 * A bar made of grains. The parts share one grain grid computed from the whole
 * track, so the boundary between two of them falls on a gap rather than
 * splitting a grain in half.
 *
 * `state: 'over'` caps the fill at the track and marks the end, rather than
 * letting the bar grow past its own track: a full bar has to keep meaning
 * "nothing left", and the caption underneath carries the excess.
 *
 * Without a `label` the bar is hidden from screen readers on purpose. Every
 * placement of it sits under a caption that already states the figure, and
 * hearing the same number twice is worse than hearing it once.
 */
export function Trail({
  parts,
  state = 'under',
  label,
}: {
  parts: readonly TrailPart[];
  state?: BudgetState;
  label?: string;
}) {
  const theme = useTheme();
  const motion = useMotion();
  const [width, setWidth] = useState(0);

  const grow = useSharedValue(motion.enabled ? 0 : 1);
  useEffect(() => {
    grow.value = motion.enabled ? withTiming(1, { duration: motion.settle }) : 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion.enabled]);

  const reveal = useAnimatedStyle(() => ({ width: width * grow.value }));

  const geometry = segmentsFor(
    width,
    parts.map((part) => part.ratio),
  );

  const carried = parts.reduce(
    (sum, part) => sum + (Number.isFinite(part.ratio) ? Math.min(1, Math.max(0, part.ratio)) : 0),
    0,
  );

  const reader = label
    ? {
        accessible: true,
        accessibilityRole: 'progressbar' as const,
        accessibilityLabel: label,
        accessibilityValue: { min: 0, max: 100, now: Math.round(Math.min(1, carried) * 100) },
      }
    : { accessible: false };

  return (
    <View
      {...reader}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: theme.surfaceSunken }]}
    >
      <Animated.View style={[styles.fill, reveal]}>
        {parts.map((part, index) => {
          const color = part.color ?? theme[part.tone];

          if (geometry.mode === 'continuous') {
            const runWidth = geometry.widths[index] ?? 0;
            return runWidth > 0 ? (
              <View
                key={`run-${index}`}
                style={[styles.run, { width: runWidth, backgroundColor: color }]}
              />
            ) : null;
          }

          return Array.from({ length: geometry.filled[index] ?? 0 }, (_, grain) => (
            <View
              key={`grain-${index}-${grain}`}
              style={[
                styles.grain,
                { width: geometry.size, marginRight: geometry.gap, backgroundColor: color },
              ]}
            />
          ));
        })}
      </Animated.View>
      {state === 'over' ? (
        <View style={[styles.break, { backgroundColor: theme.expenseSoft }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: HEIGHT, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, flexDirection: 'row' },
  run: { height: HEIGHT, borderRadius: radius.pill },
  grain: { height: HEIGHT, borderRadius: radius.pill },
  break: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 3 },
});
