import { useStore } from '../store/store';

export function MediaList() {
  const clips = useStore((s) => s.clips);
  const media = useStore((s) => s.media);
  const progress = useStore((s) => s.progress);
  const errors = useStore((s) => s.errors);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const removeClip = useStore((s) => s.removeClip);

  return (
    <div className="media-list" data-testid="media-list">
      <div className="panel-title">Clips</div>
      {clips.map((c, i) => {
        const m = media[c.mediaId];
        const p = progress[c.mediaId];
        const err = errors[c.mediaId];
        return (
          <div
            key={c.id}
            data-testid="clip-item"
            data-clip-id={c.id}
            className={`clip-item ${c.id === selectedId ? 'selected' : ''} ${err ? 'has-error' : ''}`}
            onClick={() => select(c.id)}
          >
            <div className="clip-thumb">
              {m?.thumb ? <img src={m.thumb} alt="" /> : <div className="thumb-placeholder" />}
              <span className="clip-index">{i + 1}</span>
            </div>
            <div className="clip-info">
              <div className="clip-name" title={m?.name}>
                {m?.name}
              </div>
              <div className="clip-sub">
                <span className={`badge ${c.kind}`}>{c.kind === 'video' ? 'Video' : 'Photo'}</span>
                {m?.transfer && m.transfer !== 'sdr' && <span className="badge hdr">HDR</span>}
                {c.kind === 'video' && c.trim && <span>{c.trim.length.toFixed(1)} s</span>}
                {c.kind === 'photo' && <span>1.5 s</span>}
                {c.trim?.userSet && <span className="badge user">edited</span>}
              </div>
              {p !== undefined && !err && (
                <div className="progress" data-testid="analysis-progress">
                  <div style={{ width: `${Math.round(p * 100)}%` }} />
                  <span>{c.kind === 'video' ? 'Finding best moment…' : 'Loading…'}</span>
                </div>
              )}
              {err && <div className="clip-error" data-testid="clip-error">{err}</div>}
            </div>
            <button
              className="icon-btn"
              title="Delete clip"
              data-testid="delete-clip"
              onClick={(e) => {
                e.stopPropagation();
                removeClip(c.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
