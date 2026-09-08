import { describe, expect, it } from 'vitest';
import { grainSpacing, segmentsFor } from '../trail';

describe('segmentsFor', () => {
  it('splits a wide track into grains no thinner than 4px', () => {
    const geometry = segmentsFor(300, [1]);
    expect(geometry.mode).toBe('segmented');
    if (geometry.mode !== 'segmented') return;
    expect(geometry.total).toBe(24);
    expect(geometry.size).toBeGreaterThanOrEqual(4);
    expect(geometry.filled).toEqual([24]);
  });

  it('falls back to a continuous fill when six grains would not fit', () => {
    const geometry = segmentsFor(20, [0.5]);
    expect(geometry.mode).toBe('continuous');
    if (geometry.mode !== 'continuous') return;
    expect(geometry.widths).toEqual([10]);
  });

  it('rounds a partial grain down', () => {
    const geometry = segmentsFor(300, [0.5]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    // 0.5 * 24 = 12 exactly; 0.54 * 24 = 12.96 must still be twelve.
    expect(geometry.filled).toEqual([12]);
    const nearly = segmentsFor(300, [0.54]);
    if (nearly.mode !== 'segmented') throw new Error('expected segments');
    expect(nearly.filled).toEqual([12]);
  });

  it('never hides a part that carried something', () => {
    const geometry = segmentsFor(300, [0.001]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    expect(geometry.filled).toEqual([1]);
  });

  it('draws nothing for a part that carried nothing', () => {
    const geometry = segmentsFor(300, [0]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    expect(geometry.filled).toEqual([0]);
  });

  it('truncates the last part rather than scaling every part down', () => {
    const geometry = segmentsFor(300, [0.8, 0.8]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    expect(geometry.filled).toEqual([19, 5]);
    expect(geometry.filled.reduce((sum, n) => sum + n, 0)).toBe(geometry.total);
  });

  it('treats a broken ratio as nothing and an impossible one as everything', () => {
    // NaN and Infinity are broken and carry nothing; a finite 5 is merely a
    // full bar; a negative is nothing. The 5 takes the whole track, so the
    // negative would be truncated to zero even if it were not already zero.
    const geometry = segmentsFor(300, [Number.NaN, 5, -1, Number.POSITIVE_INFINITY]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    expect(geometry.filled).toEqual([0, 24, 0, 0]);
  });

  it('survives a zero width', () => {
    const geometry = segmentsFor(0, [0.5]);
    expect(geometry.mode).toBe('continuous');
    if (geometry.mode !== 'continuous') return;
    expect(geometry.widths).toEqual([0]);
  });
});

describe('grainSpacing', () => {
  it('spaces grains further apart the less history there is', () => {
    expect(grainSpacing('high')).toBeLessThan(grainSpacing('medium'));
    expect(grainSpacing('medium')).toBeLessThan(grainSpacing('low'));
  });
});
