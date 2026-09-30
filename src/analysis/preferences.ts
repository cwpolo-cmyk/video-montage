import type { FeatureVec } from './scoring';

/**
 * What the auto-trim has learned from the user's manual picks. Kept small and
 * explainable so it can be shown in the UI and reset.
 */
export interface Prefs {
  /** Relative importance of each scoring feature. */
  weights: FeatureVec;
  /** Relative start positions (0 = clip start, 1 = clip end) of the user's picks. */
  positions: number[];
  /** Preferred window length in seconds. */
  lengthPref: number;
  edits: number;
}

export const DEFAULT_WEIGHTS: FeatureVec = {
  sharp: 1,
  light: 1,
  face: 0.8,
  subject: 0.5,
  motion: 0.6,
  steady: 1,
};

export const DEFAULT_PREFS: Prefs = {
  weights: { ...DEFAULT_WEIGHTS },
  positions: [],
  lengthPref: 1.75,
  edits: 0,
};

const MAX_HISTORY = 20;
const LEARNING_RATE = 1.2;
const W_MIN = 0.1;
const W_MAX = 3;

export interface Edit {
  /** Mean features of the user's window and of the auto pick it replaced. */
  user: FeatureVec;
  auto: FeatureVec;
  /** Relative position (0..1) and length of the user's window. */
  userPos: number;
  userLen: number;
}

/**
 * Pairwise preference update: nudges weights towards the features where the user's
 * window beat the auto pick (and away from those where it lost). Multiplicative so
 * weights stay positive; the step shrinks once the model already agrees.
 */
export function learnFromEdit(prefs: Prefs, e: Edit): Prefs {
  const keys = Object.keys(prefs.weights) as (keyof FeatureVec)[];
  const wsum = keys.reduce((s, k) => s + prefs.weights[k], 0);
  const margin = keys.reduce((s, k) => s + prefs.weights[k] * (e.user[k] - e.auto[k]), 0) / wsum;
  const g = 1 - 1 / (1 + Math.exp(-8 * margin));
  const weights = { ...prefs.weights };
  for (const k of keys) {
    const d = e.user[k] - e.auto[k];
    weights[k] = Math.min(W_MAX, Math.max(W_MIN, weights[k] * Math.exp(LEARNING_RATE * g * d)));
  }
  return {
    weights,
    positions: [...prefs.positions, e.userPos].slice(-MAX_HISTORY),
    lengthPref: prefs.lengthPref + 0.3 * (e.userLen - prefs.lengthPref),
    edits: prefs.edits + 1,
  };
}

/**
 * Where in a clip the user tends to pick, and how consistently. Confidence grows
 * with the number of edits and shrinks with their spread.
 */
export function positionPrior(prefs: Prefs): { mean: number; confidence: number } {
  const p = prefs.positions;
  if (!p.length) return { mean: 0.5, confidence: 0 };
  const mean = p.reduce((a, b) => a + b, 0) / p.length;
  const std = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / p.length);
  const confidence = (p.length / (p.length + 2)) * Math.max(0, Math.min(1, 1 - std / 0.3));
  return { mean, confidence };
}
