import { useMemo } from 'react';
import { FEATURE_LABELS, FEATURES, frameFeatures, windowFeatures } from '../analysis/scoring';
import { MAX_ZOOM } from '../constants';
import { DEFAULT_CROP } from '../crop';
import { DEFAULT_KEN_BURNS, KEN_BURNS_OPTIONS } from '../kenburns';
import { useStore } from '../store/store';

export function Inspector() {
  const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedId) ?? null);
  const meta = useStore((s) => (clip ? s.media[clip.mediaId] : undefined));
  const analysis = useStore((s) => (clip ? s.analyses[clip.mediaId] : undefined));
  const setCrop = useStore((s) => s.setCrop);
  const setKenBurns = useStore((s) => s.setKenBurns);
  const setKenBurnsAll = useStore((s) => s.setKenBurnsAll);
  const photoCount = useStore((s) => s.clips.filter((c) => c.kind === 'photo').length);

  const why = useMemo(() => {
    if (!analysis || !clip?.trim) return null;
    const feats = frameFeatures(analysis.frames);
    return windowFeatures(analysis.frames, feats, clip.trim.start, clip.trim.length).mean;
  }, [analysis, clip?.trim]);

  if (!clip || !meta) return <div className="panel">Select a clip.</div>;

  return (
    <div className="panel" data-testid="inspector">
      <div className="panel-title">Clip</div>
      <dl className="facts">
        <dt>Source</dt>
        <dd data-testid="source-size">
          {meta.width}×{meta.height}
          {meta.rotation ? ` · rotated ${meta.rotation}°` : ''}
        </dd>
        {meta.kind === 'video' && (
          <>
            <dt>Format</dt>
            <dd>
              {meta.codec?.split('.')[0]} · {meta.transfer === 'sdr' ? 'SDR' : `HDR (${meta.transfer.toUpperCase()}) → SDR`}
            </dd>
          </>
        )}
      </dl>

      <div className="field">
        <label>
          Crop zoom <span className="muted">{clip.crop.zoom.toFixed(2)}×</span>
        </label>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={clip.crop.zoom}
          data-testid="zoom"
          onChange={(e) => setCrop(clip.id, { ...clip.crop, zoom: Number(e.target.value) })}
        />
        <button className="link" onClick={() => setCrop(clip.id, { ...DEFAULT_CROP })}>
          Reset crop
        </button>
      </div>

      {clip.kind === 'photo' && (
        <div className="field" data-testid="ken-burns">
          <label>
            Ken Burns <span className="muted">1.5 s · subtle</span>
          </label>
          <div className="segmented" role="radiogroup">
            {KEN_BURNS_OPTIONS.map((o) => {
              const active = (clip.kenBurns ?? DEFAULT_KEN_BURNS) === o.id;
              return (
                <button
                  key={o.id}
                  role="radio"
                  aria-checked={active}
                  className={active ? 'active' : ''}
                  data-testid={`kb-${o.id}`}
                  onClick={() => setKenBurns(clip.id, o.id)}
                >
                  <span>{o.icon}</span> {o.label}
                </button>
              );
            })}
          </div>
          {photoCount > 1 && (
            <button
              className="link"
              data-testid="kb-apply-all"
              onClick={() => setKenBurnsAll(clip.kenBurns ?? DEFAULT_KEN_BURNS)}
            >
              Use this move on all {photoCount} photos
            </button>
          )}
        </div>
      )}

      {why && (
        <div className="why" data-testid="why">
          <div className="panel-subtitle">Why this section</div>
          {FEATURES.map((k) => (
            <div className="bar-row" key={k}>
              <span>{FEATURE_LABELS[k]}</span>
              <div className="bar">
                <div style={{ width: `${Math.round(why[k] * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
