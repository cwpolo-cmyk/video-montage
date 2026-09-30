import { FPS, OUT_H, OUT_W } from '../constants';
import { frameCount } from '../kenburns';
import { Renderer, type UprightTexture } from '../gl/renderer';
import { getPhoto } from '../media/photo';
import { getVideoFile } from '../media/videoFile';
import { clipDuration, clipSourceRect } from '../render/layout';
import { getMediaBlob } from '../store/db';
import type { Clip, MediaMeta } from '../types';

export interface ShowRequest {
  clip: Clip;
  meta: MediaMeta;
  /** Source time for videos; time within the clip (0..1.5 s) for photos. */
  t: number;
}

/**
 * Drives the 1080x1920 preview canvas for a single clip: shows any frame, and
 * loops playback of the trimmed window. Requests are "latest wins" so scrubbing
 * never queues up stale decodes.
 */
export class ClipPreview {
  readonly renderer: Renderer;
  private upright: UprightTexture;
  private uprightKey = '';
  private busy = false;
  private pending: (() => Promise<void>) | null = null;
  private playToken = 0;
  /** Clip-local time used for photo motion. */
  private photoT = 0;
  onFrame?: (t: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    this.renderer = new Renderer(canvas);
    this.upright = this.renderer.createUpright();
  }

  /** Redraw with a new crop/effect without decoding again. */
  redraw(clip: Clip, meta: MediaMeta) {
    if (!this.upright.width) return;
    const t = clip.kind === 'photo' ? this.photoT : 0;
    this.renderer.drawLayers([{ src: this.upright, rect: clipSourceRect(clip, meta, t), opacity: 1 }]);
  }

  show(req: ShowRequest) {
    this.stop();
    this.schedule(() => this.load(req));
  }

  private schedule(fn: () => Promise<void>) {
    if (this.busy) {
      this.pending = fn;
      return;
    }
    this.busy = true;
    fn()
      .catch((e) => console.error(e))
      .finally(() => {
        this.busy = false;
        const next = this.pending;
        this.pending = null;
        if (next) this.schedule(next);
      });
  }

  private async load({ clip, meta, t }: ShowRequest) {
    if (meta.kind === 'photo') {
      this.photoT = t;
      const key = `p:${meta.id}`;
      if (this.uprightKey !== key) {
        const bmp = await getPhoto(meta.id, () => getMediaBlob(meta.id), meta.name);
        await this.renderer.loadFrame(this.upright, { image: bmp, rotation: 0, transfer: 'sdr' });
        this.uprightKey = key;
      }
    } else {
      const key = `v:${meta.id}:${t.toFixed(3)}`;
      if (this.uprightKey !== key) {
        const vf = await getVideoFile(meta.id, () => getMediaBlob(meta.id));
        const s = await vf.getSample(t);
        if (!s) return;
        const frame = s.toVideoFrame();
        try {
          await this.renderer.loadFrame(this.upright, {
            image: frame,
            rotation: s.rotation as 0,
            transfer: vf.sampleTransfer(s),
          });
        } finally {
          frame.close();
          s.close();
        }
        this.uprightKey = key;
      }
    }
    this.redraw(clip, meta);
  }

  /** Loops the clip (a video's trimmed window, or a photo's Ken Burns) at real speed until stop(). */
  async play(get: () => { clip: Clip; meta: MediaMeta } | null) {
    this.stop();
    const token = ++this.playToken;
    const first = get();
    if (first?.clip.kind === 'photo') return this.playPhoto(get, token);
    if (!first?.clip.trim) return;
    const vf = await getVideoFile(first.meta.id, () => getMediaBlob(first.meta.id));
    while (token === this.playToken) {
      const cur = get();
      if (!cur?.clip.trim) return;
      const { start, length } = cur.clip.trim;
      const t0 = performance.now();
      for await (const s of vf.samples(start, start + length)) {
        if (token !== this.playToken) {
          s.close();
          return;
        }
        const rel = s.timestamp - vf.firstTimestamp;
        const due = t0 + (rel - start) * 1000;
        while (performance.now() < due - 4) await nextFrame();
        const frame = s.toVideoFrame();
        await this.renderer.loadFrame(this.upright, { image: frame, rotation: s.rotation as 0, transfer: vf.sampleTransfer(s) });
        frame.close();
        s.close();
        this.uprightKey = '';
        if (token !== this.playToken) return;
        const now = get();
        if (now) this.redraw(now.clip, now.meta);
        this.onFrame?.(rel);
      }
    }
  }

  private async playPhoto(get: () => { clip: Clip; meta: MediaMeta } | null, token: number) {
    const first = get()!;
    await new Promise<void>((resolve) => this.schedule(async () => {
      await this.load({ ...first, t: 0 });
      resolve();
    }));
    while (token === this.playToken) {
      const t0 = performance.now();
      const n = frameCount(clipDuration(first.clip));
      for (let i = 0; i < n; i++) {
        while (performance.now() < t0 + (i * 1000) / FPS - 4) await nextFrame();
        if (token !== this.playToken) return;
        const cur = get();
        if (!cur) return;
        this.photoT = i / FPS;
        this.redraw(cur.clip, cur.meta);
        this.onFrame?.(this.photoT);
      }
      // Hold the last frame briefly so the loop point is visible.
      const hold = performance.now() + 400;
      while (performance.now() < hold) await nextFrame();
    }
  }

  stop() {
    this.playToken++;
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
