import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createVideoProject } from './helpers';
import { mediaFixtures } from './media-fixtures';

const fixtures = mediaFixtures();
test.skip(fixtures === null, 'ffmpeg is not installed, so the test videos cannot be made');
const media = fixtures as NonNullable<typeof fixtures>;

test.setTimeout(120_000);

/** A project with the 2 s red clip on the timeline `times` times in a row (so 2 s, 4 s, ... long). */
async function project(page: Page, name: string, times: number): Promise<void> {
  await createVideoProject(page, name);
  await page.getByTestId('import-media-input').setInputFiles([media.red]);
  const list = page.getByRole('list', { name: 'Project media' });
  await expect(list.getByText('red.mp4', { exact: true })).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < times; i += 1) {
    await page.getByRole('button', { name: 'Add to timeline: red.mp4' }).click();
  }
}

const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export video' });

/** The length of a file in seconds, or null when ffprobe is not installed. */
function durationOf(path: string): number | null {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
      { encoding: 'utf8' },
    );
    return Number(out.trim());
  } catch {
    return null;
  }
}

test.describe('export summary and test export (F7)', () => {
  test('the summary line says format, size, frame rate, file size and time, and follows the settings', async ({
    page,
  }) => {
    await project(page, 'Summary line', 1);
    await page.getByRole('button', { name: 'Export…' }).click();
    const summary = exportDialog(page).getByTestId('export-summary');
    // The sequence takes the picture and rate of the clip (320 x 240 at 25 fps); the 1080p preset never enlarges.
    await expect(summary).toHaveText(
      /^MP4, 320 x 240, 25 fps, (under 1|about \d+) MB, a few seconds$/,
    );

    await exportDialog(page)
      .getByLabel('Preset')
      .selectOption({ label: 'WebM for the web, up to 1080p' });
    await expect(summary).toHaveText(/^WebM, 320 x 240, 25 fps, /);
    await exportDialog(page).getByText('More settings').click();
    await exportDialog(page).getByLabel('Frame rate').selectOption({ label: '60 fps' });
    await expect(summary).toHaveText(/, 60 fps, /);
  });

  test('a test export makes only the first five seconds and offers a download named -test', async ({
    page,
  }, testInfo) => {
    await project(page, 'Test export', 4); // 8 s on the timeline
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = exportDialog(page);
    await expect(dialog.getByTestId('export-summary')).toBeVisible();

    await dialog.getByRole('button', { name: 'Test export (first 5 seconds)' }).click();
    const link = dialog.getByRole('link', { name: /^Download .*-test\.mp4$/ });
    await expect(link).toBeVisible({ timeout: 90_000 });
    await expect(dialog.getByText(/The test video is ready/)).toBeVisible();
    await expect(link).toHaveAttribute('download', 'Test export-test.mp4');

    const downloading = page.waitForEvent('download');
    await link.click();
    const file = testInfo.outputPath('test-export.mp4');
    await (await downloading).saveAs(file);
    const seconds = durationOf(file);
    if (seconds !== null) {
      expect(seconds).toBeGreaterThan(4.8);
      expect(seconds).toBeLessThan(5.3);
    }
  });

  test('a test export of a short video is the whole video, and the normal export is untouched', async ({
    page,
  }) => {
    await project(page, 'Short test', 1); // 2 s
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = exportDialog(page);
    await dialog.getByRole('button', { name: 'Test export (first 5 seconds)' }).click();
    await expect(dialog.getByRole('link', { name: /^Download .*-test\.mp4$/ })).toBeVisible({
      timeout: 90_000,
    });
    await dialog.getByRole('button', { name: 'Close' }).click();

    // The normal export still offers the plain name.
    await page.getByRole('button', { name: 'Export…' }).click();
    await dialog.getByRole('button', { name: 'Start export' }).click();
    const plain = dialog.getByRole('link', { name: /^Download Short test\.mp4$/ });
    await expect(plain).toBeVisible({ timeout: 90_000 });
  });

  test('there is nothing to test when there is nothing to export', async ({ page }) => {
    await createVideoProject(page, 'Empty export');
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = exportDialog(page);
    await expect(
      dialog.getByRole('button', { name: 'Test export (first 5 seconds)' }),
    ).toBeDisabled();
    await expect(dialog.getByTestId('export-summary')).toHaveCount(0);
  });
});
