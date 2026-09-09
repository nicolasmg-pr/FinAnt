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

  /**
   * The previous two tests both still pass if every leg swings together: a
   * single shared offset also "differs from" frame 1's neutral pose and also
   * wraps at frame 4. Neither one would catch a regression that collapsed
   * the alternating-tripod gait back into one group. This test reads the
   * actual horizontal shift out of each leg's own path data — never a pinned
   * `d` string, which would just teach the next geometry tweak to delete the
   * test — and requires two named legs (one from each group, per the
   * grouping documented next to `WALK_GROUP_A` in mascot.ts) to move in
   * opposite directions, with at least one leg moving each way.
   */
  it('walk swings its two leg groups in opposite directions', () => {
    /** Every x from an `M x y L x y L x y ...` path, in order. */
    const xCoords = (d: string): number[] =>
      (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);

    const legPaths = (parts: readonly Part[]) =>
      new Map(
        parts
          .filter((p): p is Extract<Part, { kind: 'path' }> => p.kind === 'path')
          .filter((p) => p.id.startsWith('leg-'))
          .map((p) => [p.id, p.d] as const),
      );

    const rest = legPaths(mascot('carrying').parts);
    const legIds = [...rest.keys()];
    expect(legIds.length).toBeGreaterThan(0);

    /** Sum of how far every point on leg `id` moved horizontally at `frame`,
     * relative to its rest position in `carrying`. Positive or negative
     * according to which way the leg swung; zero if it did not move. */
    const totalDx = (id: string, frame: number): number => {
      const restD = rest.get(id);
      const walkD = legPaths(mascot('walk', frame).parts).get(id);
      if (restD === undefined || walkD === undefined) {
        throw new Error(`expected a leg path named ${id} in both poses`);
      }
      const a = xCoords(restD);
      const b = xCoords(walkD);
      return a.reduce((sum, x, i) => sum + ((b[i] ?? x) - x), 0);
    };

    // The frame where the legs are furthest from rest, found by measurement
    // rather than assumed to be a particular index, so this does not depend
    // on which frame the gait happens to put its extremes on.
    let extremeFrame = 0;
    let extremeSpread = -Infinity;
    for (let frame = 0; frame < 4; frame++) {
      const spread = legIds.reduce((sum, id) => sum + Math.abs(totalDx(id, frame)), 0);
      if (spread > extremeSpread) {
        extremeSpread = spread;
        extremeFrame = frame;
      }
    }
    expect(extremeSpread).toBeGreaterThan(0);

    // A leg from each side of the gait (see the grouping documented next to
    // `WALK_GROUP_A` in mascot.ts): they must move, and they must move apart.
    const groupA = totalDx('leg-front-2', extremeFrame);
    const groupB = totalDx('leg-rear', extremeFrame);
    expect(groupA).not.toBe(0);
    expect(groupB).not.toBe(0);
    expect(Math.sign(groupA)).not.toBe(Math.sign(groupB));

    // A collapse into one group would move every leg the same way; the real
    // gait moves at least one leg in each direction on its extreme frame.
    const displacements = legIds.map((id) => totalDx(id, extremeFrame));
    expect(displacements.some((dx) => dx > 0)).toBe(true);
    expect(displacements.some((dx) => dx < 0)).toBe(true);
  });
});
