/** Pure per-frame image measurements used by the auto-trim scorer. */

export function toGray(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = 0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2];
  }
  return g;
}

/** Variance of the 4-neighbour Laplacian — the classic focus/blur measure. */
export function laplacianVariance(g: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  if (!n) return 0;
  const m = sum / n;
  return sum2 / n - m * m;
}

export interface LumaStats {
  mean: number;
  contrast: number;
  darkFrac: number;
  clipFrac: number;
}

export function lumaStats(g: Float32Array): LumaStats {
  let s = 0;
  let s2 = 0;
  let dark = 0;
  let clip = 0;
  for (let i = 0; i < g.length; i++) {
    const v = g[i];
    s += v;
    s2 += v * v;
    if (v < 20) dark++;
    else if (v > 247) clip++;
  }
  const n = g.length || 1;
  const mean = s / n;
  return {
    mean: mean / 255,
    contrast: Math.sqrt(Math.max(0, s2 / n - mean * mean)) / 255,
    darkFrac: dark / n,
    clipFrac: clip / n,
  };
}

/**
 * Edge energy in the central region relative to the whole frame. >1 means detail
 * is concentrated in the middle — a rough "clear subject" signal.
 */
export function centerFocus(g: Float32Array, w: number, h: number): number {
  let all = 0;
  let center = 0;
  let nAll = 0;
  let nCenter = 0;
  const x0 = w * 0.25;
  const x1 = w * 0.75;
  const y0 = h * 0.2;
  const y1 = h * 0.8;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const e = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
      all += e;
      nAll++;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        center += e;
        nCenter++;
      }
    }
  }
  if (!nCenter || all <= 1e-6) return 1;
  return center / nCenter / (all / nAll);
}

/** Box downsample by an integer factor. */
export function downsample(g: Float32Array, w: number, h: number, f: number) {
  const ow = Math.floor(w / f);
  const oh = Math.floor(h / f);
  const out = new Float32Array(ow * oh);
  const inv = 1 / (f * f);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let s = 0;
      for (let yy = 0; yy < f; yy++) {
        const row = (y * f + yy) * w + x * f;
        for (let xx = 0; xx < f; xx++) s += g[row + xx];
      }
      out[y * ow + x] = s * inv;
    }
  }
  return { data: out, w: ow, h: oh };
}

export interface ShiftResult {
  dx: number;
  dy: number;
  /** Mean abs difference after compensating the global shift. */
  residual: number;
}

/**
 * Global translation between two frames by exhaustive block matching over the
 * central region. Content that `cur` shows at (x, y) was at (x - dx, y - dy) in `prev`.
 */
export function globalShift(prev: Float32Array, cur: Float32Array, w: number, h: number, radius = 6): ShiftResult {
  const mx = radius + Math.floor(w * 0.05);
  const my = radius + Math.floor(h * 0.05);
  let best = Infinity;
  let bdx = 0;
  let bdy = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      let s = 0;
      let n = 0;
      for (let y = my; y < h - my; y += 1) {
        const rc = y * w;
        const rp = (y - dy) * w - dx;
        for (let x = mx; x < w - mx; x += 1) {
          s += Math.abs(cur[rc + x] - prev[rp + x]);
          n++;
        }
      }
      const m = s / n;
      // Tiny bias towards zero motion so flat frames don't report phantom shifts.
      const cost = m + 0.02 * (Math.abs(dx) + Math.abs(dy));
      if (cost < best) {
        best = cost;
        bdx = dx;
        bdy = dy;
      }
    }
  }
  let s = 0;
  let n = 0;
  for (let y = my; y < h - my; y++) {
    for (let x = mx; x < w - mx; x++) {
      s += Math.abs(cur[y * w + x] - prev[(y - bdy) * w + x - bdx]);
      n++;
    }
  }
  return { dx: bdx, dy: bdy, residual: s / n };
}
