import type { FaceDetector as FD } from '@mediapipe/tasks-vision';

export interface FaceResult {
  /** 0..1: best face confidence weighted by its size in frame. */
  score: number;
  x?: number;
  y?: number;
}

let detector: Promise<FD | null> | null = null;

/** Lazily loads MediaPipe's on-device face detector. Returns null if unavailable. */
function getDetector(): Promise<FD | null> {
  detector ??= (async () => {
    try {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const base = new URL(import.meta.env.BASE_URL, location.href).href;
      const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
      return await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}models/blaze_face_short_range.tflite`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      });
    } catch (e) {
      console.warn('Face detection unavailable:', e);
      return null;
    }
  })();
  return detector;
}

export async function detectFaces(img: ImageData): Promise<FaceResult> {
  const d = await getDetector();
  if (!d) return { score: 0 };
  const res = d.detect(img);
  let best: FaceResult = { score: 0 };
  for (const det of res.detections) {
    const bb = det.boundingBox;
    const conf = det.categories[0]?.score ?? 0;
    if (!bb) continue;
    const area = (bb.width * bb.height) / (img.width * img.height);
    // Faces smaller than ~2% of the frame count for less.
    const score = conf * Math.min(1, Math.sqrt(area / 0.02));
    if (score > best.score) {
      best = {
        score,
        x: (bb.originX + bb.width / 2) / img.width,
        y: (bb.originY + bb.height / 2) / img.height,
      };
    }
  }
  return best;
}
