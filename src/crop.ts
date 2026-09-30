import { MAX_ZOOM, OUT_H, OUT_W } from './constants';
import type { Crop } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_CROP: Crop = { cx: 0.5, cy: 0.5, zoom: 1 };

/**
 * Visible source region (normalized 0..1 source coordinates) for a crop.
 * The source is scaled to cover the output, then zoomed; the window is clamped so
 * it never leaves the source (no black bars).
 */
export function cropRect(srcW: number, srcH: number, crop: Crop, outW = OUT_W, outH = OUT_H): Rect {
  const zoom = Math.min(Math.max(crop.zoom, 1), MAX_ZOOM);
  const scale = Math.max(outW / srcW, outH / srcH) * zoom;
  const w = outW / scale / srcW;
  const h = outH / scale / srcH;
  const x = clamp(crop.cx - w / 2, 0, 1 - w);
  const y = clamp(crop.cy - h / 2, 0, 1 - h);
  return { x, y, w, h };
}

/** Normalize a crop so its center is reachable (keeps stored values tidy after drags). */
export function clampCrop(srcW: number, srcH: number, crop: Crop): Crop {
  const zoom = Math.min(Math.max(crop.zoom, 1), MAX_ZOOM);
  const r = cropRect(srcW, srcH, { ...crop, zoom });
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, zoom };
}

/**
 * Move the crop by a drag measured in output pixels. Dragging right moves the
 * image right, i.e. the window moves left.
 */
export function dragCrop(srcW: number, srcH: number, crop: Crop, dxOut: number, dyOut: number): Crop {
  const r = cropRect(srcW, srcH, crop);
  return clampCrop(srcW, srcH, {
    ...crop,
    cx: r.x + r.w / 2 - (dxOut / OUT_W) * r.w,
    cy: r.y + r.h / 2 - (dyOut / OUT_H) * r.h,
  });
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
