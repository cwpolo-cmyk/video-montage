import { useEffect, useRef, useState } from 'react';
import { MAX_ZOOM, OUT_H, OUT_W, SAFE_ZONE } from '../constants';
import { dragCrop } from '../crop';
import { ClipPreview } from '../preview/clipPreview';
import { useStore } from '../store/store';
import { TrimScrubber } from './TrimScrubber';

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<ClipPreview | null>(null);
  const [showSafe, setShowSafe] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);

  const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedId) ?? null);
  const meta = useStore((s) => (clip ? s.media[clip.mediaId] : undefined));
  const setCrop = useStore((s) => s.setCrop);
  const ingesting = useStore((s) => (clip ? s.progress[clip.mediaId] !== undefined && !s.analyses[clip.mediaId] : false));
  const loaded = !!meta && (meta.kind === 'video' ? meta.duration !== undefined : !!meta.thumb);

  useEffect(() => {
    const p = new ClipPreview(canvasRef.current!);
    p.onFrame = (t) => setPlayhead(t);
    previewRef.current = p;
    (window as unknown as { __reel: Record<string, unknown> }).__reel.preview = p;
    return () => p.stop();
  }, []);

  // Decode when the clip, media or shown time changes.
  const showT = clip?.trim?.start ?? 0;
  useEffect(() => {
    setPlaying(false);
    setPlayhead(null);
    if (!clip || !meta || !loaded) return;
    previewRef.current?.show({ clip, meta, t: showT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, meta?.id, loaded, showT, clip?.trim?.length]);

  // Crop changes only need a redraw.
  useEffect(() => {
    if (clip && meta && !playing) previewRef.current?.redraw(clip, meta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.crop.cx, clip?.crop.cy, clip?.crop.zoom]);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!clip) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !clip || !meta) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const k = OUT_W / rect.width;
    const dx = (e.clientX - drag.current.x) * k;
    const dy = (e.clientY - drag.current.y) * k;
    drag.current = { x: e.clientX, y: e.clientY };
    setCrop(clip.id, dragCrop(meta.width, meta.height, clip.crop, dx, dy));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!clip) return;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, clip.crop.zoom * Math.exp(-e.deltaY * 0.0015)));
    setCrop(clip.id, { ...clip.crop, zoom });
  };

  const togglePlay = () => {
    const p = previewRef.current;
    if (!p || !clip) return;
    if (playing) {
      p.stop();
      setPlaying(false);
      setPlayhead(null);
      p.show({ clip, meta: meta!, t: showT });
    } else {
      setPlaying(true);
      const id = clip.id;
      void p.play(() => {
        const s = useStore.getState();
        const c = s.clips.find((c) => c.id === id);
        return c ? { clip: c, meta: s.media[c.mediaId] } : null;
      });
    }
  };

  return (
    <div className="preview-wrap">
      <div className="preview-toolbar">
        <label className="toggle">
          <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} /> Safe zones
        </label>
        {clip?.kind === 'video' && (
          <button className="btn" onClick={togglePlay} disabled={!clip.trim} data-testid="play-pick">
            {playing ? '■ Stop' : '▶ Play pick'}
          </button>
        )}
        <span className="hint">Drag to reposition · scroll to zoom</span>
      </div>
      <div className="stage">
        <div className="frame" data-testid="preview-frame">
          <canvas ref={canvasRef} className="preview-canvas" data-testid="preview-canvas" />
          <div
            className="crop-surface"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            data-testid="crop-surface"
          />
          {showSafe && <SafeZone />}
          {(!loaded || ingesting) && clip && <div className="frame-status">{loaded ? 'Analyzing…' : 'Loading…'}</div>}
        </div>
      </div>
      {clip?.kind === 'video' && <TrimScrubber clipId={clip.id} playhead={playing ? playhead : null} />}
    </div>
  );
}

function SafeZone() {
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  return (
    <div className="safe-zone" data-testid="safe-zone">
      <div
        className="safe-rect"
        style={{
          top: pct(SAFE_ZONE.top, OUT_H),
          bottom: pct(SAFE_ZONE.bottom, OUT_H),
          left: pct(SAFE_ZONE.left, OUT_W),
          right: pct(SAFE_ZONE.right, OUT_W),
        }}
      />
      <div className="safe-label" style={{ top: pct(SAFE_ZONE.top, OUT_H) }}>
        Text safe area
      </div>
    </div>
  );
}
