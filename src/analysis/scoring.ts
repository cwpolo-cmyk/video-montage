import { VIDEO_MAX_LEN, VIDEO_MIN_LEN } from '../constants';
import type { FrameMetrics } from '../types';
import { positionPrior, type Prefs } from './preferences';

export const FEATURES = ['sharp', 'light', 'face', 'subject', 'motion', 'steady'] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureVec = Record<Feature, number>;

export const FEATURE_LABELS: Record<Feature, string> = {
  sharp: 'Sharp focus',
  light: 'Good lighting',
  face: 'Face',
  subject: 'Clear subject',
  motion: 'Interesting motion',
  steady: 'Steady camera',
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

/** Absolute floor for "sharp" so an all-blurry clip doesn't look perfectly sharp. */
const SHARP_FLOOR = 120;

/**
 * Camera shake per sample: how much the global motion changes direction/speed
 * between consecutive samples (smooth pans score ~0, handheld jitter scores high).
 */
export function shakeSeries(frames: FrameMetrics[]): number[] {
  const acc = frames.map((f, i) => {
    if (i === 0) return 0;
    const p = frames[i - 1];
    return Math.hypot(f.gdx - p.gdx, f.gdy - p.gdy);
  });
  if (acc.length > 1) acc[0] = acc[1];
  // Local average over ±2 samples.
  return acc.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(acc.length - 1, i + 2); j++) {
      s += acc[j];
      n++;
    }
    return s / n;
  });
}

/** Normalizes raw metrics into 0..1 features, relative to the clip where it helps. */
export function frameFeatures(frames: FrameMetrics[]): FeatureVec[] {
  const sharpRef = Math.max(percentile(frames.map((f) => f.lapVar), 0.9), SHARP_FLOOR);
  const shake = shakeSeries(frames);
  return frames.map((f, i) => {
    const bell = smoothstep(0.05, 0.3, f.meanLuma) * (1 - smoothstep(0.78, 0.97, f.meanLuma));
    return {
      sharp: clamp01(Math.sqrt(f.lapVar / sharpRef)),
      light: clamp01(bell - 0.6 * Math.max(0, f.darkFrac - 0.25) - 0.8 * f.clipFrac),
      face: clamp01(f.face),
      subject: clamp01(0.5 * Math.min(1, f.contrast / 0.2) + 0.5 * clamp01((f.centerFocus - 0.6) / 0.8)),
      motion: clamp01(1 - Math.exp(-f.residual / 4)),
      steady: clamp01(Math.exp(-shake[i] / 1.5)),
    };
  });
}

export function quality(f: FeatureVec, w: FeatureVec): number {
  let s = 0;
  let ws = 0;
  for (const k of FEATURES) {
    s += w[k] * f[k];
    ws += w[k];
  }
  return ws > 0 ? s / ws : 0;
}

export interface WindowScore {
  start: number;
  length: number;
  score: number;
  /** Mean features over the window — used for the "why" panel and learning. */
  features: FeatureVec;
  meanQ: number;
  minQ: number;
}

/** Aggregates features over [start, start+length). */
export function windowFeatures(frames: FrameMetrics[], feats: FeatureVec[], start: number, length: number) {
  const idx: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].t >= start - 1e-6 && frames[i].t < start + length - 1e-6) idx.push(i);
  }
  if (!idx.length) {
    // Very short clip or sparse samples: nearest frame.
    let best = 0;
    for (let i = 1; i < frames.length; i++) {
      if (Math.abs(frames[i].t - start) < Math.abs(frames[best].t - start)) best = i;
    }
    if (frames.length) idx.push(best);
  }
  const mean = Object.fromEntries(FEATURES.map((k) => [k, 0])) as FeatureVec;
  for (const i of idx) for (const k of FEATURES) mean[k] += feats[i][k] / idx.length;
  return { idx, mean };
}

export function scoreWindow(
  frames: FrameMetrics[],
  feats: FeatureVec[],
  duration: number,
  start: number,
  length: number,
  prefs: Prefs,
): WindowScore {
  const { idx, mean } = windowFeatures(frames, feats, start, length);
  let sum = 0;
  let min = Infinity;
  for (const i of idx) {
    const q = quality(feats[i], prefs.weights);
    sum += q;
    min = Math.min(min, q);
  }
  const meanQ = idx.length ? sum / idx.length : 0;
  const minQ = idx.length ? min : 0;
  let score = 0.75 * meanQ + 0.25 * minQ;

  const pos = positionPrior(prefs);
  const slack = duration - length;
  const rel = slack > 1e-6 ? start / slack : 0.5;
  score += 0.25 * pos.confidence * (1 - Math.abs(rel - pos.mean));
  score -= 0.15 * Math.abs(length - prefs.lengthPref);
  return { start, length, score, features: mean, meanQ, minQ };
}

export function candidateLengths(duration: number): number[] {
  if (duration <= VIDEO_MIN_LEN) return [duration];
  const out: number[] = [];
  for (let l = VIDEO_MIN_LEN; l <= Math.min(VIDEO_MAX_LEN, duration) + 1e-6; l += 0.1) out.push(round2(l));
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Picks the best 1.5–2.0 s window. */
export function pickBestWindow(frames: FrameMetrics[], duration: number, prefs: Prefs): WindowScore {
  const feats = frameFeatures(frames);
  let best: WindowScore | null = null;
  for (const length of candidateLengths(duration)) {
    const slack = Math.max(0, duration - length);
    const starts: number[] = [];
    for (let s = 0; s <= slack + 1e-6; s += 0.1) starts.push(round2(Math.min(s, slack)));
    if (starts[starts.length - 1] < slack - 1e-6) starts.push(round2(slack));
    for (const start of starts) {
      const w = scoreWindow(frames, feats, duration, start, length, prefs);
      if (!best || w.score > best.score + 1e-9) best = w;
    }
  }
  return best!;
}

/** Per-sample quality curve for the scrubber sparkline. */
export function qualityCurve(frames: FrameMetrics[], prefs: Prefs): number[] {
  return frameFeatures(frames).map((f) => quality(f, prefs.weights));
}
