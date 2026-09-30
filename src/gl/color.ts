/**
 * HDR -> SDR conversion math. The GLSL in shaders.ts mirrors these functions
 * exactly; this CPU version exists so the math can be unit tested.
 *
 * Pipeline for 10-bit BT.2020 (iPhone HLG, or PQ/HDR10):
 *   limited-range YCbCr -> non-linear R'G'B' (BT.2020 NCL matrix)
 *   -> inverse transfer to display light, scaled so HDR reference white (203 nits) = 1.0
 *   -> soft roll-off of highlights on max(R,G,B) (hue preserving)
 *   -> BT.2020 -> BT.709 primaries -> sRGB encoding.
 */

export type Vec3 = [number, number, number];

const HLG_A = 0.17883277;
const HLG_B = 0.28466892;
const HLG_C = 0.55991073;

/** HLG nominal peak, and the BT.2408 reference white. */
export const HLG_PEAK_NITS = 1000;
export const REF_WHITE_NITS = 203;

/** Highlights above this (in reference-white units) are compressed smoothly towards 1.0. */
export const ROLLOFF_KNEE = 0.75;

export function hlgInverseOetf(e: number): number {
  e = Math.max(e, 0);
  return e <= 0.5 ? (e * e) / 3 : (Math.exp((e - HLG_C) / HLG_A) + HLG_B) / 12;
}

const PQ_M1 = 2610 / 16384;
const PQ_M2 = (2523 / 4096) * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = (2413 / 4096) * 32;
const PQ_C3 = (2392 / 4096) * 32;

/** PQ EOTF, returns nits. */
export function pqEotf(e: number): number {
  const p = Math.pow(Math.max(e, 0), 1 / PQ_M2);
  return 10000 * Math.pow(Math.max(p - PQ_C1, 0) / (PQ_C2 - PQ_C3 * p), 1 / PQ_M1);
}

/** BT.2020 luminance coefficients. */
const LR = 0.2627;
const LG = 0.678;
const LB = 0.0593;

/** HLG scene light -> display light via the BT.2100 OOTF (gamma 1.2 at 1000 nits), in ref-white units. */
export function hlgToRefWhite(rgbScene: Vec3): Vec3 {
  const ys = LR * rgbScene[0] + LG * rgbScene[1] + LB * rgbScene[2];
  const gain = Math.pow(Math.max(ys, 1e-6), 1.2 - 1) * (HLG_PEAK_NITS / REF_WHITE_NITS);
  return [rgbScene[0] * gain, rgbScene[1] * gain, rgbScene[2] * gain];
}

export function rolloff(x: number): number {
  if (x <= ROLLOFF_KNEE) return x;
  const k = ROLLOFF_KNEE;
  return k + (1 - k) * Math.tanh((x - k) / (1 - k));
}

/** Compress highlights on max channel so hue is preserved. */
export function toneMap(rgb: Vec3): Vec3 {
  const m = Math.max(rgb[0], rgb[1], rgb[2]);
  if (m <= ROLLOFF_KNEE) return rgb;
  const s = rolloff(m) / m;
  return [rgb[0] * s, rgb[1] * s, rgb[2] * s];
}

/** Linear BT.2020 -> linear BT.709 primaries. */
export const BT2020_TO_BT709: number[] = [
  1.6605, -0.5876, -0.0728,
  -0.1246, 1.1329, -0.0083,
  -0.0182, -0.1006, 1.1187,
];

export function mat3(m: number[], v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function srgbOetf(x: number): number {
  x = Math.min(Math.max(x, 0), 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** 10-bit limited-range YCbCr (code values) -> non-linear BT.2020 R'G'B'. */
export function ycbcr10ToRgb2020(y: number, cb: number, cr: number): Vec3 {
  const Y = (y - 64) / 876;
  const U = (cb - 512) / 896;
  const V = (cr - 512) / 896;
  return [Y + 1.4746 * V, Y - 0.16455 * U - 0.57135 * V, Y + 1.8814 * U];
}

/** Full HDR decode for one pixel: returns sRGB 0..1. */
export function hdrPixelToSrgb(y: number, cb: number, cr: number, transfer: 'hlg' | 'pq'): Vec3 {
  const e = ycbcr10ToRgb2020(y, cb, cr);
  let lin: Vec3;
  if (transfer === 'hlg') {
    lin = hlgToRefWhite([hlgInverseOetf(e[0]), hlgInverseOetf(e[1]), hlgInverseOetf(e[2])]);
  } else {
    lin = [pqEotf(e[0]) / REF_WHITE_NITS, pqEotf(e[1]) / REF_WHITE_NITS, pqEotf(e[2]) / REF_WHITE_NITS];
  }
  const rgb709 = mat3(BT2020_TO_BT709, lin).map((c) => Math.max(c, 0)) as Vec3;
  const tm = toneMap(rgb709);
  return [srgbOetf(tm[0]), srgbOetf(tm[1]), srgbOetf(tm[2])];
}
