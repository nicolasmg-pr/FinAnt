import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './palette';

export { categoryRamp, darkPalette, lightPalette, rampColorFor, type Palette } from './palette';
export { radius, spacing } from './spacing';
export { MAX_FONT_SCALE, type, typeMoney, type TypeRole } from './type';
export { useElevation, type ElevationLevel } from './elevation';
export { useMotion, type Motion } from './motion';
export { grainSpacing, segmentsFor, type TrailGeometry } from './trail';

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
