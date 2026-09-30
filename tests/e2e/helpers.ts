import { expect, type Page } from '@playwright/test';
import path from 'node:path';

export const fixture = (name: string) => path.resolve('tests/fixtures/generated', name);

export async function freshApp(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase('reel-editor');
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByText('Drop videos and photos here')).toBeVisible();
}

export async function importFiles(page: Page, ...names: string[]) {
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
}

/** Waits until `count` clips exist and every one has finished loading/analysis. */
export async function waitIdle(page: Page, count?: number) {
  if (count !== undefined) await expect(page.getByTestId('clip-item')).toHaveCount(count);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (window as any).__reel.store.getState();
          if (Object.keys(s.errors).length) return 'error: ' + Object.values(s.errors).join('; ');
          const pending = s.clips.filter((c: any) => {
            const m = s.media[c.mediaId];
            return !m?.thumb || s.progress[c.mediaId] !== undefined || (c.kind === 'video' && !s.analyses[c.mediaId]);
          });
          return pending.length ? `pending ${pending.length}` : 'idle';
        }),
      { timeout: 60_000 },
    )
    .toBe('idle');
}

export async function state(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__reel.store.getState();
    return { clips: s.clips, media: s.media, prefs: s.prefs, edits: s.edits, analyses: Object.keys(s.analyses) };
  });
}

/** Mean RGB of a region of the preview canvas, as fractions of the 1080x1920 frame. */
export async function previewColor(page: Page, x0: number, y0: number, x1: number, y1: number) {
  return page.evaluate(
    ([x0, y0, x1, y1]) => {
      const r = (window as any).__reel.preview.renderer;
      const px: Uint8Array = r.readPixels();
      const w = r.width;
      const h = r.height;
      let s = [0, 0, 0];
      let n = 0;
      for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y += 4)
        for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x += 4) {
          const i = (y * w + x) * 4;
          s = [s[0] + px[i], s[1] + px[i + 1], s[2] + px[i + 2]];
          n++;
        }
      return s.map((v) => Math.round(v / n));
    },
    [x0, y0, x1, y1],
  );
}

export async function expectPreview(page: Page, region: [number, number, number, number], check: (rgb: number[]) => boolean) {
  await expect
    .poll(async () => {
      const c = await previewColor(page, ...region);
      return check(c) ? 'ok' : JSON.stringify(c);
    })
    .toBe('ok');
}

export const isRed = ([r, g, b]: number[]) => r > 180 && g < 70 && b < 70;
export const isBlue = ([r, g, b]: number[]) => b > 180 && r < 70 && g < 70;
export const isGreen = ([r, g, b]: number[]) => g > 150 && r < 70 && b < 70;
export const isMagenta = ([r, g, b]: number[]) => r > 180 && b > 180 && g < 70;
