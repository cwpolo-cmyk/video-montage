import { PHOTO_LEN } from '../constants';
import { cropRect, type Rect } from '../crop';
import { DEFAULT_KEN_BURNS, kenBurnsRect, photoProgress } from '../kenburns';
import type { Clip, MediaMeta } from '../types';

/** On-screen length of a clip in seconds. */
export function clipDuration(clip: Clip): number {
  return clip.kind === 'photo' ? PHOTO_LEN : (clip.trim?.length ?? 0);
}

/**
 * The source rect to show for a clip at clip-local time `t` (0 = first frame).
 * Shared by the preview and (later) export so they frame identically.
 */
export function clipSourceRect(clip: Clip, meta: MediaMeta, t: number): Rect {
  const base = cropRect(meta.width, meta.height, clip.crop);
  if (clip.kind !== 'photo') return base;
  return kenBurnsRect(base, clip.kenBurns ?? DEFAULT_KEN_BURNS, photoProgress(t));
}
