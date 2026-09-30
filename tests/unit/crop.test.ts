import { describe, expect, it } from 'vitest';
import { clampCrop, cropRect, dragCrop, DEFAULT_CROP } from '../../src/crop';

describe('crop', () => {
  it('fills 9:16 from a 16:9 source by cropping the sides', () => {
    const r = cropRect(1920, 1080, DEFAULT_CROP);
    expect(r.h).toBeCloseTo(1);
    // Visible width = (1080 * 9/16) / 1920 of the source.
    expect(r.w).toBeCloseTo((1080 * 9) / 16 / 1920);
    expect(r.x).toBeCloseTo((1 - r.w) / 2);
  });

  it('never leaves the source (no black bars)', () => {
    const r = cropRect(1920, 1080, { cx: 0, cy: 0.5, zoom: 1 });
    expect(r.x).toBe(0);
    const r2 = cropRect(1920, 1080, { cx: 1, cy: 0.5, zoom: 1 });
    expect(r2.x + r2.w).toBeCloseTo(1);
  });

  it('dragging right reveals content on the left', () => {
    const c = dragCrop(1920, 1080, DEFAULT_CROP, 200, 0);
    expect(c.cx).toBeLessThan(0.5);
  });

  it('zoom shrinks the visible window', () => {
    const a = cropRect(1080, 1920, DEFAULT_CROP);
    const b = cropRect(1080, 1920, { ...DEFAULT_CROP, zoom: 2 });
    expect(a.w).toBeCloseTo(1);
    expect(b.w).toBeCloseTo(0.5);
    expect(b.h).toBeCloseTo(0.5);
  });

  it('clampCrop pulls unreachable centers back', () => {
    const c = clampCrop(1920, 1080, { cx: 0, cy: 0, zoom: 1 });
    expect(c.cy).toBeCloseTo(0.5);
    expect(c.cx).toBeGreaterThan(0.1);
  });
});
