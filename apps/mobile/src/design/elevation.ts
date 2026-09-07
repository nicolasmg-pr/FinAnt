import { Platform, useColorScheme, type ViewStyle } from 'react-native';
import { darkPalette, lightPalette } from './palette';

export type ElevationLevel = 0 | 1 | 2 | 3;

const shadows: Record<ElevationLevel, ViewStyle> = {
  0: {},
  1: {
    shadowColor: lightPalette.text,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  2: {
    shadowColor: lightPalette.text,
    shadowOpacity: 0.09,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  3: {
    shadowColor: lightPalette.text,
    shadowOpacity: 0.16,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
};

/** Dark theme lifts the surface instead of casting a shadow. */
const darkSurfaces: Record<ElevationLevel, string> = {
  0: darkPalette.background,
  1: darkPalette.surface,
  2: darkPalette.surfaceRaised,
  3: darkPalette.surfaceRaised,
};

/**
 * `useElevation(2)` means the same thing to a caller in either theme: this
 * thing sits above the thing behind it. How that is drawn differs, because a
 * shadow is invisible on a near-black ground.
 *
 * Android composites a shadow per view, so this never goes on a list row —
 * depth there comes from the card containing the rows.
 */
export function useElevation(level: ElevationLevel): ViewStyle {
  const dark = useColorScheme() === 'dark';
  if (dark) return { backgroundColor: darkSurfaces[level] };
  const shadow = shadows[level];
  // Android's `elevation` needs an opaque background or it draws nothing.
  return Platform.OS === 'android' && level > 0
    ? { ...shadow, backgroundColor: lightPalette.surface }
    : shadow;
}
