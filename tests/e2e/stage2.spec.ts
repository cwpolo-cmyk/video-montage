import { expect, test, type Page } from '@playwright/test';
import { freshApp, importFiles, previewColor, state, waitIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await freshApp(page);
});

/** Seek the photo motion bar to a fraction 0..1 and return the brightness at a spot. */
async function brightnessAt(page: Page, frac: number, x0: number, x1: number) {
  const track = (await page.getByTestId('photo-track').boundingBox())!;
  const x = track.x + Math.min(track.width - 1, Math.max(1, frac * track.width));
  await page.mouse.click(x, track.y + track.height / 2);
  // Let the redraw land.
  await page.waitForTimeout(150);
  const [r] = await previewColor(page, x0, 0.45, x1, 0.55);
  return r;
}

test('photos are 1.5 s / 45 frames with a default Ken Burns move', async ({ page }) => {
  await importFiles(page, 'gradient.png');
  await waitIdle(page, 1);
  const { clips } = await state(page);
  expect(clips[0].kenBurns).toBe('zoomIn');
  await expect(page.getByTestId('photo-motion')).toContainText('1.5 s (45 frames)');
  await expect(page.getByTestId('kb-zoomIn')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('clip-item')).toContainText('1.5 s');
});

test('each Ken Burns move changes the frame in the right direction, subtly', async ({ page }) => {
  // Horizontal gradient: brightness encodes the source x position.
  await importFiles(page, 'gradient.png');
  await waitIdle(page, 1);
  const results: Record<string, number[]> = {};

  // Zoom in: the left edge moves inward (brighter) by a few percent.
  await page.getByTestId('kb-zoomIn').click();
  let a = await brightnessAt(page, 0, 0, 0.03);
  let b = await brightnessAt(page, 1, 0, 0.03);
  results.zoomIn = [a, b];
  expect(b - a).toBeGreaterThan(4);
  expect(b - a).toBeLessThan(20);

  // Zoom out: the reverse.
  await page.getByTestId('kb-zoomOut').click();
  a = await brightnessAt(page, 0, 0, 0.03);
  b = await brightnessAt(page, 1, 0, 0.03);
  results.zoomOut = [a, b];
  expect(a - b).toBeGreaterThan(4);

  // Pan right: the view travels right, so the centre gets brighter; pan left the opposite.
  await page.getByTestId('kb-panRight').click();
  a = await brightnessAt(page, 0, 0.48, 0.52);
  b = await brightnessAt(page, 1, 0.48, 0.52);
  results.panRight = [a, b];
  expect(b - a).toBeGreaterThan(5);
  expect(b - a).toBeLessThan(20);

  await page.getByTestId('kb-panLeft').click();
  a = await brightnessAt(page, 0, 0.48, 0.52);
  b = await brightnessAt(page, 1, 0.48, 0.52);
  results.panLeft = [a, b];
  expect(a - b).toBeGreaterThan(5);

  console.log('ken burns start/end brightness', results);
});

test('Play animates the photo in the preview', async ({ page }) => {
  await importFiles(page, 'gradient.png');
  await waitIdle(page, 1);
  await page.getByTestId('kb-panRight').click(); // selecting a move starts playback
  await expect(page.getByTestId('play-pick')).toHaveText('■ Stop');
  const seen = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const [r] = await previewColor(page, 0.48, 0.45, 0.52, 0.55);
    seen.add(r);
    await page.waitForTimeout(60);
  }
  console.log('distinct centre values during playback', [...seen].sort((x, y) => x - y));
  expect(seen.size).toBeGreaterThan(4);
  await page.getByTestId('play-pick').click();
  await expect(page.getByTestId('play-pick')).toHaveText('▶ Play');
});

test('a move can be applied to all photos and is autosaved', async ({ page }) => {
  await importFiles(page, 'gradient.png', 'photo_exif6.jpg', 'photo.heic');
  await waitIdle(page, 3);
  await page.getByTestId('clip-item').nth(1).click();
  await page.getByTestId('kb-panLeft').click();
  await page.getByTestId('kb-apply-all').click();
  let { clips } = await state(page);
  expect(clips.map((c: any) => c.kenBurns)).toEqual(['panLeft', 'panLeft', 'panLeft']);

  await page.getByTestId('clip-item').nth(2).click();
  await page.getByTestId('kb-zoomOut').click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByTestId('clip-item')).toHaveCount(3);
  ({ clips } = await state(page));
  expect(clips.map((c: any) => c.kenBurns)).toEqual(['panLeft', 'panLeft', 'zoomOut']);
});

test('photo crop still works and Ken Burns moves inside it', async ({ page }) => {
  await importFiles(page, 'photo_exif6.jpg'); // 300x800 upright: top red, bottom blue
  await waitIdle(page, 1);
  await page.getByTestId('zoom').fill('2');
  const { clips } = await state(page);
  expect(clips[0].crop.zoom).toBeCloseTo(2);
  // Drag down: reveals the top (red) half.
  const box = (await page.getByTestId('crop-surface').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 1.5, { steps: 8 });
  await page.mouse.up();
  const track = (await page.getByTestId('photo-track').boundingBox())!;
  for (const f of [0.01, 0.99]) {
    await page.mouse.click(track.x + f * track.width, track.y + track.height / 2);
    await page.waitForTimeout(150);
    const [r, g, b] = await previewColor(page, 0.1, 0.1, 0.9, 0.9);
    expect(r).toBeGreaterThan(180);
    expect(g + b).toBeLessThan(120);
  }
  await page.screenshot({ path: 'test-results/stage2-photo.png' });
});
