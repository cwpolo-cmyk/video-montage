import { useEffect, useRef, useState } from 'react';
import { useStore } from './store/store';
import { MediaList } from './ui/MediaList';
import { Preview } from './ui/Preview';
import { Inspector } from './ui/Inspector';
import { PrefsPanel } from './ui/PrefsPanel';

const ACCEPT = 'video/*,image/*,.mov,.heic,.heif';

export function App() {
  const ready = useStore((s) => s.ready);
  const saveStatus = useStore((s) => s.saveStatus);
  const importFiles = useStore((s) => s.importFiles);
  const clipCount = useStore((s) => s.clips.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  const onFiles = (list: FileList | null) => {
    if (list?.length) void importFiles([...list]);
  };

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo-dot" /> Reel Editor
        </div>
        <div className="topbar-meta">
          <span>1080×1920 · 30 fps · silent</span>
          <span className={`save save-${saveStatus}`} data-testid="save-status">
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : saveStatus === 'saved' ? 'Saved' : ''}
          </span>
        </div>
        <button className="btn primary" onClick={() => fileRef.current?.click()}>
          + Add media
        </button>
        <input
          ref={fileRef}
          data-testid="file-input"
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </header>

      {!ready ? (
        <div className="empty">Loading project…</div>
      ) : clipCount === 0 ? (
        <div className="empty">
          <div className="empty-card" onClick={() => fileRef.current?.click()}>
            <div className="empty-title">Drop videos and photos here</div>
            <div className="empty-sub">iPhone .MOV, HEIC, MP4, JPG and PNG. Videos are auto-trimmed to their best 1.5–2 s.</div>
          </div>
        </div>
      ) : (
        <main className="workspace">
          <aside className="left">
            <MediaList />
          </aside>
          <section className="center">
            <Preview />
          </section>
          <aside className="right">
            <Inspector />
            <PrefsPanel />
          </aside>
        </main>
      )}
    </div>
  );
}
