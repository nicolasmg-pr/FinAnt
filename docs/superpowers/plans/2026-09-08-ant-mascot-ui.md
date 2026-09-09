# Ant Mascot UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the FinAnt ant into the app — empty states, the import wait, the ask bubble and the dashboard title — by moving the mark's geometry out of the SVG into a typed data module that both the icon build and a React component read.

**Architecture:** `src/design/mascot.ts` becomes the single source of the ant's geometry: typed primitives carrying colour **role names**, never hexes. `scripts/render-icons.ts` serialises it to `icon-mark.svg` and `icon-mono.svg` against a fixed icon palette, then renders the six PNGs as it does today. `src/components/mascot/Ant.tsx` renders the same data through `react-native-svg`, resolving roles against the live theme. Poses are compositions over shared named parts, so four poses never become four drawings.

**Tech Stack:** TypeScript 6 (strict, `noUncheckedIndexedAccess`), React 19.2, React Native 0.86, Expo SDK 57, `react-native-svg` 15.15.4 (already a dependency), `@resvg/resvg-js` (root devDependency, build-time only), vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-ant-mascot-ui-design.md`

## Global Constraints

- Domain and geometry modules stay free of React and Expo imports so they run under plain node. `src/design/mascot.ts` must import nothing from `react`, `react-native` or `expo`.
- Relative imports inside packages and `src/` are **extensionless**. Metro does not map `./mascot.js` onto `mascot.ts`.
- No network calls, no analytics, no telemetry. Nothing in this plan adds any.
- Never log a movement, narrative, IBAN or any part of a statement. No task here touches transaction data.
- Colour in `mascot.ts` is a `Role` name. A hex literal in that file is a review failure.
- The six PNGs under `apps/mobile/assets/` must be a **visual match** before and after Tasks 2 and 3, proven by `scripts/compare-pngs.ts` (built in Task 2, Step 1). Byte-identical is the expected outcome and the best one; the accepted tolerance is **no pixel differing by more than 2/255 on any channel, and fewer than 0.05% of pixels differing at all**. Anything beyond that is a geometry change, not a serialisation difference, and must be found rather than waved through. The geometry is being moved, not redesigned.
- Tests live in `apps/mobile/src/design/tests/` and run under `npx vitest run` from the repo root — `vitest.config.ts` already includes that glob.
- Run `npm run typecheck` before every commit. Scope prettier to changed paths; `npm run lint:fix` reformats the whole repo.
- The mark's fixed icon palette is exactly: ink `#08302C`, body `#3FD0BE`, grain `#A8720E`, grainSoft `#F6E7C6`.

---

### Task 1: The geometry module and the `carrying` pose

**Files:**

- Create: `apps/mobile/src/design/mascot.ts`
- Create: `apps/mobile/src/design/tests/mascot.test.ts`
- Modify: `apps/mobile/src/design/index.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type Role = 'ink' | 'body' | 'grain' | 'grainSoft'`; `type MonoCut = 'ring' | 'arcLeft' | 'clipToBody' | 'none'`; `type Part`; `type Pose = 'carrying' | 'searching' | 'face' | 'walk'`; `interface Drawing { parts: readonly Part[]; viewBox: string }`; `function mascot(pose: Pose, frame?: number): Drawing`; `const ICON_PALETTE: Readonly<Record<Role, string>>`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/design/tests/mascot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ICON_PALETTE, MONO_CUTS, mascot, type Part, type Role } from '../mascot';

const ROLES: readonly Role[] = ['ink', 'body', 'grain', 'grainSoft'];

function colours(parts: readonly Part[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part.fill) out.push(part.fill);
    if (part.stroke) out.push(part.stroke);
  }
  return out;
}

describe('mascot', () => {
  it('draws the carrying pose on the full icon canvas', () => {
    const drawing = mascot('carrying');
    expect(drawing.viewBox).toBe('0 0 1024 1024');
    expect(drawing.parts.length).toBeGreaterThan(10);
  });

  it('names every colour as a role, never a hex', () => {
    for (const colour of colours(mascot('carrying').parts)) {
      expect(ROLES).toContain(colour);
    }
  });

  it('gives the coin a ring cut and the head an arcLeft cut', () => {
    const parts = mascot('carrying').parts;
    const coin = parts.find((p) => p.id === 'coin');
    const head = parts.find((p) => p.id === 'head');
    expect(coin?.monoCut).toBe('ring');
    expect(head?.monoCut).toBe('arcLeft');
  });

  it('carries the canvas offset on the drawing, not on every part', () => {
    const drawing = mascot('carrying');
    expect(drawing.transform).toBe('translate(-16 -54)');
    const coin = drawing.parts.find((p) => p.id === 'coin');
    expect(coin?.transform).not.toContain('translate(-16 -54)');
  });

  it('keeps the monochrome cuts as data', () => {
    expect(MONO_CUTS.seams).toHaveLength(3);
    expect(MONO_CUTS.face).toHaveLength(2);
    expect(MONO_CUTS.coin).toHaveLength(2);
  });

  it('resolves every role in the fixed icon palette', () => {
    for (const role of ROLES) {
      expect(ICON_PALETTE[role]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/mobile/src/design/tests/mascot.test.ts`
Expected: FAIL — vitest cannot resolve `../mascot`. The exact wording varies by version; any resolution failure is the expected result.

- [ ] **Step 3: Write the module**

Create `apps/mobile/src/design/mascot.ts`. The geometry below is transcribed verbatim from the committed `icon-mark.svg`; do not re-derive or "tidy" any number.

```ts
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

const STROKE = 26;
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
  { id: 'eye', kind: 'path', d: 'M760 594 Q786 556 812 594', stroke: 'ink', width: FACE_STROKE },
  { id: 'smile', kind: 'path', d: 'M742 674 Q808 740 868 670', stroke: 'ink', width: FACE_STROKE },
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

export function mascot(pose: Pose, frame = 0): Drawing {
  void frame;
  if (pose !== 'carrying') throw new Error(`pose not implemented: ${pose}`);
  return {
    parts: [...behind, ...coin, ...bodyParts, ...legsOnTop, ...face],
    viewBox: '0 0 1024 1024',
    transform: OFFSET,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/mobile/src/design/tests/mascot.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Export from the design barrel**

In `apps/mobile/src/design/index.ts`, after the `./trail` export block, add:

```ts
export {
  ICON_PALETTE,
  mascot,
  type Drawing,
  type MonoCut,
  type Part,
  type Pose,
  type Role,
} from './mascot';
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
npx prettier --write apps/mobile/src/design/mascot.ts apps/mobile/src/design/tests/mascot.test.ts apps/mobile/src/design/index.ts
git add apps/mobile/src/design/mascot.ts apps/mobile/src/design/tests/mascot.test.ts apps/mobile/src/design/index.ts
git commit -m "feat(design): the ant's geometry becomes data, so four poses need not be four files"
```

---

### Task 2: Generate `icon-mark.svg` from the module

**Files:**

- Create: `scripts/mascot-svg.ts`
- Modify: `scripts/render-icons.ts`
- Modify: `apps/mobile/assets/brand/icon-mark.svg` (becomes generated output)

**Interfaces:**

- Consumes: `mascot`, `ICON_PALETTE`, `type Part`, `type Role` from `apps/mobile/src/design/mascot`.
- Produces: `function markSvg(): string` from `scripts/mascot-svg.ts` — the full `<svg>` document for the colour mark.

- [ ] **Step 1: Build the comparator and record the baseline**

The serialiser may order attributes differently from the hand-written SVG, which
can shift anti-aliasing by a bit or two without moving any geometry. So the
guard compares pixels, not bytes.

Create `scripts/compare-pngs.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

/**
 * Compares two directories of PNGs pixel by pixel.
 *
 * Used to prove that moving the mark's geometry into `src/design/mascot.ts` did
 * not move the mark. Byte comparison is too strict — attribute order out of the
 * serialiser can shift anti-aliasing by a bit without moving anything — and
 * eyeballing is too loose, because the failure this guards against looks fine at
 * 1024 and wrong at 48.
 */
const MAX_CHANNEL_DELTA = 2;
const MAX_DIFFERING_FRACTION = 0.0005;

interface Image {
  width: number;
  height: number;
  pixels: Uint8Array;
}

function decode(path: string): Image {
  const file = readFileSync(path);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const chunks: Buffer[] = [];
  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.subarray(pos + 4, pos + 8).toString('ascii');
    if (type === 'IHDR') {
      width = file.readUInt32BE(pos + 8);
      height = file.readUInt32BE(pos + 12);
      colourType = file[pos + 17]!;
    } else if (type === 'IDAT') {
      chunks.push(file.subarray(pos + 8, pos + 8 + length));
    }
    pos += 12 + length;
  }
  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  let offset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++]!;
    const line = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = previous[x]!;
      const c = x >= channels ? previous[x - channels]! : 0;
      if (filter === 1) line[x] = (line[x]! + a) & 255;
      else if (filter === 2) line[x] = (line[x]! + b) & 255;
      else if (filter === 3) line[x] = (line[x]! + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      pixels[to] = line[from]!;
      pixels[to + 1] = line[from + 1]!;
      pixels[to + 2] = line[from + 2]!;
      pixels[to + 3] = channels === 4 ? line[from + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

const [baseline, current] = process.argv.slice(2);
if (!baseline || !current) {
  console.error('usage: tsx scripts/compare-pngs.ts <baseline-dir> <current-dir>');
  process.exit(2);
}

let failed = 0;
for (const name of readdirSync(baseline)
  .filter((f) => f.endsWith('.png'))
  .sort()) {
  const before = decode(join(baseline, name));
  const after = decode(join(current, name));
  if (before.width !== after.width || before.height !== after.height) {
    console.log(
      `${name}: SIZE CHANGED ${before.width}x${before.height} -> ${after.width}x${after.height}`,
    );
    failed++;
    continue;
  }
  let differing = 0;
  let worst = 0;
  for (let i = 0; i < before.pixels.length; i++) {
    const delta = Math.abs(before.pixels[i]! - after.pixels[i]!);
    if (delta > 0) {
      if (i % 4 === 0) differing++;
      if (delta > worst) worst = delta;
    }
  }
  const total = before.width * before.height;
  const fraction = differing / total;
  const ok = worst <= MAX_CHANNEL_DELTA && fraction <= MAX_DIFFERING_FRACTION;
  if (!ok) failed++;
  console.log(
    `${name.padEnd(30)} worst delta ${String(worst).padStart(3)}  differing ${(fraction * 100).toFixed(4)}%  ${ok ? 'ok' : 'FAIL'}`,
  );
}
console.log(failed === 0 ? '\nall six match' : `\n${failed} image(s) moved`);
process.exit(failed === 0 ? 0 : 1);
```

Then take the baseline:

```bash
mkdir -p .superpowers/sdd/2026-09-08-ant-mascot-ui/icon-baseline
cp apps/mobile/assets/*.png .superpowers/sdd/2026-09-08-ant-mascot-ui/icon-baseline/
npx tsx scripts/compare-pngs.ts .superpowers/sdd/2026-09-08-ant-mascot-ui/icon-baseline apps/mobile/assets
```

The baseline lives in the plan's git-ignored workspace rather than `/tmp`, so it
survives to Task 11 and cannot collide with another job's files.

Expected: six `ok` lines and `all six match` — it is comparing the baseline with
itself, so this also proves the comparator works before anything depends on it.

- [ ] **Step 2: Write the serialiser**

Create `scripts/mascot-svg.ts`:

```ts
import { ICON_PALETTE, mascot, type Part, type Role } from '../apps/mobile/src/design/mascot';

/**
 * Serialises the mascot's parts to an SVG document. The renderer and the React
 * component both read `mascot.ts`; this file exists only to turn parts into the
 * text a rasteriser can take.
 */
function paint(role: Role | undefined): string | undefined {
  return role ? ICON_PALETTE[role] : undefined;
}

function attrs(part: Part): string {
  const out: string[] = [];
  out.push(`fill="${paint(part.fill) ?? 'none'}"`);
  if (part.stroke) {
    out.push(`stroke="${paint(part.stroke)}"`);
    out.push(`stroke-width="${part.width ?? 26}"`);
    out.push('stroke-linecap="round"');
    out.push('stroke-linejoin="round"');
  }
  if (part.transform) out.push(`transform="${part.transform}"`);
  return out.join(' ');
}

export function elementFor(part: Part): string {
  const shared = attrs(part);
  switch (part.kind) {
    case 'path':
      return `<path d="${part.d}" ${shared}/>`;
    case 'circle':
      return `<circle cx="${part.cx}" cy="${part.cy}" r="${part.r}" ${shared}/>`;
    case 'ellipse':
      return `<ellipse cx="${part.cx}" cy="${part.cy}" rx="${part.rx}" ry="${part.ry}" ${shared}/>`;
  }
}

export function markSvg(): string {
  const { parts, viewBox, transform } = mascot('carrying');
  const body = parts.map(elementFor).join('\n    ');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1024" height="1024">`,
    '  <!-- Generated by scripts/render-icons.ts from src/design/mascot.ts. Do not edit. -->',
    `  <g transform="${transform}">`,
    `    ${body}`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}
```

- [ ] **Step 3: Wire it into the renderer**

In `scripts/render-icons.ts`, add to the imports at the top:

```ts
import { markSvg } from './mascot-svg';
```

Then replace the two lines that read the marks:

```ts
const mark = read('icon-mark.svg');
const mono = read('icon-mono.svg');
```

with:

```ts
writeFileSync(join(brand, 'icon-mark.svg'), markSvg());

const mark = read('icon-mark.svg');
const mono = read('icon-mono.svg');
```

- [ ] **Step 4: Regenerate and compare against the baseline**

Run:

```bash
npm run icons
npx tsx scripts/compare-pngs.ts .superpowers/sdd/2026-09-08-ant-mascot-ui/icon-baseline apps/mobile/assets
```

Expected: `all six match`, exit 0. A `FAIL` line names the image that moved.

If they differ, do not adjust the PNGs. Render both SVGs and compare visually to find which part moved:

```bash
git diff apps/mobile/assets/brand/icon-mark.svg
```

The likely causes, in order: a transform composed in the wrong order (`OFFSET` must come first, the coin transform second), a missing `stroke-linecap="round"` on a part that had it, or a `fill="none"` lost on a stroke-only path.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all tests pass.

```bash
npx prettier --write scripts/mascot-svg.ts scripts/render-icons.ts
git add scripts/compare-pngs.ts scripts/mascot-svg.ts scripts/render-icons.ts apps/mobile/assets/brand/icon-mark.svg
git commit -m "feat(brand): the colour mark is generated now, not hand-drawn"
```

---

### Task 3: Generate `icon-mono.svg` from the cut rules

**Files:**

- Modify: `scripts/mascot-svg.ts`
- Modify: `scripts/render-icons.ts`
- Modify: `apps/mobile/assets/brand/icon-mono.svg` (becomes generated output)

**Interfaces:**

- Consumes: `markSvg` from Task 2; `mascot`, `MONO_CUTS`, `COIN_TRANSFORM`, `type Part` from `mascot.ts`. Add `COIN_TRANSFORM` and `MONO_CUTS` to the existing import line at the top of `scripts/mascot-svg.ts`.
- Produces: `function monoSvg(): string` from `scripts/mascot-svg.ts`.

**Why this is its own task:** the monochrome layer keeps only alpha, so an outline cannot be drawn — it has to be cut. Getting the colour mark byte-identical proves nothing about the mask.

- [ ] **Step 1: Write the mono serialiser**

Append to `scripts/mascot-svg.ts`:

```ts
/**
 * The monochrome layer for Android, which keeps only the alpha channel and
 * tints it one colour. An outline is the one thing a single flat colour cannot
 * express: fill it in and coin, segments, legs and face fuse into one lump. So
 * the ink becomes a gap — every shape is filled solid out to the outer edge of
 * its stroke, then the seams are cut back out as holes in a mask.
 *
 * Every width and every cut here comes from `mascot.ts`. Nothing about the
 * mark's shape is decided in this file.
 */
function solidElement(part: Part): string {
  const attrs: string[] = [];
  if (!part.fill) attrs.push('fill="none"');
  if (part.monoStroke === 0) attrs.push('stroke="none"');
  else if (part.monoStroke !== undefined) attrs.push(`stroke-width="${part.monoStroke}"`);
  if (part.transform) attrs.push(`transform="${part.transform}"`);
  const tail = attrs.join(' ');
  switch (part.kind) {
    case 'path':
      return `<path d="${part.d}" ${tail}/>`;
    case 'circle':
      return `<circle cx="${part.cx}" cy="${part.cy}" r="${part.monoRadius ?? part.r}" ${tail}/>`;
    case 'ellipse':
      return `<ellipse cx="${part.cx}" cy="${part.cy}" rx="${part.rx}" ry="${part.ry}" ${tail}/>`;
  }
}

export function monoSvg(): string {
  const { parts, viewBox, transform } = mascot('carrying');
  const byId = (id: string) => parts.find((part) => part.id === id);

  const clipIds = ['gaster', 'node1', 'node2', 'head'];
  const clip = clipIds
    .map((id) => byId(id))
    .filter((part): part is Part => part !== undefined)
    .map((part) => solidElement({ ...part, fill: undefined, monoStroke: undefined }))
    .join('\n      ');

  const solid = parts
    .filter((part) => part.monoSolid !== false)
    .map(solidElement)
    .join('\n        ');

  const grooves = parts
    .filter((part) => part.monoCut === 'clipToBody' && part.kind === 'path')
    .map((part) => `<path d="${(part as Extract<Part, { kind: 'path' }>).d}"/>`)
    .join('\n          ');

  const cuts = [
    `<g transform="${COIN_TRANSFORM}">`,
    ...MONO_CUTS.coin.map(
      (cut) => `  <circle cx="470" cy="430" r="${cut.r}" stroke-width="${cut.width}"/>`,
    ),
    '</g>',
    ...MONO_CUTS.seams.map((cut) => `<path d="${cut.d}" stroke-width="${cut.width}"/>`),
    `<g clip-path="url(#body)" stroke-width="${MONO_CUTS.legGroove}">`,
    `  ${grooves}`,
    '</g>',
    ...MONO_CUTS.face.map((cut) => `<path d="${cut.d}" stroke-width="${cut.width}"/>`),
  ].join('\n        ');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1024" height="1024">`,
    '  <!-- Generated by scripts/render-icons.ts from src/design/mascot.ts. Do not edit. -->',
    '  <defs>',
    '    <clipPath id="body">',
    `      ${clip}`,
    '    </clipPath>',
    '  </defs>',
    '  <mask id="mark" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">',
    `    <g transform="${transform}">`,
    '      <g fill="#FFFFFF" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">',
    `        ${solid}`,
    '      </g>',
    '      <g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round">',
    `        ${cuts}`,
    '      </g>',
    '    </g>',
    '  </mask>',
    '  <rect width="1024" height="1024" fill="#000000" mask="url(#mark)"/>',
    '</svg>',
    '',
  ].join('\n');
}
```

- [ ] **Step 2: Wire it in**

In `scripts/render-icons.ts`, change the import to:

```ts
import { markSvg, monoSvg } from './mascot-svg';
```

and add below the `icon-mark.svg` write:

```ts
writeFileSync(join(brand, 'icon-mono.svg'), monoSvg());
```

- [ ] **Step 3: Regenerate and compare pixels, not bytes**

The mono SVG's element order will differ from the hand-written file, so compare the **rendered PNG**, which is what ships:

```bash
npm run icons
npx tsx scripts/compare-pngs.ts .superpowers/sdd/2026-09-08-ant-mascot-ui/icon-baseline apps/mobile/assets
```

Expected: `all six match`, exit 0.

- [ ] **Step 4: Verify the cuts independently**

The PNG hash catches everything, but if it differs, this says _where_. Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
const d = readFileSync('apps/mobile/assets/android-icon-monochrome.png');
let pos = 8, idat = Buffer.alloc(0), w = 0, h = 0;
while (pos < d.length) {
  const len = d.readUInt32BE(pos), type = d.subarray(pos + 4, pos + 8).toString('ascii');
  if (type === 'IHDR') { w = d.readUInt32BE(pos + 8); h = d.readUInt32BE(pos + 12); }
  if (type === 'IDAT') idat = Buffer.concat([idat, d.subarray(pos + 8, pos + 8 + len)]);
  pos += 12 + len;
}
const raw = zlib.inflateSync(idat), stride = w * 4, prev = Buffer.alloc(stride);
const rows = []; let i = 0; let last = Buffer.alloc(stride);
for (let y = 0; y < h; y++) {
  const f = raw[i++]; const line = Buffer.from(raw.subarray(i, i + stride)); i += stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= 4 ? line[x - 4] : 0, b = last[x], c = x >= 4 ? last[x - 4] : 0;
    if (f === 1) line[x] = (line[x] + a) & 255;
    else if (f === 2) line[x] = (line[x] + b) & 255;
    else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
    else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
  }
  rows.push(line); last = line;
}
const at = (mx, my) => { const px = Math.round(512 + (mx - 16 - 512) * 0.62), py = Math.round(512 + (my - 54 - 512) * 0.62);
  return rows[py][px * 4 + 3]; };
const checks = [['gaster solid', 306, 616, true], ['head solid', 720, 780, true],
  ['node1 groove', 450, 700, false], ['coin seam', 353, 595, false],
  ['eye cut', 786, 575, false], ['smile cut', 806, 706, false]];
let bad = 0;
for (const [name, x, y, wantInk] of checks) {
  const ink = at(x, y) > 128; if (ink !== wantInk) bad++;
  console.log(name.padEnd(16), ink ? 'ink' : 'GAP', ink === wantInk ? '' : '  <-- MISMATCH');
}
process.exit(bad ? 1 : 0);
"
```

Expected: every row matches, exit 0.

- [ ] **Step 5: Commit**

Run: `npm run typecheck && npx vitest run`

```bash
npx prettier --write scripts/mascot-svg.ts scripts/render-icons.ts
git add scripts/mascot-svg.ts scripts/render-icons.ts apps/mobile/assets/brand/icon-mono.svg apps/mobile/assets/
git commit -m "feat(brand): the monochrome mark's cuts are rules now, not hand-written mask"
```

---

### Task 4: The remaining poses

**Files:**

- Modify: `apps/mobile/src/design/mascot.ts`
- Modify: `apps/mobile/src/design/tests/mascot.test.ts`

**Interfaces:**

- Consumes: everything from Task 1.
- Produces: `mascot('searching')`, `mascot('face')`, `mascot('walk', frame)` all returning `Drawing`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/src/design/tests/mascot.test.ts`:

```ts
describe('poses', () => {
  const ids = (pose: Parameters<typeof mascot>[0], frame?: number) =>
    mascot(pose, frame).parts.map((p) => p.id);

  it('searching is carrying without the coin', () => {
    const searching = ids('searching');
    expect(searching).not.toContain('coin');
    expect(searching).not.toContain('coin-ring');
    expect(searching).not.toContain('coin-glint');
    expect(searching).toContain('gaster');
    expect(searching).toContain('eye');
  });

  it('every pose is a subset of carrying, so they stay one character', () => {
    const carrying = new Set(ids('carrying'));
    for (const pose of ['searching', 'face', 'walk'] as const) {
      for (const id of ids(pose)) expect(carrying.has(id)).toBe(true);
    }
  });

  it('face keeps the head and drops the body, on a tight viewBox', () => {
    const drawing = mascot('face');
    const faceIds = drawing.parts.map((p) => p.id);
    expect(faceIds).toContain('head');
    expect(faceIds).toContain('eye');
    expect(faceIds).not.toContain('gaster');
    expect(faceIds).not.toContain('leg-mid-1');
    expect(drawing.viewBox).not.toBe('0 0 1024 1024');
  });

  it('walk frames differ only in leg geometry', () => {
    const a = mascot('walk', 0).parts;
    const b = mascot('walk', 1).parts;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      const left = a[i]!;
      const right = b[i]!;
      expect(left.id).toBe(right.id);
      if (!left.id.startsWith('leg-')) expect(right).toEqual(left);
    }
    const legsA = a.filter((p) => p.id.startsWith('leg-'));
    const legsB = b.filter((p) => p.id.startsWith('leg-'));
    expect(legsA).not.toEqual(legsB);
  });

  it('walk wraps around its frame count', () => {
    expect(mascot('walk', 0)).toEqual(mascot('walk', 4));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/mobile/src/design/tests/mascot.test.ts`
Expected: FAIL — `pose not implemented: searching`.

- [ ] **Step 3: Implement the poses**

In `apps/mobile/src/design/mascot.ts`, add above `mascot`:

```ts
/**
 * The head's bounding box plus room for the antennae, so the face pose crops to
 * the character rather than to a canvas mostly full of body.
 */
const FACE_VIEWBOX = '560 300 420 420';

/** Four frames is enough to read as walking and few enough to hand-tune. */
const WALK_FRAMES = 4;

/**
 * A leg's lower two points swing along x; the attachment point never moves,
 * because a leg that slides out of its socket reads as a broken drawing rather
 * than as a step.
 */
const WALK_SWING: readonly number[] = [0, 18, 0, -18];

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
```

Then replace the body of `mascot` with:

```ts
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
      const dx = WALK_SWING[((frame % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES] ?? 0;
      const step = (parts: readonly Part[]): Part[] =>
        parts.map((part) => (part.id.startsWith('leg-') ? swing(part, dx) : part));
      return {
        parts: [...step(behind), ...coin, ...bodyParts, ...step(legsOnTop), ...face],
        viewBox: '0 0 1024 1024',
        transform: OFFSET,
      };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/mobile/src/design/tests/mascot.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Confirm the icon did not move**

Adding poses must not change `carrying`. Run:

```bash
npm run icons
npx tsx scripts/compare-pngs.ts .superpowers/sdd/2026-09-08-ant-mascot-ui/icon-baseline apps/mobile/assets
```

Expected: `all six match`.

- [ ] **Step 6: Commit**

Run: `npm run typecheck && npx vitest run`

```bash
npx prettier --write apps/mobile/src/design/mascot.ts apps/mobile/src/design/tests/mascot.test.ts
git add apps/mobile/src/design/mascot.ts apps/mobile/src/design/tests/mascot.test.ts
git commit -m "feat(design): three more poses, all of them the same ant"
```

---

### Task 5: The `Ant` component

**Files:**

- Create: `apps/mobile/src/components/mascot/Ant.tsx`

**Interfaces:**

- Consumes: `mascot`, `type Part`, `type Pose`, `type Role` from `../../design`; `useTheme` from `../../design`.
- Produces: `function Ant(props: { pose: Pose; size: number; frame?: number; variant?: 'theme' | 'onAccent' }): JSX.Element`.

- [ ] **Step 1: Write the component**

Create `apps/mobile/src/components/mascot/Ant.tsx`:

```tsx
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { mascot, useTheme, type Part, type Pose, type Role } from '../../design';
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

  const paint = (part: Part) => ({
    fill: part.fill ? colours[part.fill] : 'none',
    stroke: part.stroke ? colours[part.stroke] : undefined,
    strokeWidth: part.stroke ? (part.width ?? 26) : undefined,
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `Palette` is not exported as a type from `../../design`, it is — `index.ts` re-exports `type Palette` from `./palette`.

- [ ] **Step 3: Commit**

```bash
npx prettier --write apps/mobile/src/components/mascot/Ant.tsx
git add apps/mobile/src/components/mascot/Ant.tsx
git commit -m "feat(mascot): a component that draws the ant and owns none of it"
```

---

### Task 6: The shared `Empty`, and the dashboard

**Files:**

- Create: `apps/mobile/src/components/ui/Empty.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx` (delete local `Empty` at 411-419, delete `styles.empty` at 438, add import)

**Interfaces:**

- Consumes: `Ant` from Task 5.
- Produces: `function Empty(props: { message: string }): JSX.Element` from `src/components/ui/Empty.tsx`.

- [ ] **Step 1: Create the shared component**

Create `apps/mobile/src/components/ui/Empty.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { spacing, type, useTheme } from '../../design';
import { Ant } from '../mascot/Ant';

/**
 * What a screen shows when it has nothing to show. The ant is in `searching`:
 * empty-handed, because there is nothing yet to carry.
 *
 * The ant is decorative and hidden from the accessibility tree; `message` is
 * what a screen reader gets, and nothing is lost with the drawing removed.
 */
export function Empty({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Ant pose="searching" size={96} />
      <Text style={[type.body, styles.text, { color: theme.textMuted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  text: { textAlign: 'center' },
});
```

- [ ] **Step 2: Delete the local copy and import the shared one**

In `apps/mobile/app/(tabs)/index.tsx`:

1. Delete the whole `function Empty({ message }: { message: string })` block (lines 411-419).
2. Delete the `empty:` entry from `StyleSheet.create` (line 438) and the `emptyText` entry if present.
3. Add to the imports: `import { Empty } from '../../src/components/ui/Empty';`
4. If `Feather` is now unused in the file, remove its import.

The two `<Empty message={t('dashboard.noData')} />` call sites at lines 178 and 262 need no change — the prop shape is identical.

- [ ] **Step 3: Typecheck and lint the touched files**

Run: `npm run typecheck && npx eslint apps/mobile/app/\(tabs\)/index.tsx apps/mobile/src/components/ui/Empty.tsx`
Expected: no errors. An unused-import error here means step 2.4 was skipped.

- [ ] **Step 4: See it**

Run: `cd apps/mobile && npx expo run:ios --device 63A6F169-AF3A-4D6E-A336-929DB5A09AF1`

The owner's simulator has data, so the dashboard will not be empty. To see the empty state, open **Movimientos** and type a search string that matches nothing — that path uses Task 7's change, so if Task 7 is not done yet, confirm only that the dashboard still renders and nothing regressed.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/mobile/src/components/ui/Empty.tsx "apps/mobile/app/(tabs)/index.tsx"
git add apps/mobile/src/components/ui/Empty.tsx "apps/mobile/app/(tabs)/index.tsx"
git commit -m "feat(mascot): the ant stands where the inbox glyph used to"
```

---

### Task 7: The two screens that had no empty state at all

**Files:**

- Modify: `apps/mobile/app/(tabs)/transactions.tsx:141-145` and `:580`
- Modify: `apps/mobile/app/(tabs)/banks.tsx:420`

**Interfaces:**

- Consumes: `Empty` from Task 6.

- [ ] **Step 1: Give the transactions list the shared empty state**

In `apps/mobile/app/(tabs)/transactions.tsx`, replace the `ListEmptyComponent` block:

```tsx
        ListEmptyComponent={
          <Text style={[type.body, styles.empty, { color: theme.textMuted }]}>
            {activeCount > 0 ? t('transactions.filters.noMatch') : t('transactions.empty')}
          </Text>
        }
```

with:

```tsx
        ListEmptyComponent={
          <Empty message={activeCount > 0 ? t('transactions.filters.noMatch') : t('transactions.empty')} />
        }
```

Add `import { Empty } from '../../src/components/ui/Empty';` to the imports, and delete the now-unused `empty:` style at line 580.

- [ ] **Step 2: Give the banks list the same**

In `apps/mobile/app/(tabs)/banks.tsx`, replace:

```tsx
<Text style={[type.body, { color: theme.textMuted }]}>{t('banks.empty')}</Text>
```

with:

```tsx
<Empty message={t('banks.empty')} />
```

Add `import { Empty } from '../../src/components/ui/Empty';`.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npx eslint "apps/mobile/app/(tabs)/transactions.tsx" "apps/mobile/app/(tabs)/banks.tsx"`
Expected: no errors, including no unused `Text` or `type` imports if those became unused.

- [ ] **Step 4: See it**

Build and open **Movimientos**, then type a search string that matches nothing. Expected: the ant, empty-handed, above "Ningún movimiento coincide con este filtro."

- [ ] **Step 5: Commit**

```bash
npx prettier --write "apps/mobile/app/(tabs)/transactions.tsx" "apps/mobile/app/(tabs)/banks.tsx"
git add "apps/mobile/app/(tabs)/transactions.tsx" "apps/mobile/app/(tabs)/banks.tsx"
git commit -m "feat(mascot): two lists that said nothing now show who is looking"
```

---

### Task 8: The ask bubble

**Files:**

- Modify: `apps/mobile/src/components/AskBubble.tsx:124` (the `Feather` element) and its import block

**Interfaces:**

- Consumes: `Ant` from Task 5.

- [ ] **Step 1: Swap the glyph for the face**

In `apps/mobile/src/components/AskBubble.tsx`, replace:

```tsx
<Feather name="message-circle" size={24} color={theme.onAccent} />
```

with:

```tsx
<Ant pose="face" size={34} variant="onAccent" />
```

Add `import { Ant } from './mascot/Ant';` and remove the now-unused `import Feather from '@expo/vector-icons/Feather';`.

The bubble keeps its `accessibilityRole="button"` and `accessibilityLabel={t('assistant.bubbleLabel')}` — the label was already doing the work, and `Ant` hides itself from the accessibility tree, so nothing changes for a screen reader.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npx eslint apps/mobile/src/components/AskBubble.tsx`
Expected: no errors.

- [ ] **Step 3: See it, in both themes**

Build, then check the bubble in light mode and in dark mode (Settings → Developer → Dark Appearance in the simulator, or `xcrun simctl ui booted appearance dark`). Expected: an outlined ant face, legible on the accent-filled circle in both.

If it reads as a blob, the `onAccent` mapping is collapsing fills into the background — that is the failure this variant exists to prevent, and the fix is in `palettes()` in `Ant.tsx`, not here.

- [ ] **Step 4: Commit**

```bash
npx prettier --write apps/mobile/src/components/AskBubble.tsx
git add apps/mobile/src/components/AskBubble.tsx
git commit -m "feat(mascot): the thing you ask has a face now"
```

---

### Task 9: The dashboard title

**Files:**

- Modify: `apps/mobile/app/(tabs)/index.tsx` — both title rows, plus `styles`

**Note:** Task 6 already edited this file, so any line number quoted here is
stale. Find the two title rows by their content, not by line.

**Interfaces:**

- Consumes: `Ant` from Task 5.

- [ ] **Step 1: Put the face beside the title**

In `apps/mobile/app/(tabs)/index.tsx`, both occurrences of:

```tsx
<Text style={[type.title, { color: theme.text }]}>{t('nav.dashboard')}</Text>
```

become:

```tsx
<View style={styles.titleRow}>
  <Ant pose="face" size={28} />
  <Text style={[type.title, { color: theme.text }]}>{t('nav.dashboard')}</Text>
</View>
```

Add to `StyleSheet.create`:

```ts
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
```

Add `import { Ant } from '../../src/components/mascot/Ant';`.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npx eslint "apps/mobile/app/(tabs)/index.tsx"`
Expected: no errors.

- [ ] **Step 3: See it**

Build. Expected: a small ant face left of "Resumen", vertically centred against the title's cap height, in both themes.

- [ ] **Step 4: Commit**

```bash
npx prettier --write "apps/mobile/app/(tabs)/index.tsx"
git add "apps/mobile/app/(tabs)/index.tsx"
git commit -m "feat(mascot): the dashboard says who is counting"
```

---

### Task 10: The import wait

**Files:**

- Modify: `apps/mobile/app/import.tsx` (imports, a new `WalkingAnt` component, and the confirm `Card` around line 404)

**Interfaces:**

- Consumes: `Ant` from Task 5; `useMotion` from `../src/design`.

- [ ] **Step 1: Add the walking ant**

In `apps/mobile/app/import.tsx`, add near the other local components:

```tsx
/**
 * The ant walks while a statement parses. `import.tsx` tracks a single `busy`
 * boolean, not a progress fraction, so this is a loop rather than a bar: it says
 * work is happening, and claims nothing about how much is left.
 *
 * Under reduce-motion the frame never advances and the ant simply stands with
 * its coin, because a looping animation is exactly what that setting is asking
 * us not to do.
 */
function WalkingAnt({ busy }: { busy: boolean }) {
  const motion = useMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!busy || !motion.enabled) return;
    const timer = setInterval(() => setFrame((f) => f + 1), 180);
    return () => clearInterval(timer);
  }, [busy, motion.enabled]);

  return <Ant pose={busy && motion.enabled ? 'walk' : 'carrying'} frame={frame} size={72} />;
}
```

Add to the imports: `import { Ant } from '../src/components/mascot/Ant';` and add `useMotion` to the existing `../src/design` import. `useState` and `useEffect` are already imported from `react` in this file; confirm before adding.

- [ ] **Step 2: Place it above the confirm button**

In the confirm `Card`, immediately before the `<Button label={t('import.confirm')} ... />` at line 404:

```tsx
<View style={styles.centred}>
  <WalkingAnt busy={busy} />
</View>
```

`styles.centred` already exists in this file and is used at line 310.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npx eslint apps/mobile/app/import.tsx`
Expected: no errors.

- [ ] **Step 4: Verify the reduce-motion path**

Run: `xcrun simctl ui booted increase_contrast disable` then enable reduce motion in the simulator (Settings → Accessibility → Motion → Reduce Motion). Import a statement.

Expected with reduce motion **on**: the ant stands with its coin and never animates. Expected with it **off**: the legs step while the import runs, and the ant settles into `carrying` when it finishes.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/mobile/app/import.tsx
git add apps/mobile/app/import.tsx
git commit -m "feat(mascot): something to watch while the statement is read"
```

---

### Task 11: Close the branch

**Files:**

- Modify: `docs/superpowers/specs/2026-09-08-ant-mascot-ui-design.md` if anything was learned that contradicts it

- [ ] **Step 1: Full verification**

Run:

```bash
npm run typecheck
npx vitest run
npm run icons
npx tsx scripts/compare-pngs.ts .superpowers/sdd/2026-09-08-ant-mascot-ui/icon-baseline apps/mobile/assets
```

Expected: no type errors; all tests pass; `all six match`. The last one matters
most — it proves the whole feature landed without moving the shipped icon.

- [ ] **Step 2: Update the spec if reality differed**

If any task revealed the spec was wrong — as the `Empty` count and the ask bubble's fill already did — correct it and say so in the commit body. A spec that records what was actually built is worth keeping; one that records what was imagined is not.

- [ ] **Step 3: Merge**

```bash
git checkout main
git merge --no-ff ant-mascot-ui -m "merge: the ant moved in"
```

The owner runs `git push`.

---

## Self-Review

**Spec coverage.** Geometry-as-data → Tasks 1 and 4. Icon generation and the pixel-identity criterion → Tasks 2, 3 and 11. `Ant.tsx` and the colour-role table → Task 5. Empty states → Tasks 6 and 7. Assistant → Task 8. Dashboard header → Task 9. Import and motion → Task 10. Accessibility → built into `Ant` in Task 5, asserted in Tasks 8 and 10. Testing → Tasks 1 and 4. The spec's "not the tab bar" is a non-goal and correctly has no task.

**Known soft spot.** Task 4's `swing()` parses path data with a regular expression to shift leg points. That is the one place in this plan where the implementation could pass its tests and still look wrong, because the tests assert that leg geometry _changed_, not that it changed _well_. Whoever implements Task 4 must look at the walking ant on a device before calling it done; if the legs detach or the swing reads as a glitch, replace `swing()` with four hand-written leg path sets rather than fighting the regex.

**Type consistency.** `Part` carries `id`, `kind`, optional `fill`/`stroke`/`width`/`transform`/`monoCut` in Task 1 and is used with exactly those names in Tasks 2, 3, 4 and 5. `mascot(pose, frame)` has the same signature everywhere. `Empty({ message })` matches the existing call sites in `index.tsx` unchanged. `Ant` props `pose`/`size`/`frame`/`variant` are used consistently in Tasks 6 through 10.
