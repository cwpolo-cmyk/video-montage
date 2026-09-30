import type { VideoSample } from 'mediabunny';
import { Renderer, type UprightTexture } from '../gl/renderer';
import type { Transfer } from '../types';

/**
 * A small offscreen renderer used for analysis and thumbnails. It runs the same
 * conversion shaders as the preview, so HDR clips are measured as they will look.
 */
class Utility {
  readonly renderer: Renderer;
  readonly upright: UprightTexture;
  constructor() {
    this.renderer = new Renderer(new OffscreenCanvas(16, 16));
    this.upright = this.renderer.createUpright();
  }
}

let util: Utility | null = null;
function utility() {
  util ??= new Utility();
  return util;
}

export function fitSize(w: number, h: number, maxSide: number) {
  const s = maxSide / Math.max(w, h);
  return { w: Math.max(2, Math.round(w * s)), h: Math.max(2, Math.round(h * s)) };
}

export interface Pixels {
  data: Uint8Array;
  w: number;
  h: number;
}

// All utility renders are serialized: they share one GL context and texture.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

/** Renders a whole video sample upright, scaled to fit `maxSide`. Does not close the sample. */
export function renderSample(sample: VideoSample, transfer: Transfer, maxSide: number): Promise<Pixels> {
  return serial(async () => {
    const u = utility();
    const frame = sample.toVideoFrame();
    try {
      await u.renderer.loadFrame(u.upright, { image: frame, rotation: sample.rotation as 0, transfer });
    } finally {
      frame.close();
    }
    return draw(u, maxSide);
  });
}

export function renderBitmap(bmp: ImageBitmap, maxSide: number): Promise<Pixels> {
  return serial(async () => {
    const u = utility();
    await u.renderer.loadFrame(u.upright, { image: bmp, rotation: 0, transfer: 'sdr' });
    return draw(u, maxSide);
  });
}

function draw(u: Utility, maxSide: number): Pixels {
  const { w, h } = fitSize(u.upright.width, u.upright.height, maxSide);
  const c = u.renderer.canvas;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  u.renderer.drawLayers([{ src: u.upright, rect: { x: 0, y: 0, w: 1, h: 1 }, opacity: 1 }]);
  return { data: u.renderer.readPixels(), w, h };
}

export function pixelsToImageData(p: Pixels): ImageData {
  return new ImageData(new Uint8ClampedArray(p.data.buffer as ArrayBuffer, p.data.byteOffset, p.data.byteLength), p.w, p.h);
}

/** Small JPEG data URL (for lists and the filmstrip). */
export function pixelsToDataUrl(p: Pixels, maxSide = 160): string {
  const src = document.createElement('canvas');
  src.width = p.w;
  src.height = p.h;
  src.getContext('2d')!.putImageData(pixelsToImageData(p), 0, 0);
  const { w, h } = fitSize(p.w, p.h, maxSide);
  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return dst.toDataURL('image/jpeg', 0.75);
}
