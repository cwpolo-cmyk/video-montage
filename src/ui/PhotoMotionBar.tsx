import { useRef } from 'react';
import { FPS, PHOTO_LEN } from '../constants';
import { clamp } from '../crop';
import { frameCount } from '../kenburns';

/** A 1.5 s bar for photos: shows where in the Ken Burns move the preview is, and lets you scrub it. */
export function PhotoMotionBar({ t, onSeek }: { t: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = (frameCount(PHOTO_LEN) - 1) / FPS;
  const seek = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    // Snap to whole output frames.
    const f = Math.round(clamp((clientX - r.left) / r.width, 0, 1) * (frameCount(PHOTO_LEN) - 1));
    onSeek(f / FPS);
  };
  return (
    <div className="scrubber" data-testid="photo-motion">
      <div className="scrubber-head">
        <span>
          Photo · <b>{PHOTO_LEN.toFixed(1)} s</b> ({frameCount(PHOTO_LEN)} frames)
        </span>
        <span className="muted">Drag to preview the motion</span>
      </div>
      <div
        className="track photo-track"
        ref={ref}
        data-testid="photo-track"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) seek(e.clientX);
        }}
      >
        <div className="photo-fill" style={{ width: `${(t / last) * 100}%` }} />
        <div className="playhead" style={{ left: `${(t / last) * 100}%` }} />
      </div>
    </div>
  );
}
