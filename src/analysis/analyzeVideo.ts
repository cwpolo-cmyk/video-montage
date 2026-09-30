import { renderSample, pixelsToDataUrl, pixelsToImageData, type Pixels } from '../media/frames';
import type { VideoFile } from '../media/videoFile';
import type { FrameMetrics, VideoAnalysis } from '../types';
import { detectFaces } from './faces';
import { centerFocus, downsample, globalShift, laplacianVariance, lumaStats, toGray } from './metrics';

/** Bump when metrics change so cached analyses are recomputed. */
export const ANALYSIS_VERSION = 1;

const ANALYSIS_SIDE = 480;
const SAMPLE_RATE = 10;
const MAX_SAMPLES = 400;
const FACE_EVERY = 3;
const FILMSTRIP = 10;

export function sampleTimes(duration: number): number[] {
  const n = Math.max(2, Math.min(MAX_SAMPLES, Math.round(duration * SAMPLE_RATE)));
  const step = duration / n;
  return Array.from({ length: n }, (_, i) => Math.round(i * step * 1000) / 1000);
}

/**
 * Decodes ~10 frames/s, measures focus, exposure, subject, motion and faces on each,
 * and builds a filmstrip. Scoring happens separately so it can re-run instantly
 * when preferences change.
 */
export async function analyzeVideo(
  mediaId: string,
  file: VideoFile,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<VideoAnalysis> {
  const times = sampleTimes(file.duration);
  const filmIdx = new Set(
    Array.from({ length: FILMSTRIP }, (_, i) => Math.round((i * (times.length - 1)) / (FILMSTRIP - 1))),
  );
  const frames: FrameMetrics[] = [];
  const filmstrip: VideoAnalysis['filmstrip'] = [];
  let prevSmall: Float32Array | null = null;
  let lastFace = { score: 0 } as { score: number; x?: number; y?: number };
  let i = 0;

  for await (const sample of file.samplesAt(times)) {
    if (signal?.aborted) {
      sample?.close();
      throw new DOMException('Analysis cancelled', 'AbortError');
    }
    const t = times[i];
    if (!sample) {
      i++;
      continue;
    }
    let px: Pixels;
    try {
      px = await renderSample(sample, file.sampleTransfer(sample), ANALYSIS_SIDE);
    } finally {
      sample.close();
    }
    const gray = toGray(px.data, px.w, px.h);
    const stats = lumaStats(gray);
    const small = downsample(gray, px.w, px.h, 4);
    const shift = prevSmall
      ? globalShift(prevSmall, small.data, small.w, small.h)
      : { dx: 0, dy: 0, residual: 0 };
    prevSmall = small.data;

    if (i % FACE_EVERY === 0) lastFace = await detectFaces(pixelsToImageData(px));

    frames.push({
      t,
      lapVar: laplacianVariance(gray, px.w, px.h),
      meanLuma: stats.mean,
      darkFrac: stats.darkFrac,
      clipFrac: stats.clipFrac,
      contrast: stats.contrast,
      centerFocus: centerFocus(gray, px.w, px.h),
      gdx: shift.dx,
      gdy: shift.dy,
      residual: shift.residual,
      face: lastFace.score,
      faceX: lastFace.x,
      faceY: lastFace.y,
    });
    if (filmIdx.has(i)) filmstrip.push({ t, url: pixelsToDataUrl(px, 120) });
    i++;
    onProgress?.(i / times.length);
  }
  // The first sample has no predecessor; borrow the second's motion so it isn't penalized.
  if (frames.length > 1) frames[0].residual = frames[1].residual;

  return { mediaId, version: ANALYSIS_VERSION, duration: file.duration, frames, filmstrip };
}
