import { DEFAULT_WEIGHTS, positionPrior } from '../analysis/preferences';
import { FEATURE_LABELS, FEATURES } from '../analysis/scoring';
import { useStore } from '../store/store';

function describePosition(mean: number) {
  if (mean < 0.25) return 'near the start';
  if (mean < 0.45) return 'early';
  if (mean <= 0.55) return 'in the middle';
  if (mean <= 0.75) return 'late';
  return 'near the end';
}

export function PrefsPanel() {
  const prefs = useStore((s) => s.prefs);
  const resetPrefs = useStore((s) => s.resetPrefs);
  const repick = useStore((s) => s.repickUntouched);
  const pos = positionPrior(prefs);

  return (
    <div className="panel" data-testid="prefs">
      <div className="panel-title">Learned preferences</div>
      {prefs.edits === 0 ? (
        <p className="muted small">
          Move a pick on the scrubber and the auto-trim will learn what you prefer for future videos.
        </p>
      ) : (
        <>
          <p className="small" data-testid="prefs-summary">
            Learned from <b>{prefs.edits}</b> edit{prefs.edits === 1 ? '' : 's'}.
            {pos.confidence > 0.2 && (
              <>
                {' '}
                You tend to pick moments <b>{describePosition(pos.mean)}</b> of a clip.
              </>
            )}{' '}
            Preferred length <b>{prefs.lengthPref.toFixed(1)} s</b>.
          </p>
          {FEATURES.map((k) => {
            const ratio = prefs.weights[k] / DEFAULT_WEIGHTS[k];
            return (
              <div className="bar-row" key={k}>
                <span>{FEATURE_LABELS[k]}</span>
                <span className={`delta ${ratio > 1.05 ? 'up' : ratio < 0.95 ? 'down' : ''}`}>
                  {ratio > 1.05 ? '▲ more' : ratio < 0.95 ? '▼ less' : '—'}
                </span>
              </div>
            );
          })}
          <div className="row">
            <button className="btn small" onClick={repick}>
              Re-pick untouched clips
            </button>
            <button className="link" onClick={resetPrefs}>
              Reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}
