import { describe, expect, it } from 'vitest';
import { FPS, PHOTO_LEN } from '../../src/constants';
import { cropRect, DEFAULT_CROP } from '../../src/crop';
import {
  easeInOutSine,
  frameCount,
  kenBurnsRect,
  KEN_BURNS_OPTIONS,
  photoProgress,
  type KenBurns,
} from '../../src/kenburns';
import { clipDuration, clipSourceRect } from '../../src/render/layout';
import type { Clip, MediaMeta } from '../../src/types';

const base = cropRect(4032, 3024, DEFAULT_CROP); // landscape photo cropped to 9:16
const inside = (r: { x: number; y: number; w: number; h: number }, b = base) =>
  r.x >= b.x - 1e-9 && r.y >= b.y - 1e-9 && r.x + r.w <= b.x + b.w + 1e-9 && r.y + r.h <= b.y + b.h + 1e-9;

describe('Ken Burns', () => {
  it('a photo is exactly 1.5 s = 45 frames', () => {
    expect(PHOTO_LEN).toBe(1.5);
    expect(frameCount(PHOTO_LEN)).toBe(45);
  });

  it('progress runs 0 → 1 across the 45 frames, landing exactly on the last frame', () => {
    expect(photoProgress(0)).toBe(0);
    expect(photoProgress(44 / FPS)).toBe(1);
    expect(photoProgress(22 / FPS)).toBeCloseTo(0.5);
  });

  it('easing starts and ends at rest (smooth)', () => {
    const d = 1e-4;
    expect(easeInOutSine(0)).toBe(0);
    expect(easeInOutSine(1)).toBe(1);
    expect((easeInOutSine(d) - easeInOutSine(0)) / d).toBeLessThan(0.01);
    expect((easeInOutSine(1) - easeInOutSine(1 - d)) / d).toBeLessThan(0.01);
    for (let p = 0; p < 1; p += 0.01) expect(easeInOutSine(p + 0.01)).toBeGreaterThanOrEqual(easeInOutSine(p));
  });

  it.each(KEN_BURNS_OPTIONS.map((o) => o.id))('%s never leaves the crop and keeps 9:16', (fx: KenBurns) => {
    for (let i = 0; i < 45; i++) {
      const r = kenBurnsRect(base, fx, i / 44);
      expect(inside(r)).toBe(true);
      expect(r.w / r.h).toBeCloseTo(base.w / base.h, 9);
    }
  });

  it('moves are subtle', () => {
    const zin = [kenBurnsRect(base, 'zoomIn', 0), kenBurnsRect(base, 'zoomIn', 1)];
    expect(zin[0].w).toBeCloseTo(base.w);
    expect(base.w / zin[1].w).toBeCloseTo(1.07);
    const zout = [kenBurnsRect(base, 'zoomOut', 0), kenBurnsRect(base, 'zoomOut', 1)];
    expect(base.w / zout[0].w).toBeCloseTo(1.07);
    expect(zout[1].w).toBeCloseTo(base.w);
    const pan = [kenBurnsRect(base, 'panRight', 0), kenBurnsRect(base, 'panRight', 1)];
    const travel = (pan[1].x - pan[0].x) / base.w;
    expect(travel).toBeGreaterThan(0.03);
    expect(travel).toBeLessThan(0.06);
  });

  it('pan left and pan right go opposite ways; zooms stay centered', () => {
    const l = [kenBurnsRect(base, 'panLeft', 0), kenBurnsRect(base, 'panLeft', 1)];
    const r = [kenBurnsRect(base, 'panRight', 0), kenBurnsRect(base, 'panRight', 1)];
    expect(l[1].x).toBeLessThan(l[0].x);
    expect(r[1].x).toBeGreaterThan(r[0].x);
    const z = kenBurnsRect(base, 'zoomIn', 1);
    expect(z.x + z.w / 2).toBeCloseTo(base.x + base.w / 2);
    expect(z.y + z.h / 2).toBeCloseTo(base.y + base.h / 2);
  });

  it('per-frame movement is small and continuous (no jumps)', () => {
    for (const { id } of KEN_BURNS_OPTIONS) {
      let prev = kenBurnsRect(base, id, 0);
      for (let i = 1; i < 45; i++) {
        const r = kenBurnsRect(base, id, i / 44);
        // Under ~0.25% of the frame per frame, measured on the output.
        expect(Math.abs(r.x - prev.x) / base.w).toBeLessThan(0.0025);
        expect(Math.abs(r.w - prev.w) / base.w).toBeLessThan(0.0035);
        prev = r;
      }
    }
  });

  it('layout uses Ken Burns for photos and the plain crop for videos', () => {
    const meta = { width: 4032, height: 3024 } as MediaMeta;
    const photo: Clip = { id: 'p', mediaId: 'm', kind: 'photo', crop: DEFAULT_CROP, cropUserSet: false, kenBurns: 'zoomIn' };
    const video: Clip = { ...photo, kind: 'video', kenBurns: undefined, trim: { start: 1, length: 1.8, autoStart: 1, autoLength: 1.8, userSet: false } };
    expect(clipDuration(photo)).toBe(1.5);
    expect(clipDuration(video)).toBe(1.8);
    expect(clipSourceRect(photo, meta, 44 / FPS).w).toBeLessThan(base.w);
    expect(clipSourceRect(video, meta, 1).w).toBeCloseTo(base.w);
  });
});
