import { useColorScheme } from 'react-native';

/**
 * A restrained palette: one accent, a ledger-green for income and a clear red
 * for expense. Financial figures are the only thing on screen that should
 * carry colour, so everything else stays neutral.
 */
const light = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F5',
  border: '#E1E5EB',
  text: '#0F172A',
  textMuted: '#64748B',
  accent: '#2563EB',
  income: '#15803D',
  expense: '#B91C1C',
  warning: '#B45309',
} as const;

const dark: Palette = {
  background: '#0B1120',
  surface: '#151C2C',
  surfaceAlt: '#1E2739',
  border: '#2A3347',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  accent: '#60A5FA',
  income: '#4ADE80',
  expense: '#F87171',
  warning: '#FBBF24',
};

/** Both palettes share the same keys; values are plain strings so the dark
 * palette is assignable to the same type. */
export type Palette = Record<keyof typeof light, string>;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
