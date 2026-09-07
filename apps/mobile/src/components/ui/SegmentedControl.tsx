import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import {
  MAX_FONT_SCALE,
  radius,
  spacing,
  type,
  useElevation,
  useIsDark,
  useMotion,
  useTheme,
} from '../../design';

const PADDING = 3;

/**
 * A two-or-three way switch. Replaces the pairs of chips that were standing in
 * for one — and, on the year card, a tap-the-whole-card toggle whose only
 * affordance was a hint line underneath it.
 *
 * Generic over the option value so callers keep their own unions rather than
 * widening to string.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  const motion = useMotion();
  const elevation = useElevation(1);
  const dark = useIsDark();
  // Dark theme raises by lightness, so the thumb has to sit above the trough
  // rather than take the plain surface, which is darker than surfaceAlt.
  const thumbColor = dark ? theme.surfaceRaised : theme.surface;
  const [width, setWidth] = useState(0);

  const segment = options.length > 0 ? (width - PADDING * 2) / options.length : 0;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const thumb = useAnimatedStyle(() => ({
    width: segment,
    transform: [{ translateX: withSpring(segment * index, motion.spring) }],
  }));

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.trough, { backgroundColor: theme.surfaceSunken }]}
    >
      {width > 0 ? (
        <Animated.View
          style={[styles.thumb, elevation, { backgroundColor: thumbColor }, thumb]}
          pointerEvents="none"
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={styles.segment}
          >
            <Text
              style={[type.label, { color: selected ? theme.text : theme.textMuted }]}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  trough: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: PADDING,
  },
  thumb: {
    position: 'absolute',
    top: PADDING,
    left: PADDING,
    bottom: PADDING,
    borderRadius: radius.pill,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
});
