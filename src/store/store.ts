import { create } from 'zustand';
import { analyzeVideo, ANALYSIS_VERSION } from '../analysis/analyzeVideo';
import { detectFaces } from '../analysis/faces';
import { DEFAULT_PREFS, learnFromEdit, type Edit, type Prefs } from '../analysis/preferences';
import { frameFeatures, pickBestWindow, windowFeatures } from '../analysis/scoring';
import { clampCrop, DEFAULT_CROP } from '../crop';
import { DEFAULT_KEN_BURNS, type KenBurns } from '../kenburns';
import { renderBitmap, pixelsToDataUrl, pixelsToImageData, renderSample } from '../media/frames';
import { dropPhoto, getPhoto, isHeic } from '../media/photo';
import { closeVideoFile, getVideoFile } from '../media/videoFile';
import type { Clip, Crop, MediaMeta, Project, VideoAnalysis } from '../types';
import * as db from './db';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ClipEdit {
  clipId: string;
  edit: Edit;
}

interface State {
  ready: boolean;
  media: Record<string, MediaMeta>;
  clips: Clip[];
  analyses: Record<string, VideoAnalysis>;
  /** 0..1 while analyzing. */
  progress: Record<string, number>;
  errors: Record<string, string>;
  selectedId: string | null;
  prefs: Prefs;
  edits: ClipEdit[];
  saveStatus: SaveStatus;
}

interface Actions {
  init(): Promise<void>;
  importFiles(files: File[]): Promise<void>;
  select(id: string | null): void;
  setCrop(clipId: string, crop: Crop): void;
  setTrim(clipId: string, start: number, length: number): void;
  commitTrim(clipId: string): void;
  resetTrim(clipId: string): void;
  removeClip(clipId: string): void;
  repickUntouched(): void;
  resetPrefs(): void;
  setKenBurns(clipId: string, effect: KenBurns): void;
  setKenBurnsAll(effect: KenBurns): void;
}

export const useStore = create<State & Actions>()((set, get) => ({
  ready: false,
  media: {},
  clips: [],
  analyses: {},
  progress: {},
  errors: {},
  selectedId: null,
  prefs: DEFAULT_PREFS,
  edits: [],
  saveStatus: 'idle',

  async init() {
    const [project, metas, edits] = await Promise.all([db.loadProject(), db.allMediaMeta(), db.loadEdits<ClipEdit>()]);
    const media = Object.fromEntries(metas.map((m) => [m.id, m]));
    const clips = (project?.clips ?? []).filter((c) => media[c.mediaId]);
    const analyses: Record<string, VideoAnalysis> = {};
    for (const c of clips) {
      if (c.kind !== 'video') continue;
      const a = await db.getAnalysis(c.mediaId);
      if (a && a.version === ANALYSIS_VERSION) analyses[c.mediaId] = a;
    }
    set({
      ready: true,
      media,
      clips,
      analyses,
      edits,
      prefs: derivePrefs(edits),
      selectedId: clips[0]?.id ?? null,
    });
    for (const c of clips) if (c.kind === 'video' && !analyses[c.mediaId]) queueAnalysis(c.mediaId);
  },

  async importFiles(files) {
    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) {
        alert(`Unsupported file: ${file.name}`);
        continue;
      }
      const id = crypto.randomUUID();
      const meta: MediaMeta = {
        id,
        kind,
        name: file.name,
        mime: file.type,
        width: 1080,
        height: 1920,
        rotation: 0,
        transfer: 'sdr',
      };
      const clip: Clip = {
        id: crypto.randomUUID(),
        mediaId: id,
        kind,
        crop: { ...DEFAULT_CROP },
        cropUserSet: false,
        ...(kind === 'photo' ? { kenBurns: DEFAULT_KEN_BURNS } : {}),
      };
      await db.putMedia(meta, file);
      set((s) => ({
        media: { ...s.media, [id]: meta },
        clips: [...s.clips, clip],
        selectedId: s.selectedId ?? clip.id,
        progress: { ...s.progress, [id]: 0 },
      }));
      try {
        if (kind === 'photo') await ingestPhoto(meta, clip.id);
        else await ingestVideo(meta, clip.id);
      } catch (e) {
        console.error(e);
        set((s) => ({ errors: { ...s.errors, [id]: (e as Error).message }, progress: omit(s.progress, id) }));
      }
    }
  },

  select(id) {
    set({ selectedId: id });
  },

  setCrop(clipId, crop) {
    const c = get().clips.find((c) => c.id === clipId);
    const m = c && get().media[c.mediaId];
    if (!c || !m) return;
    updateClip(clipId, { crop: clampCrop(m.width, m.height, crop), cropUserSet: true });
  },

  setTrim(clipId, start, length) {
    const c = get().clips.find((c) => c.id === clipId);
    if (!c?.trim) return;
    updateClip(clipId, { trim: { ...c.trim, start, length, userSet: true } });
  },

  commitTrim(clipId) {
    const c = get().clips.find((c) => c.id === clipId);
    const a = c && get().analyses[c.mediaId];
    if (!c?.trim || !a) return;
    const { trim } = c;
    const moved = Math.abs(trim.start - trim.autoStart) > 0.15 || Math.abs(trim.length - trim.autoLength) > 0.05;
    let edits = get().edits.filter((e) => e.clipId !== clipId);
    if (moved) {
      const feats = frameFeatures(a.frames);
      const slack = a.duration - trim.length;
      edits = [
        ...edits,
        {
          clipId,
          edit: {
            user: windowFeatures(a.frames, feats, trim.start, trim.length).mean,
            auto: windowFeatures(a.frames, feats, trim.autoStart, trim.autoLength).mean,
            userPos: slack > 1e-6 ? trim.start / slack : 0.5,
            userLen: trim.length,
          },
        },
      ].slice(-50);
    } else {
      updateClip(clipId, { trim: { ...trim, userSet: false } });
    }
    setEdits(edits);
  },

  resetTrim(clipId) {
    const c = get().clips.find((c) => c.id === clipId);
    if (!c?.trim) return;
    updateClip(clipId, { trim: { ...c.trim, start: c.trim.autoStart, length: c.trim.autoLength, userSet: false } });
    setEdits(get().edits.filter((e) => e.clipId !== clipId));
  },

  removeClip(clipId) {
    const c = get().clips.find((c) => c.id === clipId);
    if (!c) return;
    const clips = get().clips.filter((x) => x.id !== clipId);
    const stillUsed = clips.some((x) => x.mediaId === c.mediaId);
    set((s) => ({
      clips,
      selectedId: s.selectedId === clipId ? (clips[0]?.id ?? null) : s.selectedId,
      ...(stillUsed
        ? {}
        : {
            media: omit(s.media, c.mediaId),
            analyses: omit(s.analyses, c.mediaId),
            errors: omit(s.errors, c.mediaId),
            progress: omit(s.progress, c.mediaId),
          }),
    }));
    if (!stillUsed) {
      closeVideoFile(c.mediaId);
      dropPhoto(c.mediaId);
      void db.deleteMedia(c.mediaId);
    }
    // The learned edit is kept: it describes taste, not this project.
  },

  repickUntouched() {
    for (const c of get().clips) if (c.kind === 'video' && c.trim && !c.trim.userSet) applyPick(c.id);
  },

  resetPrefs() {
    setEdits([]);
  },

  setKenBurns(clipId, effect) {
    updateClip(clipId, { kenBurns: effect });
  },

  setKenBurnsAll(effect) {
    set((s) => ({ clips: s.clips.map((c) => (c.kind === 'photo' ? { ...c, kenBurns: effect } : c)) }));
  },
}));

function setEdits(edits: ClipEdit[]) {
  useStore.setState({ edits, prefs: derivePrefs(edits) });
  void db.saveEdits(edits);
}

/** Replaying edits (rather than accumulating) lets a re-edited clip replace its old lesson. */
export function derivePrefs(edits: ClipEdit[]): Prefs {
  return edits.reduce((p, e) => learnFromEdit(p, e.edit), DEFAULT_PREFS);
}

function updateClip(id: string, patch: Partial<Clip>) {
  useStore.setState((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
}

function omit<T>(r: Record<string, T>, k: string): Record<string, T> {
  const { [k]: _, ...rest } = r;
  return rest;
}

const VIDEO_EXT = /\.(mov|mp4|m4v|webm|mkv|qt)$/i;
const PHOTO_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i;
function kindOf(f: File): 'video' | 'photo' | null {
  if (f.type.startsWith('video/') || VIDEO_EXT.test(f.name)) return 'video';
  if (f.type.startsWith('image/') || PHOTO_EXT.test(f.name) || isHeic(f)) return 'photo';
  return null;
}

function setMeta(meta: MediaMeta) {
  useStore.setState((s) => ({ media: { ...s.media, [meta.id]: meta } }));
  void db.updateMediaMeta(meta);
}

async function ingestPhoto(meta: MediaMeta, clipId: string) {
  const bmp = await getPhoto(meta.id, () => db.getMediaBlob(meta.id), meta.name);
  const px = await renderBitmap(bmp, 480);
  const face = await detectFaces(pixelsToImageData(px));
  setMeta({ ...meta, width: bmp.width, height: bmp.height, thumb: pixelsToDataUrl(px, 160) });
  const clip = useStore.getState().clips.find((c) => c.id === clipId);
  if (clip && !clip.cropUserSet && face.score > 0.3 && face.x !== undefined) {
    updateClip(clipId, { crop: clampCrop(bmp.width, bmp.height, { cx: face.x, cy: face.y!, zoom: 1 }) });
  }
  useStore.setState((s) => ({ progress: omit(s.progress, meta.id) }));
}

async function ingestVideo(meta: MediaMeta, clipId: string) {
  const vf = await getVideoFile(meta.id, () => db.getMediaBlob(meta.id));
  const first = await vf.getSample(Math.min(0.5, vf.duration / 2));
  let thumb: string | undefined;
  if (first) {
    try {
      thumb = pixelsToDataUrl(await renderSample(first, vf.sampleTransfer(first), 320), 160);
    } finally {
      first.close();
    }
  }
  setMeta({
    ...meta,
    width: vf.width,
    height: vf.height,
    duration: vf.duration,
    rotation: vf.rotation,
    transfer: vf.transfer,
    codec: vf.codec,
    thumb,
  });
  const len = Math.min(vf.duration, useStore.getState().prefs.lengthPref);
  updateClip(clipId, {
    trim: { start: 0, length: len, autoStart: 0, autoLength: len, userSet: false },
  });
  queueAnalysis(meta.id);
}

let analysisChain: Promise<void> = Promise.resolve();
function queueAnalysis(mediaId: string) {
  useStore.setState((s) => ({ progress: { ...s.progress, [mediaId]: 0 } }));
  analysisChain = analysisChain.then(async () => {
    if (!useStore.getState().media[mediaId]) return;
    try {
      const vf = await getVideoFile(mediaId, () => db.getMediaBlob(mediaId));
      const a = await analyzeVideo(mediaId, vf, (p) =>
        useStore.setState((s) => ({ progress: { ...s.progress, [mediaId]: p } })),
      );
      if (!useStore.getState().media[mediaId]) return;
      await db.putAnalysis(a);
      useStore.setState((s) => ({ analyses: { ...s.analyses, [mediaId]: a }, progress: omit(s.progress, mediaId) }));
      for (const c of useStore.getState().clips) if (c.mediaId === mediaId) applyPick(c.id);
    } catch (e) {
      console.error(e);
      useStore.setState((s) => ({
        errors: { ...s.errors, [mediaId]: (e as Error).message },
        progress: omit(s.progress, mediaId),
      }));
    }
  });
}

/** Runs the auto-picker for a clip with the current learned preferences. */
function applyPick(clipId: string) {
  const s = useStore.getState();
  const c = s.clips.find((c) => c.id === clipId);
  const a = c && s.analyses[c.mediaId];
  const m = c && s.media[c.mediaId];
  if (!c || !a || !m) return;
  const best = pickBestWindow(a.frames, a.duration, s.prefs);
  if (c.trim?.userSet) {
    // The user moved the pick before analysis finished: keep their choice, record
    // what we would have picked, and learn from the difference.
    updateClip(clipId, { trim: { ...c.trim, autoStart: best.start, autoLength: best.length } });
    useStore.getState().commitTrim(clipId);
    return;
  }
  const patch: Partial<Clip> = {
    trim: { start: best.start, length: best.length, autoStart: best.start, autoLength: best.length, userSet: false },
  };
  if (!c.cropUserSet) {
    // Center the crop on faces seen inside the chosen window.
    const faces = a.frames.filter(
      (f) => f.t >= best.start && f.t < best.start + best.length && f.face > 0.3 && f.faceX !== undefined,
    );
    if (faces.length) {
      const fx = faces.reduce((s, f) => s + f.faceX!, 0) / faces.length;
      const fy = faces.reduce((s, f) => s + f.faceY!, 0) / faces.length;
      patch.crop = clampCrop(m.width, m.height, { cx: fx, cy: fy, zoom: c.crop.zoom });
    }
  }
  updateClip(clipId, patch);
}

// ---- Autosave -------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (!s.ready || s.clips === prev.clips) return;
  clearTimeout(saveTimer);
  useStore.setState({ saveStatus: 'saving' });
  saveTimer = setTimeout(async () => {
    const project: Project = { version: 1, clips: useStore.getState().clips, updatedAt: Date.now() };
    try {
      await db.saveProject(project);
      useStore.setState({ saveStatus: 'saved' });
    } catch (e) {
      console.error(e);
      useStore.setState({ saveStatus: 'error' });
    }
  }, 400);
});
