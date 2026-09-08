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
