import { describe, expect, it } from 'vitest';
import { hdrPixelToSrgb, hlgInverseOetf, pqEotf, rolloff } from '../../src/gl/color';

// 10-bit limited-range code for a normalized signal value.
const Y = (e: number) => 64 + e * 876;

describe('HDR -> SDR', () => {
  it('HLG inverse OETF is continuous at 0.5 and reaches 1 at 1', () => {
    expect(hlgInverseOetf(0.5)).toBeCloseTo(1 / 12, 4);
    expect(hlgInverseOetf(0.5 + 1e-6)).toBeCloseTo(1 / 12, 4);
    expect(hlgInverseOetf(1)).toBeCloseTo(1, 3);
  });

  it('PQ EOTF hits known points', () => {
    expect(pqEotf(0)).toBeCloseTo(0, 5);
    expect(pqEotf(1)).toBeCloseTo(10000, 0);
    // PQ 0.58 ≈ 203 nits (BT.2408 reference white)
    expect(pqEotf(0.58)).toBeGreaterThan(190);
    expect(pqEotf(0.58)).toBeLessThan(215);
  });

  it('roll-off is identity below the knee, smooth and bounded above it', () => {
    expect(rolloff(0.5)).toBe(0.5);
    expect(rolloff(1)).toBeLessThan(1);
    expect(rolloff(1)).toBeGreaterThan(0.9);
    expect(rolloff(100)).toBeLessThanOrEqual(1);
  });

  it('HLG reference white (75%) maps to near-white SDR, not grey or clipped', () => {
    const [r, g, b] = hdrPixelToSrgb(Y(0.75), 512, 512, 'hlg');
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThanOrEqual(1);
    expect(Math.abs(r - g)).toBeLessThan(0.01);
    expect(Math.abs(r - b)).toBeLessThan(0.01);
  });

  it('HLG black stays black and mid-grey stays mid', () => {
    expect(hdrPixelToSrgb(64, 512, 512, 'hlg')[0]).toBeCloseTo(0, 3);
    const mid = hdrPixelToSrgb(Y(0.4), 512, 512, 'hlg')[0];
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('bright HDR highlights never exceed SDR white', () => {
    for (const e of [0.9, 0.95, 1]) {
      for (const c of hdrPixelToSrgb(Y(e), 512, 512, 'hlg')) expect(c).toBeLessThanOrEqual(1);
      for (const c of hdrPixelToSrgb(Y(e), 512, 512, 'pq')) expect(c).toBeLessThanOrEqual(1);
    }
  });
});
