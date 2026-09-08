import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotion } from '../../design';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The one place press feedback is defined. Everything tappable composes this,
 * so the feel cannot drift between a chip, a card and a button — which is
 * exactly what happened when each screen wrote its own Pressable.
 *
 * Scale only, no opacity change: a dimming amount reads as disabled.
 */
export function Touchable({
  children,
  style,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const motion = useMotion();
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      hitSlop={rest.hitSlop ?? 8}
      onPressIn={(event) => {
        scale.value = withTiming(motion.pressScale, { duration: motion.instant });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withTiming(1, { duration: motion.instant });
        onPressOut?.(event);
      }}
      style={[style, animated, disabled ? { opacity: 0.4 } : null]}
    >
      {children}
    </AnimatedPressable>
  );
}
