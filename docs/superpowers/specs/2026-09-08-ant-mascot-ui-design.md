# The ant in the interface

The mark drawn for the app icon is a character, not a logotype: a side-profile
ant carrying a euro coin, with a face. This design puts that character inside the
app — on the screens that have nothing to show, on the one slow moment in the
product, on the thing the owner talks to, and in the header — without letting a
second copy of the ant exist anywhere.

## Goal

Four surfaces, each wanting the ant to be doing something different:

| Surface          | What the ant is for                                  |
| ---------------- | ---------------------------------------------------- |
| Empty states     | "there is nothing here yet", on the blankest screens |
| Import           | "work is happening", during the only wait in the app |
| Assistant bubble | a face on the thing you ask questions of             |
| Dashboard header | a small constant presence                            |

One drawing cannot carry all four. A per-surface drawing for each carries them
all and drifts. So: a small pose set built from one shared body.

## Non-goals

- No new copy. Every surface here already has its text in `packages/i18n`, and
  the ant is decorative in all four.
- No celebration, reward or streak mechanics. The ant is not a gamification
  layer over the owner's money.
- No animation outside the import wait. See _Motion_.

## The decision: geometry becomes data

Today `icon-mark.svg` is hand-authored and is, by the icon spec's own rule, the
only place the mark is drawn. That rule exists because two copies drift.

Five poses cannot be five SVG files without breaking exactly that rule, so the
geometry moves up one level: it becomes a typed data module, and both the SVGs
and the React component become outputs of it.

This is the pattern the codebase already uses for geometry. `trail.ts` says so
in its own header — "a plain data module so the geometry can be tested under
node" — and `palette.ts` is the same shape. `vitest.config.ts` already includes
`apps/mobile/src/design/tests/**`, so the module is unit-testable the day it
lands, with no test-infrastructure work.

### Alternatives rejected

**Generate the component from `icon-mark.svg`.** Leaves the icon pipeline alone,
which is attractive so soon after settling it. But an SVG file cannot express
"the same ant without its coin" or "walk frame 2"; poses would become more SVG
files, which is the drift the single-source rule was written to prevent.

**Make the React component the source and generate the SVGs from it.** Poses
become natural, but the icon build then depends on a React file, and the mark can
no longer be rendered or checked without a React runtime. The icon is the one
artefact that must be buildable from plain node.

## `src/design/mascot.ts`

A plain data module. No React import, no Expo import, in keeping with the rest of
`src/design`.

```ts
export type Role = 'ink' | 'body' | 'grain' | 'grainSoft';

export type Part =
  | { kind: 'path'; d: string; fill?: Role; stroke?: Role; width?: number }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill?: Role;
      stroke?: Role;
      width?: number;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotate?: number;
      fill?: Role;
      stroke?: Role;
      width?: number;
    }
  | { kind: 'stroke'; d: string; stroke: Role; width: number };
```

Colour is a **role name, never a hex**. That single choice is what lets one
geometry serve two palettes: the icon generator resolves roles against the fixed
icon palette, and the React component resolves them against the live theme. A
hex in this module would make a dark-mode ant impossible without a second copy.

Parts are named and exported individually — `antennae`, `legsBehind`,
`legsFront`, `coin`, `gaster`, `node1`, `node2`, `head`, `face` — so a pose is a
composition rather than a redraw.

Each part also declares how the monochrome layer treats it:

```ts
export type MonoCut = 'ring' | 'arcLeft' | 'clipToBody' | 'none';
```

which turns the mask logic currently hand-written in `icon-mono.svg` into data.
The three cuts already in that file map one to one: `ring` is the coin's edge and
inner ring, `arcLeft` is the seam on each node and the head, `clipToBody` is a
leg that crosses the segment it hangs from.

### Poses

```ts
export type Pose = 'carrying' | 'searching' | 'face' | 'walk';
export function mascot(pose: Pose, frame?: number): { parts: readonly Part[]; viewBox: string };
```

| Pose        | What it is                                   | Used by           |
| ----------- | -------------------------------------------- | ----------------- |
| `carrying`  | today's mark, unchanged                      | import            |
| `searching` | no coin, antennae raised                     | empty states      |
| `face`      | head and antennae only, tight viewBox        | assistant, header |
| `walk`      | `carrying` with leg angles driven by `frame` | import progress   |

Parts come back in draw order, so the caller never has to know that three legs go
on top of the body and three go behind it.

## `src/components/mascot/Ant.tsx`

Thin by design: maps `Part[]` onto `react-native-svg` elements and resolves roles
through `useTheme()`. Props are `pose`, `size` and an optional `frame`. It holds
no geometry, so it cannot drift from the icon.

`react-native-svg` 15.15.4 is already a dependency; nothing new is installed.

## Colour roles

The in-app ant **follows the theme**. The app icon does not — it stays fixed
cream, teal and ochre, because a launcher icon has no theme to follow.

| Role        | Icon (fixed) | In-app light | In-app dark |
| ----------- | ------------ | ------------ | ----------- |
| `ink`       | `#08302C`    | `text`       | `text`      |
| `body`      | `#3FD0BE`    | `accent`     | `accent`    |
| `grain`     | `#A8720E`    | `grain`      | `grain`     |
| `grainSoft` | `#F6E7C6`    | `grainSoft`  | `grainSoft` |

Pinning the in-app ant to the icon's palette instead would put a mint-and-ochre
ant on the near-black dark background, where `ink` at `#08302C` is very nearly
invisible.

A consequence worth stating plainly: the in-app ant will not look identical to
the launcher icon. `body` resolves to `accent`, which is `#06695F` in the light
theme, so the in-app gaster is dark teal where the icon's is mint. That is the
price of one geometry serving both, and it is the right trade — the alternative
is a second copy of the ant that drifts.

## Icon generation

`scripts/render-icons.ts` gains a step ahead of everything it does today:
serialise `mascot('carrying')` to an SVG string against the fixed icon palette,
write `icon-mark.svg`, apply the mono cut rules and write `icon-mono.svg`, then
render the six PNGs exactly as now.

**Acceptance criterion, and the one that matters most:** the six generated PNGs
must be pixel-identical to the ones committed today. The geometry is being moved,
not redesigned. Any visible difference is a bug in the move.

The two SVG files stop being hand-authored and become build output. They stay
committed — they are what the renderer reads and what a reviewer can look at —
but from this point the edit happens in `mascot.ts`.

## Surfaces

**Empty states.** There is one `Empty` component, defined locally in
`app/(tabs)/index.tsx` — a Feather `inbox` glyph over muted text, used twice on
the dashboard. `app/(tabs)/transactions.tsx` and `app/(tabs)/banks.tsx` render
their empty states as a bare `<Text>` with no icon at all.

`Empty` is lifted into `src/components/ui/Empty.tsx`, the local copy deleted, and
the two bare-text cases adopt it. The glyph becomes the ant in `searching`. Copy
is untouched: `dashboard.noData`, `transactions.empty`,
`transactions.filters.noMatch` and `banks.empty` already exist in en, es and de.

`settings.autoExclusionsEmpty` and `categories.hiddenEmpty` are **out of scope**.
They are one-line captions inside a section of an otherwise full screen, not
screen-level empty states; a mascot beside them would be decoration on a page
that is not empty.

**Import.** `import.tsx` tracks a single `busy` boolean, not a progress
fraction, so the ant walks as a loop for as long as `busy` holds rather than
stepping along a percentage. It settles into `carrying` when the import returns.
If granular progress ever arrives, the walk can be driven by it without the
component changing.

**Assistant.** `AskBubble` takes the `face` pose. The bubble is a 56px circle
filled with `theme.accent`, so an ant whose `body` role also resolves to `accent`
would be invisible on it. `Ant` therefore takes a `variant` prop: `'theme'`
(default) resolves roles against the palette as above, and `'onAccent'` maps
`ink` to `onAccent` and leaves the fills as `accent`, giving an outlined ant that
reads on the filled bubble. The face lines are `ink`, so they survive.

**Dashboard header.** `face` at around 24px beside the `nav.dashboard` title.

**Not the tab bar.** The tabs carry Feather `pie-chart`, `list` and `home`, and
each one is doing wayfinding work: they have to be told apart at a glance and
they have to mean different things. Replacing one with the mascot costs
navigation clarity and buys a logo. The ant stays out of it.

## Motion

Only the import wait animates, because that is the only place where movement
carries information: work is happening. Empty states hold still — they are
screens the owner sits on, and a looping idle there becomes noise and costs
battery for nothing.

Frames are gated on `useMotion().enabled`. When the OS asks for less motion the
import ant renders `carrying`, static. `useMotion` already flattens every
animation in `Sheet`, `Touchable`, `SegmentedControl`, `Trail` and
`ForecastChart`, so this adds no new accessibility surface.

## Accessibility

The ant is decorative on all four surfaces. It is hidden from the accessibility
tree — `accessibilityElementsHidden` and `importantForAccessibility="no-hide-descendants"`
— and the text beside it keeps carrying the meaning. No screen loses information
with the ant removed, which is the test for whether it earned the label
"decorative".

## Testing

`mascot.ts` is plain data under node, so it is tested the way `trail.ts` is:

- every pose returns a non-empty part list and a well-formed viewBox;
- `searching` and `face` are strict subsets of `carrying`'s parts, which is what
  keeps the poses one character rather than four drawings;
- `walk` frames differ only in leg geometry — every non-leg part is identical
  across frames;
- every part's colour is a known `Role`, so no hex can be smuggled back in.

The pixel-identity of the six PNGs is checked once, by hand, at the moment of the
move.

## Risks

**The move is silent if it goes wrong.** Geometry translated by hand into a data
module can be subtly off in a way that renders fine at 1024 and wrong at 48. The
PNG identity check is the guard, and it must be done before anything else is
built on top.

**Four screens change at once.** Lifting `Empty` touches four files that
currently have no shared dependency. It is a deletion of duplication rather than
a new abstraction, but it is still the widest blast radius in this design.
