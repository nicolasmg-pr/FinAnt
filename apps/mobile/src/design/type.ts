import type { TextStyle } from 'react-native';

export type TypeRole = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';

/**
 * Six roles, each fixing size, weight, line height and tracking. Screens must
 * not write a `fontSize` literal: the sizes were scattered as 30/24/17/16/14/
 * 13/12/9 across every file, which is the main reason the app read templated.
 *
 * System face on both platforms (SF Pro, Roboto). No bundled font.
 */
export const type: Record<TypeRole, TextStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400', letterSpacing: 0 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0 },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '500', letterSpacing: 0.3 },
};

/** Same roles with figures locked to one width, so a column of amounts lines
 * up and a changing total does not jitter. */
export const typeMoney: Record<TypeRole, TextStyle> = Object.fromEntries(
  Object.entries(type).map(([role, style]) => [
    role,
    { ...style, fontVariant: ['tabular-nums'] satisfies TextStyle['fontVariant'] },
  ]),
) as Record<TypeRole, TextStyle>;

/**
 * A row that cannot grow taller caps how far the OS text-size setting scales
 * it, rather than clipping. Anything that can absorb the growth passes no cap.
 */
export const MAX_FONT_SCALE = 1.4;
