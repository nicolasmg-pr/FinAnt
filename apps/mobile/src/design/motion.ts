import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Easing, type EasingFunction, type WithSpringConfig } from 'react-native-reanimated';

export type Motion = {
  instant: number;
  quick: number;
  settle: number;
  pressScale: number;
  easeOut: EasingFunction;
  spring: WithSpringConfig;
  enabled: boolean;
};

const full: Motion = {
  instant: 120,
  quick: 200,
  settle: 320,
  pressScale: 0.97,
  easeOut: Easing.out(Easing.cubic),
  spring: { damping: 22, stiffness: 260, mass: 0.9 },
  enabled: true,
};

const still: Motion = {
  ...full,
  instant: 0,
  quick: 0,
  settle: 0,
  pressScale: 1,
  spring: { damping: 100, stiffness: 1000, mass: 0.1 },
  enabled: false,
};

/**
 * Returns the motion tokens already flattened when the owner has asked the OS
 * for less motion, so no caller writes a conditional of its own and no
 * animation can escape the setting by being added later.
 */
export function useMotion(): Motion {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);

  return reduced ? still : full;
}
