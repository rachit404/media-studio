import { expect, test, type Locator, type Page } from '@playwright/test';
import { createVideoProject } from './helpers';
import { mediaFixtures } from './media-fixtures';

const fixtures = mediaFixtures();
test.skip(fixtures === null, 'ffmpeg is not installed, so the test videos cannot be made');
const media = fixtures as NonNullable<typeof fixtures>;

test.setTimeout(90_000);

async function selectRedClip(page: Page): Promise<void> {
  await createVideoProject(page, 'Handles test');
  await page.getByTestId('import-media-input').setInputFiles([media.red]);
  const list = page.getByRole('list', { name: 'Project media' });
  await expect(list.getByText('red.mp4', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add to timeline: red.mp4' }).click();
  await page
    .getByRole('group', { name: 'Video 1' })
    .getByRole('button', { name: /^red\.mp4/ })
    .click();
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  by: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 4 });
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 4 });
  await page.mouse.up();
}

test.describe('on-canvas transform handles', () => {
  test('show for the selected picture clip: a box, a rotate knob and four corners', async ({
    page,
  }) => {
    await selectRedClip(page);
    await expect(page.getByTestId('transform-handles')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('transform-move')).toBeVisible();
    await expect(page.getByTestId('transform-rotate')).toBeVisible();
    await expect(page.getByTestId(/^transform-scale-/)).toHaveCount(4);
  });

  test('dragging the box moves the clip, and the whole drag is one undo step', async ({ page }) => {
    await selectRedClip(page);
    await expect(page.getByTestId('transform-move')).toBeVisible({ timeout: 20_000 });
    const x = page.getByRole('spinbutton', { name: /^X/ });
    await expect(x).toHaveValue('0');

    await drag(page, await centre(page.getByTestId('transform-move')), { x: 80, y: 30 });
    await expect.poll(async () => Number(await x.inputValue())).toBeGreaterThan(5);
    await expect
      .poll(async () => Number(await page.getByRole('spinbutton', { name: /^Y/ }).inputValue()))
      .toBeGreaterThan(5);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(x).toHaveValue('0');
    await expect(page.getByRole('spinbutton', { name: /^Y/ })).toHaveValue('0');
  });

  test('dragging a corner outward scales the clip and the knob turns it', async ({ page }) => {
    await selectRedClip(page);
    await expect(page.getByTestId('transform-move')).toBeVisible({ timeout: 20_000 });
    const scale = page.getByRole('spinbutton', { name: /^Scale/ });
    await expect(scale).toHaveValue('100');

    await drag(page, await centre(page.getByTestId('transform-scale-2')), { x: 60, y: 40 });
    await expect.poll(async () => Number(await scale.inputValue())).toBeGreaterThan(105);

    const rotation = page.getByRole('spinbutton', { name: /^Rotation/ });
    await expect(rotation).toHaveValue('0');
    await drag(page, await centre(page.getByTestId('transform-rotate')), { x: 120, y: 60 });
    await expect.poll(async () => Number(await rotation.inputValue())).toBeGreaterThan(5);
  });

  test('arrow keys on the box nudge the clip', async ({ page }) => {
    await selectRedClip(page);
    const move = page.getByTestId('transform-move');
    await expect(move).toBeVisible({ timeout: 20_000 });
    await move.focus();
    const x = page.getByRole('spinbutton', { name: /^X/ });
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => Number(await x.inputValue())).toBeGreaterThan(0);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => Number(await x.inputValue())).toBeLessThan(0);
  });

  test('square brackets turn the clip and minus and plus resize it, from the keyboard (F3)', async ({
    page,
  }) => {
    await selectRedClip(page);
    const move = page.getByTestId('transform-move');
    await expect(move).toBeVisible({ timeout: 20_000 });
    await move.focus();
    const rotation = page.getByRole('spinbutton', { name: /^Rotation/ });
    const scale = page.getByRole('spinbutton', { name: /^Scale/ });
    await page.keyboard.press(']');
    await page.keyboard.press('Shift+]');
    await expect.poll(async () => Number(await rotation.inputValue())).toBe(16);
    await page.keyboard.press('[');
    await expect.poll(async () => Number(await rotation.inputValue())).toBe(15);
    await page.keyboard.press('Shift+=');
    await expect.poll(async () => Number(await scale.inputValue())).toBeGreaterThan(100);
    await page.keyboard.press('-');
    await page.keyboard.press('Shift+_');
    await expect.poll(async () => Number(await scale.inputValue())).toBeLessThan(100);
    // The accessible name of the box says how.
    await expect(move).toHaveAccessibleName(/square brackets turn it/);
  });

  test('a locked track shows no handles', async ({ page }) => {
    await selectRedClip(page);
    await expect(page.getByTestId('transform-handles')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /^Lock Video 1/ }).click();
    await expect(page.getByTestId('transform-handles')).toHaveCount(0);
  });
});
