export type MediaKind = 'video' | 'photo';

export type Transfer = 'sdr' | 'hlg' | 'pq';

export interface MediaMeta {
  id: string;
  kind: MediaKind;
  name: string;
  mime: string;
  /** Upright (post-rotation) dimensions. */
  width: number;
  height: number;
  /** Seconds, videos only. */
  duration?: number;
  /** Clockwise rotation from container metadata (videos) — photos are decoded upright. */
  rotation: 0 | 90 | 180 | 270;
  transfer: Transfer;
  codec?: string;
  /** Small JPEG data URL for lists. */
  thumb?: string;
}

/**
 * Crop is described as the center of the visible window in normalized source
 * coordinates (0..1) and a zoom factor on top of "cover" scaling (>= 1).
 */
export interface Crop {
  cx: number;
  cy: number;
  zoom: number;
}

export interface Trim {
  start: number;
  length: number;
  /** Where the auto-picker put it (kept so the user can reset and so we can learn). */
  autoStart: number;
  autoLength: number;
  /** True once the user has moved the pick. */
  userSet: boolean;
}

export interface Clip {
  id: string;
  mediaId: string;
  kind: MediaKind;
  crop: Crop;
  /** True once the user has repositioned the crop (stops auto face-centering). */
  cropUserSet: boolean;
  trim?: Trim;
}

export interface Project {
  version: 1;
  clips: Clip[];
  updatedAt: number;
}

/** Per-frame measurements from the analysis pass. */
export interface FrameMetrics {
  t: number;
  /** Variance of the Laplacian (luma 0..255). */
  lapVar: number;
  meanLuma: number;
  /** Fraction of pixels that are nearly black / nearly clipped. */
  darkFrac: number;
  clipFrac: number;
  /** Luma standard deviation, 0..1. */
  contrast: number;
  /** Edge energy in the central region relative to the frame, ~0..2. */
  centerFocus: number;
  /** Global (camera) shift vs. previous sample, in analysis pixels. */
  gdx: number;
  gdy: number;
  /** Mean abs difference after global-motion compensation (luma 0..255). */
  residual: number;
  /** 0..1, best face confidence weighted by size. */
  face: number;
  /** Normalized face center (x, y), when a face was found. */
  faceX?: number;
  faceY?: number;
}

export interface VideoAnalysis {
  mediaId: string;
  version: number;
  duration: number;
  frames: FrameMetrics[];
  /** Evenly spaced filmstrip thumbnails. */
  filmstrip: { t: number; url: string }[];
}
