import { describe, expect, it } from 'vitest';
import { globalShift, laplacianVariance, lumaStats } from '../../src/analysis/metrics';

function noise(w: number, h: number, seed = 1) {
  const g = new Float32Array(w * h);
  let s = seed;
  for (let i = 0; i < g.length; i++) {
    s = (s * 16807) % 2147483647;
    g[i] = (s % 256);
  }
  return g;
}
function blur(g: Float32Array, w: number, h: number, passes: number) {
  let a = g;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += a[yy * w + xx]; n++; }
          }
        b[y * w + x] = s / n;
      }
    a = b;
  }
  return a;
}
function shift(g: Float32Array, w: number, h: number, dx: number, dy: number) {
  const o = new Float32Array(g.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - dx));
      const sy = Math.min(h - 1, Math.max(0, y - dy));
      o[y * w + x] = g[sy * w + sx];
    }
  return o;
}

describe('metrics', () => {
  it('blur lowers Laplacian variance a lot', () => {
    const g = noise(80, 120);
    expect(laplacianVariance(g, 80, 120)).toBeGreaterThan(20 * laplacianVariance(blur(g, 80, 120, 3), 80, 120));
  });

  it('luma stats flag dark frames', () => {
    const dark = new Float32Array(100).fill(5);
    const s = lumaStats(dark);
    expect(s.darkFrac).toBe(1);
    expect(s.mean).toBeLessThan(0.05);
  });

  it('global shift recovers a camera translation with ~zero residual', () => {
    const a = blur(noise(64, 112, 7), 64, 112, 1);
    const b = shift(a, 64, 112, 3, -2);
    const r = globalShift(a, b, 64, 112);
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(-2);
    expect(r.residual).toBeLessThan(1);
  });
});
