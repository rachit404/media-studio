import { expect, test, type Page } from '@playwright/test';
import { createVideoProject } from './helpers';
import { mediaFixtures } from './media-fixtures';

const fixtures = mediaFixtures();
test.skip(fixtures === null, 'ffmpeg is not installed, so the test videos cannot be made');
const media = fixtures as NonNullable<typeof fixtures>;

test.setTimeout(90_000);

async function projectWithClip(page: Page, name: string): Promise<void> {
  await createVideoProject(page, name);
  await page.getByTestId('import-media-input').setInputFiles([media.red]);
  const list = page.getByRole('list', { name: 'Project media' });
  await expect(list.getByText('red.mp4', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add to timeline: red.mp4' }).click();
  await expect(
    page.getByRole('group', { name: 'Video 1' }).getByRole('button', { name: /^red\.mp4/ }),
  ).toBeVisible();
}

const laneHeight = async (page: Page, name: string): Promise<number> =>
  (await page.getByRole('group', { name, exact: true }).boundingBox())?.height ?? 0;

test.describe('timeline view (F10)', () => {
  test('track height changes every row, and a collapsed track shows a thin strip without its clips', async ({
    page,
  }) => {
    await projectWithClip(page, 'Track heights');
    expect(await laneHeight(page, 'Video 1')).toBe(56);
    await page.getByLabel('Track height').selectOption('tall');
    await expect.poll(() => laneHeight(page, 'Video 1')).toBe(88);
    expect(await laneHeight(page, 'Audio 1')).toBe(88);
    await page.getByLabel('Track height').selectOption('compact');
    await expect.poll(() => laneHeight(page, 'Video 1')).toBe(40);

    await page.getByRole('button', { name: 'Collapse Video 1' }).click();
    await expect.poll(() => laneHeight(page, 'Video 1')).toBe(22);
    await expect(
      page.getByRole('group', { name: 'Video 1' }).getByRole('button', { name: /^red\.mp4/ }),
    ).toHaveCount(0);
    // The audio row moved up with it, and is still full height.
    expect(await laneHeight(page, 'Audio 1')).toBe(40);
    await page.getByRole('button', { name: 'Expand Video 1' }).click();
    await expect(
      page.getByRole('group', { name: 'Video 1' }).getByRole('button', { name: /^red\.mp4/ }),
    ).toBeVisible();
    expect(await laneHeight(page, 'Video 1')).toBe(40);
  });

  test('Zoom to clip makes the selected clip fill the timeline', async ({ page }) => {
    await projectWithClip(page, 'Zoom to clip');
    const zoomButton = page.getByRole('button', { name: 'Zoom to clip' });
    const clip = page
      .getByRole('group', { name: 'Video 1' })
      .getByRole('button', { name: /^red\.mp4/ });
    const before = (await clip.boundingBox())?.width ?? 0;
    await clip.click();
    await expect(zoomButton).toBeEnabled();
    await zoomButton.click();
    const scroll = (await page.getByTestId('timeline-scroll').boundingBox())?.width ?? 0;
    await expect
      .poll(async () => (await clip.boundingBox())?.width ?? 0)
      .toBeGreaterThan(Math.max(before * 2, scroll * 0.8));
    const after = await clip.boundingBox();
    const view = await page.getByTestId('timeline-scroll').boundingBox();
    if (!after || !view) throw new Error('no boxes');
    expect(after.x).toBeGreaterThanOrEqual(view.x - 1);
    expect(after.x + after.width).toBeLessThanOrEqual(view.x + view.width + 1);
  });
});
