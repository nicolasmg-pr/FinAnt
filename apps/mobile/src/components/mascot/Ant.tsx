import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { STROKE, mascot, useTheme, type Part, type Pose, type Role } from '../../design';
import type { Palette } from '../../design';

/**
 * The ant, rendered from `design/mascot.ts`. This file holds no geometry: it
 * maps parts onto react-native-svg and resolves colour roles against the live
 * theme, so the in-app ant cannot drift from the launcher icon.
 *
 * `variant` exists for the ask bubble, which is a circle filled with `accent`.
 * An ant whose body role also resolved to `accent` would be invisible on it, so
 * `onAccent` inks the outline in `onAccent` and leaves the fills `accent`,
 * giving an outlined ant. The face lines are ink, so the face survives.
 */
export type AntVariant = 'theme' | 'onAccent';

function palettes(theme: Palette, variant: AntVariant): Record<Role, string> {
  if (variant === 'onAccent') {
    return {
      ink: theme.onAccent,
      body: theme.accent,
      grain: theme.accent,
      grainSoft: theme.accent,
    };
  }
  return { ink: theme.text, body: theme.accent, grain: theme.grain, grainSoft: theme.grainSoft };
}

export function Ant({
  pose,
  size,
  frame = 0,
  variant = 'theme',
}: {
  pose: Pose;
  size: number;
  frame?: number;
  variant?: AntVariant;
}) {
  const theme = useTheme();
  const colours = palettes(theme, variant);
  const { parts, viewBox, transform } = mascot(pose, frame);

  // This component applies strokeLinecap and strokeLinejoin unconditionally.
  // The icon serialiser in scripts/mascot-svg.ts applies them conditionally to work
  // around a resvg tessellation quirk at 48px. react-native-svg is a different
  // renderer with no such quirk, and round caps and joins are what the drawing wants.
  const paint = (part: Part) => ({
    fill: part.fill ? colours[part.fill] : 'none',
    stroke: part.stroke ? colours[part.stroke] : undefined,
    strokeWidth: part.stroke ? (part.width ?? STROKE) : undefined,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  });

  return (
    <Svg
      width={size}
      height={size}
      viewBox={viewBox}
      // Decorative on every surface: the text beside it carries the meaning.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <G transform={transform}>
        {parts.map((part) => {
          const common = { key: part.id, ...paint(part) };
          const element =
            part.kind === 'path' ? (
              <Path {...common} d={part.d} />
            ) : part.kind === 'circle' ? (
              <Circle {...common} cx={part.cx} cy={part.cy} r={part.r} />
            ) : (
              <Ellipse {...common} cx={part.cx} cy={part.cy} rx={part.rx} ry={part.ry} />
            );
          return part.transform ? (
            <G key={`${part.id}-t`} transform={part.transform}>
              {element}
            </G>
          ) : (
            element
          );
        })}
      </G>
    </Svg>
  );
}
