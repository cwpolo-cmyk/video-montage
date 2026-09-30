import { useMemo, useRef } from 'react';
import { qualityCurve } from '../analysis/scoring';
import { VIDEO_MAX_LEN, VIDEO_MIN_LEN } from '../constants';
import { clamp } from '../crop';
import { useStore } from '../store/store';

type DragMode = 'move' | 'left' | 'right';

/**
 * One-line scrubber: the whole clip as a filmstrip with its quality curve, and the
 * picked 1.5–2 s window on top. Drag the window to move it, drag its edges to
 * resize. The dashed marker shows the auto pick.
 */
export function TrimScrubber({ clipId, playhead }: { clipId: string; playhead: number | null }) {
  const clip = useStore((s) => s.clips.find((c) => c.id === clipId));
  const analysis = useStore((s) => (clip ? s.analyses[clip.mediaId] : undefined));
  const duration = useStore((s) => (clip ? s.media[clip.mediaId]?.duration : undefined)) ?? 0;
  const prefs = useStore((s) => s.prefs);
  const setTrim = useStore((s) => s.setTrim);
  const commitTrim = useStore((s) => s.commitTrim);
  const resetTrim = useStore((s) => s.resetTrim);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: DragMode; x: number; start: number; length: number } | null>(null);

  const curve = useMemo(() => (analysis ? qualityCurve(analysis.frames, prefs) : []), [analysis, prefs]);
  const path = useMemo(() => {
    if (!analysis || curve.length < 2 || !duration) return '';
    return curve
      .map((q, i) => `${i ? 'L' : 'M'}${((analysis.frames[i].t / duration) * 1000).toFixed(1)},${(40 - q * 36).toFixed(1)}`)
      .join(' ');
  }, [curve, analysis, duration]);

  if (!clip?.trim || !duration) return null;
  const { start, length, autoStart, autoLength, userSet } = clip.trim;
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const minLen = Math.min(VIDEO_MIN_LEN, duration);
  const maxLen = Math.min(VIDEO_MAX_LEN, duration);

  const onDown = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, start, length };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !trackRef.current) return;
    const dt = ((e.clientX - d.x) / trackRef.current.clientWidth) * duration;
    let s = d.start;
    let l = d.length;
    if (d.mode === 'move') s = clamp(d.start + dt, 0, duration - l);
    else if (d.mode === 'right') l = clamp(d.length + dt, minLen, Math.min(maxLen, duration - d.start));
    else {
      const end = d.start + d.length;
      s = clamp(d.start + dt, Math.max(0, end - maxLen), end - minLen);
      l = end - s;
    }
    setTrim(clipId, round(s), round(l));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    commitTrim(clipId);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.5 : 0.1;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const s = clamp(start + (e.key === 'ArrowRight' ? step : -step), 0, duration - length);
    setTrim(clipId, round(s), length);
    commitTrim(clipId);
  };
  // Clicking the track jumps the window there (centered).
  const onTrackDown = (e: React.PointerEvent) => {
    if (!trackRef.current) return;
    const r = trackRef.current.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * duration;
    setTrim(clipId, round(clamp(t - length / 2, 0, duration - length)), length);
    commitTrim(clipId);
  };

  return (
    <div className="scrubber" data-testid="scrubber">
      <div className="scrubber-head">
        <span>
          Pick <b data-testid="trim-range">{start.toFixed(1)}s – {(start + length).toFixed(1)}s</b> ({length.toFixed(1)} s of{' '}
          {duration.toFixed(1)} s)
        </span>
        {userSet ? (
          <button className="link" onClick={() => resetTrim(clipId)} data-testid="reset-trim">
            Reset to auto pick
          </button>
        ) : (
          <span className="muted">{analysis ? 'Auto pick' : 'Analyzing…'}</span>
        )}
      </div>
      <div className="track" ref={trackRef} onPointerDown={onTrackDown} data-testid="track">
        <div className="filmstrip">
          {analysis?.filmstrip.map((f) => (
            <img key={f.t} src={f.url} alt="" draggable={false} />
          ))}
        </div>
        {path && (
          <svg className="curve" viewBox="0 0 1000 40" preserveAspectRatio="none">
            <path d={path} />
          </svg>
        )}
        {userSet && (
          <div className="auto-ghost" style={{ left: pct(autoStart), width: pct(autoLength) }} title="Auto pick" />
        )}
        <div
          className="window"
          data-testid="trim-window"
          tabIndex={0}
          role="slider"
          aria-label="Trim window"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={start}
          style={{ left: pct(start), width: pct(length) }}
          onPointerDown={onDown('move')}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
        >
          {/* Move/up events bubble from the handles to the window's handlers. */}
          <div className="handle left" onPointerDown={onDown('left')} />
          <div className="handle right" onPointerDown={onDown('right')} />
        </div>
        {playhead !== null && <div className="playhead" style={{ left: pct(playhead) }} />}
      </div>
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
