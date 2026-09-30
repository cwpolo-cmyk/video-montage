import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MediaMeta, Project, VideoAnalysis } from '../types';

interface ReelDB extends DBSchema {
  media: { key: string; value: { meta: MediaMeta; blob: Blob } };
  analysis: { key: string; value: VideoAnalysis };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<ReelDB>> | null = null;
export function db() {
  dbp ??= openDB<ReelDB>('reel-editor', 1, {
    upgrade(d) {
      d.createObjectStore('media');
      d.createObjectStore('analysis');
      d.createObjectStore('kv');
    },
  });
  return dbp;
}

export async function putMedia(meta: MediaMeta, blob: Blob) {
  await (await db()).put('media', { meta, blob }, meta.id);
}
export async function updateMediaMeta(meta: MediaMeta) {
  const d = await db();
  const rec = await d.get('media', meta.id);
  if (rec) await d.put('media', { ...rec, meta }, meta.id);
}
export async function getMediaBlob(id: string): Promise<Blob> {
  const rec = await (await db()).get('media', id);
  if (!rec) throw new Error('Media file missing from storage.');
  return rec.blob;
}
export async function allMediaMeta(): Promise<MediaMeta[]> {
  const d = await db();
  const tx = d.transaction('media');
  const out: MediaMeta[] = [];
  for await (const c of tx.store) out.push(c.value.meta);
  return out;
}
export async function deleteMedia(id: string) {
  const d = await db();
  await d.delete('media', id);
  await d.delete('analysis', id);
}

export async function putAnalysis(a: VideoAnalysis) {
  await (await db()).put('analysis', a, a.mediaId);
}
export async function getAnalysis(id: string) {
  return (await db()).get('analysis', id);
}

export async function saveProject(p: Project) {
  await (await db()).put('kv', p, 'project');
}
export async function loadProject() {
  return (await (await db()).get('kv', 'project')) as Project | undefined;
}

/** The user's manual trim edits the auto-picker learns from (see derivePrefs). */
export async function saveEdits<T>(edits: T[]) {
  await (await db()).put('kv', edits, 'trimEdits');
}
export async function loadEdits<T>(): Promise<T[]> {
  return ((await (await db()).get('kv', 'trimEdits')) as T[] | undefined) ?? [];
}
