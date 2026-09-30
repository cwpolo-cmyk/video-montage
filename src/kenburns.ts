import { FPS, PHOTO_LEN } from './constants';
import type { Rect } from './crop';

export type KenBurns = 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';

export const KEN_BURNS_OPTIONS: { id: KenBurns; label: string; icon: string }[] = [
  { id: 'zoomIn', label: 'Zoom in', icon: '⊕' },
  { id: 'zoomOut', label: 'Zoom out', icon: '⊖' },
  { id: 'panLeft', label: 'Pan left', icon: '←' },
  { id: 'panRight', label: 'Pan right', icon: '→' },
];

export const DEFAULT_KEN_BURNS: KenBurns = 'zoomIn';

/** Subtle on purpose: a photo is only on screen for 1.5 s. */
export const KB_ZOOM = 1.07;
/** Pans run at this zoom so there is room to move inside the crop. */
export const KB_PAN_ZOOM = 1.06;
/** Share of the available slack a pan travels (leaves a small margin at both ends). */
const KB_PAN_TRAVEL = 0.8;

/** Smooth ease-in-out: zero velocity at both ends, no sudden start or stop. */
export function easeInOutSine(p: number): number {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

/** Number of output frames a clip of `seconds` occupies. */
export function frameCount(seconds: number): number {
  return Math.round(seconds * FPS);
}

/**
 * Progress 0..1 for a time inside a photo. The last frame lands exactly on 1 so
 * the motion finishes rather than stopping one frame short.
 */
export function photoProgress(t: number, seconds = PHOTO_LEN): number {
  const last = (frameCount(seconds) - 1) / FPS;
  return last > 0 ? Math.min(1, Math.max(0, t / last)) : 0;
}

/**
 * The visible source rect at progress `p`, moving inside the user's crop `base`
 * (so the motion never reveals anything outside their framing).
 */
export function kenBurnsRect(base: Rect, effect: KenBurns, p: number): Rect {
  const e = easeInOutSine(p);
  const cx = base.x + base.w / 2;
  const cy = base.y + base.h / 2;
  let zoom: number;
  let dx = 0;
  switch (effect) {
    case 'zoomIn':
      zoom = 1 + (KB_ZOOM - 1) * e;
      break;
    case 'zoomOut':
      zoom = KB_ZOOM - (KB_ZOOM - 1) * e;
      break;
    case 'panLeft':
    case 'panRight': {
      zoom = KB_PAN_ZOOM;
      const slack = (base.w - base.w / zoom) / 2;
      const dir = effect === 'panRight' ? 1 : -1;
      // Travel from one side of the slack to the other.
      dx = dir * slack * KB_PAN_TRAVEL * (2 * e - 1);
      break;
    }
  }
  const w = base.w / zoom;
  const h = base.h / zoom;
  return { x: cx + dx - w / 2, y: cy - h / 2, w, h };
}
