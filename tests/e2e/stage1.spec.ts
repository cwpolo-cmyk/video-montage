import { expect, test } from '@playwright/test';
import {
  expectPreview,
  freshApp,
  importFiles,
  isBlue,
  isGreen,
  isMagenta,
  isRed,
  state,
  waitIdle,
} from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await freshApp(page);
});

test('iPhone-style rotated .mov is shown upright and cropped to fill 9:16', async ({ page }) => {
  await importFiles(page, 'rotated.mov');
  await waitIdle(page, 1);
  const s = await state(page);
  const m = Object.values(s.media)[0] as any;
  expect(m.rotation).toBe(90);
  expect([m.width, m.height]).toEqual([360, 640]);
  await expect(page.getByTestId('source-size')).toContainText('360×640 · rotated 90°');
  // Stored left=red/right=blue; rotated 90° clockwise => top red, bottom blue.
  await expectPreview(page, [0.1, 0.05, 0.9, 0.4], isRed);
  await expectPreview(page, [0.1, 0.6, 0.9, 0.95], isBlue);
});

test('auto-trim picks the sharp, well-lit, steady section', async ({ page }) => {
  await importFiles(page, 'planted.mp4');
  await waitIdle(page, 1);
  const { clips } = await state(page);
  const trim = clips[0].trim;
  console.log('planted pick', trim);
  // 0-2 blurry, 2-4 good, 4-6 dark, 6-8 shaky.
  expect(trim.length).toBeGreaterThanOrEqual(1.5);
  expect(trim.length).toBeLessThanOrEqual(2);
  expect(trim.start).toBeGreaterThanOrEqual(1.9);
  expect(trim.start + trim.length).toBeLessThanOrEqual(4.15);
  await expect(page.getByTestId('why')).toBeVisible();
  await page.screenshot({ path: 'test-results/stage1-autotrim.png' });
});

test('HLG HDR is decoded as raw 10-bit and tone-mapped close to the SDR original', async ({ page }) => {
  await importFiles(page, 'hdr_hlg.mp4', 'sdr_ref.mp4');
  await waitIdle(page, 2);
  const { media } = await state(page);
  const [hdr, sdr] = Object.values(media) as any[];
  expect(hdr.transfer).toBe('hlg');
  expect(sdr.transfer).toBe('sdr');
  const res = await page.evaluate(
    async ([h, s]) => {
      const api = (window as any).__reel;
      const a = await api.framePixels(h, 0.5, 96);
      const b = await api.framePixels(s, 0.5, 96);
      const naive = await api.framePixels(h, 0.5, 96, 'sdr');
      const mae = (x: number[], y: number[]) => {
        let e = 0;
        let n = 0;
        for (let i = 0; i < x.length; i += 4) {
          for (let c = 0; c < 3; c++) e += Math.abs(x[i + c] - y[i + c]);
          n += 3;
        }
        return e / n;
      };
      return { format: a.format, mae: mae(a.data, b.data), naiveMae: mae(naive.data, b.data) };
    },
    [hdr.id, sdr.id],
  );
  console.log('HDR check', res);
  expect(res.format).toMatch(/P10/);
  expect(res.mae).toBeLessThan(10);
  expect(res.mae).toBeLessThan(res.naiveMae);
});

test('crop can be repositioned by dragging the preview and survives reload', async ({ page }) => {
  await importFiles(page, 'landscape.mp4');
  await waitIdle(page, 1);
  // Red | green | blue thirds; the default centered crop shows green.
  await expectPreview(page, [0.3, 0.3, 0.7, 0.7], isGreen);
  const box = (await page.getByTestId('crop-surface').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 2.5, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expectPreview(page, [0.3, 0.3, 0.7, 0.7], isRed);
  const { clips } = await state(page);
  expect(clips[0].crop.cx).toBeLessThan(0.3);
  expect(clips[0].cropUserSet).toBe(true);

  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByTestId('clip-item')).toHaveCount(1);
  await expectPreview(page, [0.3, 0.3, 0.7, 0.7], isRed);
});

test('photos: EXIF orientation and HEIC decode upright', async ({ page }) => {
  await importFiles(page, 'photo_exif6.jpg');
  await waitIdle(page, 1);
  await expect(page.getByTestId('source-size')).toContainText('300×800');
  await expectPreview(page, [0.2, 0.1, 0.8, 0.4], isRed);
  await expectPreview(page, [0.2, 0.6, 0.8, 0.9], isBlue);

  await importFiles(page, 'photo.heic');
  await waitIdle(page, 2);
  await page.getByTestId('clip-item').nth(1).click();
  await expect(page.getByTestId('source-size')).toContainText('900×1200');
  await expectPreview(page, [0.2, 0.1, 0.8, 0.4], isGreen);
  await expectPreview(page, [0.2, 0.6, 0.8, 0.9], isMagenta);
});

test('moving a pick is learned and used for the next video', async ({ page }) => {
  await importFiles(page, 'landscape.mp4');
  await waitIdle(page, 1);
  const before = (await state(page)).clips[0].trim;

  // Drag the window all the way to the end of the clip.
  const win = (await page.getByTestId('trim-window').boundingBox())!;
  const track = (await page.getByTestId('track').boundingBox())!;
  await page.mouse.move(win.x + win.width / 2, win.y + win.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width + 50, win.y + win.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = (await state(page)).clips[0].trim;
  console.log('pick moved', before, '->', after);
  expect(after.userSet).toBe(true);
  expect(after.start + after.length).toBeCloseTo(3, 1);
  await expect(page.getByTestId('prefs-summary')).toContainText('Learned from 1 edit');
  await expect(page.getByTestId('reset-trim')).toBeVisible();

  // A new, similar clip now gets picked near its end automatically.
  await importFiles(page, 'rotated.mov');
  await waitIdle(page, 2);
  const { clips, media } = await state(page);
  const dur = (media[clips[1].mediaId] as any).duration;
  console.log('next clip pick', clips[1].trim, 'duration', dur);
  expect(clips[1].trim.userSet).toBe(false);
  expect(clips[1].trim.start + clips[1].trim.length).toBeGreaterThan(dur - 0.15);

  // Learning persists across reloads.
  await page.reload();
  await expect(page.getByTestId('clip-item')).toHaveCount(2);
  await expect(page.getByTestId('prefs-summary')).toContainText('Learned from 1 edit');

  // Reset to auto undoes the lesson for that clip.
  await page.getByTestId('clip-item').first().click();
  await page.getByTestId('reset-trim').click();
  await expect(page.getByTestId('prefs-summary')).toHaveCount(0);
});

test('clips can be deleted', async ({ page }) => {
  await importFiles(page, 'photo_exif6.jpg', 'photo.heic');
  await waitIdle(page, 2);
  await expect(page.getByTestId('clip-item')).toHaveCount(2);
  await page.getByTestId('delete-clip').first().click();
  await expect(page.getByTestId('clip-item')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('clip-item')).toHaveCount(1);
});

test('moving a pick before analysis finishes still records the auto pick and learns', async ({ page }) => {
  await importFiles(page, 'planted.mp4');
  await expect(page.getByTestId('trim-window')).toBeVisible();
  // Nudge immediately with the keyboard, before analysis completes.
  await page.getByTestId('trim-window').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await waitIdle(page, 1);
  const { clips, prefs } = await state(page);
  console.log('early edit', clips[0].trim);
  expect(clips[0].trim.userSet).toBe(true);
  expect(clips[0].trim.autoStart).toBeGreaterThanOrEqual(1.9);
  expect(prefs.edits).toBe(1);
});
