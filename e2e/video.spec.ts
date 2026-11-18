import { expect, test, type Page } from '@playwright/test';
import { createVideoProject } from './helpers';
import { mediaFixtures, type MediaFixture } from './media-fixtures';

const fixtures = mediaFixtures();
test.skip(fixtures === null, 'ffmpeg is not installed, so the test videos cannot be made');
const media = fixtures as NonNullable<typeof fixtures>;

test.setTimeout(90_000);

async function importMedia(page: Page, files: MediaFixture[]): Promise<void> {
  await page.getByTestId('import-media-input').setInputFiles(files);
  const list = page.getByRole('list', { name: 'Project media' });
  for (const file of files)
    await expect(list.getByText(file.name, { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function addToTimeline(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Add to timeline: ${name}` }).click();
}

/** The colour in the middle of the preview, read from a screenshot of the canvas. */
const isRed = ([r, g, b]: [number, number, number]) => r > 200 && g < 60 && b < 60;
const isBlue = ([r, g, b]: [number, number, number]) => b > 200 && r < 60 && g < 60;

async function previewColour(page: Page): Promise<[number, number, number]> {
  const png = await page.getByTestId('preview-canvas').screenshot();
  // Only the middle pixel crosses back from the page (sending a whole screenshot as numbers is slow).
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const [r = 0, g = 0, b = 0] = context.getImageData(
      bitmap.width >> 1,
      bitmap.height >> 1,
      1,
      1,
    ).data;
    return [r, g, b] as [number, number, number];
  }, png.toString('base64'));
}

const clip = (page: Page, name: string, track: string) =>
  page.getByRole('group', { name: track }).getByRole('button', { name: new RegExp(`^${name}`) });

test.describe('video import and timeline', () => {
  test('imports a video, shows its facts, and puts it on the timeline with its sound', async ({
    page,
  }) => {
    await createVideoProject(page, 'Import test');
    await importMedia(page, [media.red]);
    const library = page.getByRole('list', { name: 'Project media' });
    await expect(library.getByText(/320 × 240/)).toBeVisible();
    await addToTimeline(page, 'red.mp4');
    await expect(clip(page, 'red.mp4', 'Video 1')).toBeVisible();
    await expect(clip(page, 'red.mp4', 'Audio 1')).toBeVisible();
    // The first video sets the sequence picture size.
    await expect(page.getByRole('spinbutton', { name: /^Width/ })).toHaveValue('320');
    await expect(page.getByRole('spinbutton', { name: /^Height/ })).toHaveValue('240');
  });

  test('shows the picture at the playhead', async ({ page }) => {
    await createVideoProject(page, 'Preview test');
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4');
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);
    await addToTimeline(page, 'blue.mp4'); // goes after the red clip (2 s)
    await page.getByRole('button', { name: 'Go to end' }).click();
    await page.getByRole('button', { name: 'Back one frame' }).click();
    await expect
      .poll(async () => isBlue(await previewColour(page)), { timeout: 20_000 })
      .toBe(true);
    await page.getByRole('button', { name: 'Go to start' }).click();
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);
  });

  test('plays, advances the clock and stops at the end', async ({ page }) => {
    await createVideoProject(page, 'Playback test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect
      .poll(async () => page.getByTestId('clock').textContent(), { timeout: 10_000 })
      .not.toBe('00:00:00:00');
    // The 2 second clip ends by itself.
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('clock')).toHaveText('00:00:02:00');
  });

  test('reports unsupported files clearly and still imports the good ones', async ({ page }) => {
    await createVideoProject(page, 'Errors test');
    await page.getByTestId('import-media-input').setInputFiles([media.broken, media.tone]);
    const list = page.getByRole('list', { name: 'Project media' });
    await expect(list.getByText('tone.wav', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('list', { name: 'Import problems' })).toContainText('broken.mp4');
  });
});

test.describe('editing on the timeline', () => {
  test('split, delete, undo and redo', async ({ page }) => {
    await createVideoProject(page, 'Edit test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(1);
    // Put the playhead at 1 s and split.
    await page.getByRole('button', { name: 'Forward one frame' }).click({ clickCount: 1 });
    for (let i = 0; i < 24; i += 1)
      await page.getByRole('button', { name: 'Forward one frame' }).click();
    await expect(page.getByTestId('clock')).toHaveText('00:00:01:00');
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(2);
    await expect(clip(page, 'red.mp4', 'Audio 1')).toHaveCount(2);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(1);
    await page.getByRole('button', { name: /^Redo/ }).click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(2);

    // Delete the second half (and its linked sound); the first half stays.
    await clip(page, 'red.mp4', 'Video 1').nth(1).click();
    await page.getByRole('button', { name: 'Delete clip' }).click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(1);
    await expect(clip(page, 'red.mp4', 'Audio 1')).toHaveCount(1);
  });

  test('numeric trim changes the clip length and keeps the sound linked', async ({ page }) => {
    await createVideoProject(page, 'Trim test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await clip(page, 'red.mp4', 'Video 1').click();
    const length = page.getByRole('textbox', { name: 'Length' });
    await expect(length).toHaveValue('00:00:02:00');
    await length.fill('00:00:01:00');
    await length.press('Enter');
    await expect(length).toHaveValue('00:00:01:00');
    await expect(clip(page, 'red.mp4', 'Audio 1')).toHaveAccessibleName(/length 00:00:01:00/);
    // Longer than the file is refused with a message.
    await length.fill('00:00:05:00');
    await length.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: /cannot be trimmed/ })).toBeVisible();
  });

  test('dragging a clip moves it and refuses to overlap', async ({ page }) => {
    await createVideoProject(page, 'Drag test');
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4');
    await addToTimeline(page, 'blue.mp4');
    const blue = clip(page, 'blue.mp4', 'Video 1');
    await blue.scrollIntoViewIfNeeded();
    const before = await blue.boundingBox();
    if (!before) throw new Error('no box');
    // Drag the blue clip to the right by 100 px (about 1.7 s at 60 px per second).
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 100, before.y + before.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
    const after = await blue.boundingBox();
    expect(after?.x ?? 0).toBeGreaterThan(before.x + 50);
    // Undo puts it back.
    await page.getByRole('button', { name: /^Undo/ }).click();
    const back = await blue.boundingBox();
    expect(Math.abs((back?.x ?? 0) - before.x)).toBeLessThan(2);
    // Dragging it left over the red clip stops at the red clip's end.
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x - 200, before.y + before.height / 2, { steps: 5 });
    await page.mouse.up();
    const clamped = await blue.boundingBox();
    expect(Math.abs((clamped?.x ?? 0) - before.x)).toBeLessThan(3);
  });

  test('a project with video clips survives a reload', async ({ page }) => {
    await createVideoProject(page, 'Persist test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await expect(clip(page, 'red.mp4', 'Video 1')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload(); // no checkpoint was written: the same as a crash
    await page
      .getByRole('alertdialog', { name: 'Restore unsaved changes?' })
      .getByRole('button', { name: 'Restore changes' })
      .click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);
  });
});
