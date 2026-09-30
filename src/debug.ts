import { renderSample } from './media/frames';
import { getVideoFile } from './media/videoFile';
import { getMediaBlob } from './store/db';
import type { Transfer } from './types';

/**
 * Test/debug helpers on window.__reel. Lets the Playwright suite inspect decoded
 * frames without going through the UI.
 */
export const debugApi = {
  /** Renders a video frame through the analysis path; returns mean RGB and raw pixels. */
  async framePixels(mediaId: string, t: number, maxSide = 96, transfer?: Transfer) {
    const vf = await getVideoFile(mediaId, () => getMediaBlob(mediaId));
    const s = await vf.getSample(t);
    if (!s) throw new Error('no frame');
    try {
      const px = await renderSample(s, transfer ?? vf.sampleTransfer(s), maxSide);
      return { w: px.w, h: px.h, data: Array.from(px.data), format: s.format, transfer: vf.sampleTransfer(s) };
    } finally {
      s.close();
    }
  },
};
