import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, learnFromEdit, positionPrior, type Prefs } from '../../src/analysis/preferences';
import { frameFeatures, pickBestWindow, windowFeatures } from '../../src/analysis/scoring';
import type { FrameMetrics } from '../../src/types';

const good: Omit<FrameMetrics, 't'> = {
  lapVar: 800, meanLuma: 0.5, darkFrac: 0, clipFrac: 0, contrast: 0.22, centerFocus: 1.2,
  gdx: 0, gdy: 0, residual: 6, face: 0,
};

/** 8 s clip, 10 samples/s, with sections overridden. */
function clip(sections: { from: number; to: number; m: Partial<FrameMetrics> | ((i: number) => Partial<FrameMetrics>) }[]) {
  const frames: FrameMetrics[] = [];
  for (let i = 0; i < 80; i++) {
    const t = i / 10;
    let f: FrameMetrics = { t, ...good };
    for (const s of sections) if (t >= s.from && t < s.to) f = { ...f, ...(typeof s.m === 'function' ? s.m(i) : s.m) };
    frames.push(f);
  }
  return frames;
}

describe('auto-trim scoring', () => {
  it('avoids blurry, dark and shaky sections', () => {
    const frames = clip([
      { from: 0, to: 2, m: { lapVar: 20 } },
      { from: 4, to: 6, m: { meanLuma: 0.04, darkFrac: 0.95, lapVar: 60 } },
      { from: 6, to: 8, m: (i) => ({ gdx: i % 2 ? 5 : -5, gdy: i % 3 ? -4 : 4 }) },
    ]);
    const best = pickBestWindow(frames, 8, DEFAULT_PREFS);
    expect(best.start).toBeGreaterThanOrEqual(2);
    expect(best.start + best.length).toBeLessThanOrEqual(4.05);
    expect(best.length).toBeGreaterThanOrEqual(1.5);
    expect(best.length).toBeLessThanOrEqual(2);
  });

  it('prefers a section with a clear face', () => {
    const frames = clip([{ from: 5, to: 7, m: { face: 0.95 } }]);
    const best = pickBestWindow(frames, 8, DEFAULT_PREFS);
    expect(best.start).toBeGreaterThanOrEqual(4.9);
    expect(best.start + best.length).toBeLessThanOrEqual(7.05);
  });

  it('a smooth pan is not treated as shake', () => {
    const frames = clip([{ from: 0, to: 8, m: { gdx: 3 } }]);
    const f = frameFeatures(frames);
    expect(f[40].steady).toBeGreaterThan(0.95);
  });

  it('never picks outside 1.5–2.0 s, and handles short clips', () => {
    const frames = clip([]).filter((f) => f.t < 1.2);
    const best = pickBestWindow(frames, 1.2, DEFAULT_PREFS);
    expect(best.start).toBe(0);
    expect(best.length).toBeCloseTo(1.2);
  });
});

describe('learning from edits', () => {
  it('learns a position preference and applies it to new videos', () => {
    // Uniform clips: auto pick is arbitrary; user always moves to the end.
    let prefs: Prefs = DEFAULT_PREFS;
    const frames = clip([]);
    const feats = frameFeatures(frames);
    for (let k = 0; k < 4; k++) {
      const auto = pickBestWindow(frames, 8, prefs);
      prefs = learnFromEdit(prefs, {
        user: windowFeatures(frames, feats, 6, 2).mean,
        auto: auto.features,
        userPos: 1,
        userLen: 2,
      });
    }
    expect(positionPrior(prefs).mean).toBeCloseTo(1);
    const next = pickBestWindow(clip([]), 8, prefs);
    expect(next.start).toBeGreaterThan(5.5);
    expect(prefs.lengthPref).toBeGreaterThan(1.9);
  });

  it('shifts feature weights towards what the user chose', () => {
    // User repeatedly picks the high-motion section over the sharper static one.
    const frames = clip([
      { from: 0, to: 4, m: { residual: 0.2, lapVar: 900 } },
      { from: 4, to: 8, m: { residual: 12, lapVar: 500 } },
    ]);
    let prefs: Prefs = DEFAULT_PREFS;
    const feats = frameFeatures(frames);
    const auto = pickBestWindow(frames, 8, prefs);
    for (let k = 0; k < 5; k++) {
      prefs = learnFromEdit(prefs, {
        user: windowFeatures(frames, feats, 5, 2).mean,
        auto: windowFeatures(frames, feats, 1, 2).mean,
        userPos: 0.83,
        userLen: 2,
      });
    }
    expect(prefs.weights.motion).toBeGreaterThan(DEFAULT_PREFS.weights.motion);
    expect(prefs.weights.sharp).toBeLessThan(DEFAULT_PREFS.weights.sharp);
    // A new clip with the same trade-off now gets the motion section.
    const next = pickBestWindow(frames, 8, { ...prefs, positions: [] });
    expect(next.start).toBeGreaterThanOrEqual(4);
    expect(auto).toBeTruthy();
  });

  it('weights stay bounded', () => {
    let prefs: Prefs = DEFAULT_PREFS;
    const hi = { sharp: 1, light: 1, face: 1, subject: 1, motion: 1, steady: 1 };
    const lo = { sharp: 0, light: 0, face: 0, subject: 0, motion: 0, steady: 0 };
    for (let k = 0; k < 200; k++) prefs = learnFromEdit(prefs, { user: { ...lo, motion: 1 }, auto: { ...hi, motion: 0 }, userPos: 0.5, userLen: 1.75 });
    for (const v of Object.values(prefs.weights)) {
      expect(v).toBeGreaterThanOrEqual(0.1);
      expect(v).toBeLessThanOrEqual(3);
    }
  });
});
