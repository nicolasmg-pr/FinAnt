/**
 * The ant's geometry, as data.
 *
 * This is the only place the mark is drawn. `scripts/render-icons.ts`
 * serialises it to `icon-mark.svg` and `icon-mono.svg` against the fixed icon
 * palette; `components/mascot/Ant.tsx` renders the same parts against the live
 * theme. Two copies of an ant drift, so there is one.
 *
 * Colour is a role name and never a hex. That is what lets one geometry serve a
 * launcher icon, which has no theme, and an in-app mascot, which must survive a
 * near-black background.
 *
 * No react-native import lives in this file. It is a plain data module so the
 * geometry can be tested under node, the same arrangement palette.ts and
 * trail.ts use.
 */
export type Role = 'ink' | 'body' | 'grain' | 'grainSoft';

/** How the monochrome layer cuts a part back out of the silhouette. */
export type MonoCut = 'ring' | 'arcLeft' | 'clipToBody' | 'none';

interface Common {
  readonly id: string;
  readonly fill?: Role;
  readonly stroke?: Role;
  readonly width?: number;
  readonly monoCut?: MonoCut;
  /**
   * Stroke width this part takes in the monochrome layer's solid silhouette.
   * Not derivable from `width`: the mono layer thickens the thin parts so they
   * survive launcher size, leaves the body outlines alone, and gives the coin no
   * stroke at all. These are the values the committed mask uses.
   */
  readonly monoStroke?: number;
  /** Radius the coin's solid disc takes in the mono layer, replacing `r`. */
  readonly monoRadius?: number;
  /** False for parts that exist only in colour — the coin's ring and glint. */
  readonly monoSolid?: boolean;
  /** Applied verbatim as an SVG transform. */
  readonly transform?: string;
}

export type Part =
  | (Common & { readonly kind: 'path'; readonly d: string; readonly closed?: boolean })
  | (Common & {
      readonly kind: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
    })
  | (Common & {
      readonly kind: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
    });

export type Pose = 'carrying' | 'searching' | 'face' | 'walk';

export interface Drawing {
  readonly parts: readonly Part[];
  readonly viewBox: string;
  /**
   * Wraps the whole drawing. The offset lives here rather than being composed
   * into every part, because the monochrome layer needs the parts' own
   * transforms un-offset and stripping a prefix back off a string is the kind
   * of thing that works until it doesn't.
   */
  readonly transform: string;
}

/**
 * The launcher icon has no theme to follow, so its colours are fixed. These are
 * the exact values `icon-mark.svg` carried when the geometry moved here.
 */
export const ICON_PALETTE: Readonly<Record<Role, string>> = {
  ink: '#08302C',
  body: '#3FD0BE',
  grain: '#A8720E',
  grainSoft: '#F6E7C6',
};

/**
 * The whole mark is authored on the 1024 canvas and offset so it sits on the
 * optical centre rather than the geometric one.
 */
export const OFFSET = 'translate(-16 -54)';

/** The coin is scaled to 0.84 so the ant, not its load, is the subject. */
export const COIN_TRANSFORM =
  'translate(14 34) translate(470 430) scale(0.84) translate(-470 -430)';

export const STROKE = 26;
const FACE_STROKE = 22;

/**
 * Antennae, the rearmost leg and the two front legs. All drawn behind the body,
 * so each emerges from under a segment whose outline stays unbroken. Drawn on
 * top, the rear leg's raised knee closes into a triangle that reads as a letter
 * A, and the front legs cut through the head's bottom edge.
 */
const behind: readonly Part[] = [
  {
    id: 'antenna-upper',
    kind: 'path',
    d: 'M718 518 L706 418 L812 348',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 46,
  },
  {
    id: 'antenna-lower',
    kind: 'path',
    d: 'M792 540 L840 476 L944 486',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 46,
  },
  {
    id: 'leg-rear',
    kind: 'path',
    d: 'M372 744 L306 602 L220 846 L150 846',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 38,
  },
  {
    id: 'leg-front-1',
    kind: 'path',
    d: 'M690 730 L748 880 L818 880',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 38,
  },
  {
    id: 'leg-front-2',
    kind: 'path',
    d: 'M796 742 L870 850 L940 850',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 38,
  },
];

const coin: readonly Part[] = [
  {
    id: 'coin',
    kind: 'circle',
    cx: 470,
    cy: 430,
    r: 205,
    fill: 'grain',
    stroke: 'ink',
    width: 31,
    monoStroke: 0,
    monoRadius: 220,
    transform: COIN_TRANSFORM,
    monoCut: 'ring',
  },
  {
    id: 'coin-ring',
    kind: 'circle',
    cx: 470,
    cy: 430,
    r: 150,
    stroke: 'grainSoft',
    width: 24,
    monoSolid: false,
    transform: COIN_TRANSFORM,
    monoCut: 'ring',
  },
  {
    id: 'coin-glint',
    kind: 'path',
    d: 'M396 352 L410 316 L424 352 L460 366 L424 380 L410 416 L396 380 L360 366 Z',
    fill: 'grainSoft',
    monoSolid: false,
    transform: COIN_TRANSFORM,
    closed: true,
    monoCut: 'none',
  },
];

/** Gaster, the two petiole nodes, head. The gaster is a leaf, pointed at the rear. */
const bodyParts: readonly Part[] = [
  {
    id: 'gaster',
    kind: 'path',
    d: 'M108 726 C132 626 196 566 292 570 C388 574 452 640 456 712 C460 784 392 836 296 832 C200 828 132 800 108 726 Z',
    fill: 'body',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 26,
    closed: true,
    monoCut: 'none',
  },
  {
    id: 'node1',
    kind: 'circle',
    cx: 455,
    cy: 712,
    r: 58,
    fill: 'grain',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 26,
    monoCut: 'arcLeft',
  },
  {
    id: 'node2',
    kind: 'circle',
    cx: 572,
    cy: 700,
    r: 72,
    fill: 'grain',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 26,
    monoCut: 'arcLeft',
  },
  {
    id: 'head',
    kind: 'ellipse',
    cx: 750,
    cy: 650,
    rx: 150,
    ry: 134,
    fill: 'grain',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 26,
    transform: 'rotate(-6 750 650)',
    monoCut: 'arcLeft',
  },
];

/**
 * The three middle legs, drawn on top of the gaster and the nodes so the upper
 * part of each shows crossing the segment it hangs from — the one place the
 * reference artwork shows the joint.
 */
const legsOnTop: readonly Part[] = [
  {
    id: 'leg-mid-1',
    kind: 'path',
    d: 'M352 772 L332 892 L262 892',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 38,
    monoCut: 'clipToBody',
  },
  {
    id: 'leg-mid-2',
    kind: 'path',
    d: 'M452 668 L446 884 L376 884',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 38,
    monoCut: 'clipToBody',
  },
  {
    id: 'leg-mid-3',
    kind: 'path',
    d: 'M570 640 L584 872 L514 872',
    stroke: 'ink',
    width: STROKE,
    monoStroke: 38,
    monoCut: 'clipToBody',
  },
];

/**
 * A closed, happy eye and a wide smile, set well forward on the head: the ant is
 * in profile and looking where it walks, so it has one eye. Set further back the
 * same arcs read as a face turned to the viewer, and then one eye looks like a
 * face missing an eye.
 */
const face: readonly Part[] = [
  {
    id: 'eye',
    kind: 'path',
    d: 'M760 594 Q786 556 812 594',
    stroke: 'ink',
    width: FACE_STROKE,
    monoSolid: false,
  },
  {
    id: 'smile',
    kind: 'path',
    d: 'M742 674 Q808 740 868 670',
    stroke: 'ink',
    width: FACE_STROKE,
    monoSolid: false,
  },
];

/**
 * The holes cut back out of the monochrome silhouette. Geometry, so it lives
 * here with the rest of the geometry rather than in the renderer.
 */
export const MONO_CUTS = {
  /** At the coin's edge and its inner ring, drawn in the coin's own frame. */
  coin: [
    { r: 220, width: 26 },
    { r: 150, width: 24 },
  ],
  /** A left-facing arc where each segment meets the one behind it. */
  seams: [
    { d: 'M455 641 A 71 71 0 0 0 455 783', width: 26 },
    { d: 'M572 615 A 85 85 0 0 0 572 785', width: 26 },
    { d: 'M625 556 A 163 147 0 0 0 625 744', width: 26 },
  ],
  /** The eye and the smile, cut wider than they are drawn so they survive. */
  face: [
    { d: 'M760 594 Q786 556 812 594', width: 26 },
    { d: 'M742 674 Q808 740 868 670', width: 30 },
  ],
  /** Width of the leg grooves, which are clipped to the body. */
  legGroove: 38,
} as const;

/**
 * The head's bounding box plus room for the antennae, so the face pose crops to
 * the character rather than to a canvas mostly full of body. Two prior values
 * here each clipped something (the head's bottom, then the upper antenna's
 * round cap): hand arithmetic on the part coordinates keeps missing stroke
 * caps and the pose's own `OFFSET` transform. This value was instead measured
 * by rasterising `mascot('face')` and scanning the rendered alpha channel for
 * its bounding box in offset-canvas coordinates (content x 571..941, y
 * 280..744), then centring a square box around that with even margins.
 * Re-derive it the same way — by rendering and measuring, not by reading
 * coordinates off the part data — if the face pose's geometry ever changes.
 */
const FACE_VIEWBOX = '500 257 510 510';

/** Four frames is enough to read as walking and few enough to hand-tune. */
const WALK_FRAMES = 4;

/**
 * The alternating-tripod gait real hexapods use: legs split into two groups,
 * taken front to back along the body, that swing in opposite phase. Every leg
 * moving the same way at the same time reads as the whole leg assembly
 * wobbling side to side, not as a stride — what makes a multi-legged side
 * view read as walking is that some legs are always swinging forward while
 * the others swing back.
 *
 * Taken front to back — `leg-front-2`, `leg-front-1`, `leg-mid-3`,
 * `leg-mid-2`, `leg-mid-1`, `leg-rear` — group A is the 1st, 3rd and 5th of
 * that order, group B the 2nd, 4th and 6th.
 */
const WALK_GROUP_A: ReadonlySet<string> = new Set(['leg-front-2', 'leg-mid-3', 'leg-mid-1']);

/**
 * A leg's lower two points swing along x; the attachment point never moves,
 * because a leg that slides out of its socket reads as a broken drawing rather
 * than as a step. Each group passes through a neutral frame between its two
 * extremes rather than snapping between them, so on every frame the groups
 * are either opposed (one group forward, the other back) or both resting at
 * neutral together — never a hard cut.
 */
const WALK_SWING_A: readonly number[] = [18, 0, -18, 0];
const WALK_SWING_B: readonly number[] = [-18, 0, 18, 0];

/**
 * Assumes every leg's `d` is `M x y L x y L x y ...`: absolute, upper-case
 * commands, one plain integer coordinate pair per segment, single spaces. On
 * that shape, shifting the first coordinate pair matched in each non-`M`
 * segment shifts the whole segment, because there is only one pair to match.
 * A curved leg (`C`/`Q`, which carry two or three coordinate pairs per
 * segment) or a lowercase relative command would only get its first pair
 * shifted, silently corrupting the rest of the segment's geometry — so a leg
 * added in either form needs its own swing logic, not this one.
 */
function swing(part: Part, dx: number): Part {
  if (part.kind !== 'path' || dx === 0) return part;
  const points = part.d.split(/(?<=\d)\s+(?=[A-Z])/);
  const shifted = points.map((segment, index) => {
    if (index === 0) return segment;
    return segment.replace(
      /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/,
      (_all, x: string, y: string) => `${Number(x) + dx} ${y}`,
    );
  });
  return { ...part, d: shifted.join(' ') };
}

export function mascot(pose: Pose, frame = 0): Drawing {
  switch (pose) {
    case 'carrying':
      return {
        parts: [...behind, ...coin, ...bodyParts, ...legsOnTop, ...face],
        viewBox: '0 0 1024 1024',
        transform: OFFSET,
      };
    case 'searching':
      return {
        parts: [...behind, ...bodyParts, ...legsOnTop, ...face],
        viewBox: '0 0 1024 1024',
        transform: OFFSET,
      };
    case 'face':
      return {
        parts: [
          ...behind.filter((part) => part.id.startsWith('antenna-')),
          ...bodyParts.filter((part) => part.id === 'head'),
          ...face,
        ],
        viewBox: FACE_VIEWBOX,
        transform: OFFSET,
      };
    case 'walk': {
      const i = ((frame % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
      const dxFor = (id: string): number =>
        (WALK_GROUP_A.has(id) ? WALK_SWING_A[i] : WALK_SWING_B[i]) ?? 0;
      const step = (parts: readonly Part[]): Part[] =>
        parts.map((part) => (part.id.startsWith('leg-') ? swing(part, dxFor(part.id)) : part));
      return {
        parts: [...step(behind), ...coin, ...bodyParts, ...step(legsOnTop), ...face],
        viewBox: '0 0 1024 1024',
        transform: OFFSET,
      };
    }
  }
}
