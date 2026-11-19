import { expect, test, type Page } from '@playwright/test';
import { createVideoProject } from './helpers';
import { mediaFixtures } from './media-fixtures';

const fixtures = mediaFixtures();
test.skip(fixtures === null, 'ffmpeg is not installed, so the test videos cannot be made');
const media = fixtures as NonNullable<typeof fixtures>;

test.setTimeout(90_000);

/** The red clip (2 s, 25 fps) on the timeline and selected, the playhead at its start. */
async function selectRedClip(page: Page, name: string): Promise<void> {
  await createVideoProject(page, name);
  await page.getByTestId('import-media-input').setInputFiles([media.red]);
  const list = page.getByRole('list', { name: 'Project media' });
  await expect(list.getByText('red.mp4', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add to timeline: red.mp4' }).click();
  await page
    .getByRole('group', { name: 'Video 1' })
    .getByRole('button', { name: /^red\.mp4/ })
    .click();
  await expect(page.getByTestId('transform-move')).toBeVisible({ timeout: 20_000 });
}

/** Moves the playhead to a frame of the clip: Home, then that many steps of one frame. */
async function goToFrame(page: Page, frame: number): Promise<void> {
  await page.getByTestId('preview-container').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('Home');
  for (let i = 0; i < frame; i += 1) await page.keyboard.press('ArrowRight');
}

const xField = (page: Page) => page.getByRole('spinbutton', { name: /^X/ });
const diamondX = (page: Page) => page.getByTestId('keyframe-x');
const timelineDiamonds = (page: Page) => page.getByTestId('keyframe-diamond');

test.describe('keyframes (VID-12)', () => {
  test('animates X with two keyframes: the value follows the playhead, the preview moves, undo takes one back', async ({
    page,
  }) => {
    await selectRedClip(page, 'Keyframes X');
    await expect(diamondX(page)).toHaveAttribute('data-state', 'off');

    // First keyframe at the start (value 0), second near the end (value 100%).
    await diamondX(page).click();
    await expect(diamondX(page)).toHaveAttribute('data-state', 'on');
    await goToFrame(page, 48); // 1.92 s of 2 s
    await expect(diamondX(page)).toHaveAttribute('data-state', 'animated');
    await xField(page).fill('100');
    await expect(diamondX(page)).toHaveAttribute('data-state', 'on');
    await expect(timelineDiamonds(page)).toHaveCount(2);

    // Halfway the value is about half way, and the field shows it.
    await goToFrame(page, 24);
    await expect.poll(async () => Number(await xField(page).inputValue())).toBeGreaterThan(40);
    await expect.poll(async () => Number(await xField(page).inputValue())).toBeLessThan(60);

    // At the end the picture has left the frame: the middle of the preview is black.
    await goToFrame(page, 48);
    await expect
      .poll(
        async () => {
          const png = await page.getByTestId('preview-canvas').screenshot();
          return page.evaluate(async (base64) => {
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const bitmap = await createImageBitmap(new Blob([bytes]));
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('no 2d context');
            context.drawImage(bitmap, 0, 0);
            const [r = 255, g = 255, b = 255] = context.getImageData(
              bitmap.width >> 1,
              bitmap.height >> 1,
              1,
              1,
            ).data;
            return r < 60 && g < 60 && b < 60;
          }, png.toString('base64'));
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    // One undo takes back the second keyframe only.
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(timelineDiamonds(page)).toHaveCount(1);
  });

  test('dragging the box on an animated clip adds a keyframe at the playhead', async ({ page }) => {
    await selectRedClip(page, 'Keyframes handles');
    await diamondX(page).click(); // animate X, keyframe at the start
    await goToFrame(page, 20);
    await expect(diamondX(page)).toHaveAttribute('data-state', 'animated');

    const box = await page.getByTestId('transform-move').boundingBox();
    if (!box) throw new Error('no box');
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y, { steps: 4 });
    await page.mouse.move(from.x + 60, from.y, { steps: 4 });
    await page.mouse.up();

    await expect(diamondX(page)).toHaveAttribute('data-state', 'on');
    await expect(timelineDiamonds(page)).toHaveCount(2);
    // Y was not animated by a horizontal drag; it stays a fixed value.
    await expect(page.getByTestId('keyframe-y')).toHaveAttribute('data-state', 'off');
    // The whole drag is one undo step.
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(timelineDiamonds(page)).toHaveCount(1);
  });

  test('The . and , keys move between keyframes and a diamond on the timeline seeks to its keyframe', async ({
    page,
  }) => {
    await selectRedClip(page, 'Keyframes seek');
    await diamondX(page).click(); // at 0
    await goToFrame(page, 25); // 1 s
    await xField(page).fill('50');
    await goToFrame(page, 0);
    await expect(page.getByTestId('clock')).toHaveText('00:00:00:00');

    await page.keyboard.press('.');
    await expect(page.getByTestId('clock')).toHaveText('00:00:01:00');
    await page.keyboard.press(',');
    await expect(page.getByTestId('clock')).toHaveText('00:00:00:00');

    await timelineDiamonds(page).nth(1).click();
    await expect(page.getByTestId('clock')).toHaveText('00:00:01:00');
  });

  test('removing the animation leaves the property fixed at its value and takes the diamonds away', async ({
    page,
  }) => {
    await selectRedClip(page, 'Keyframes remove');
    await diamondX(page).click();
    await goToFrame(page, 25);
    await xField(page).fill('30');
    await expect(timelineDiamonds(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Remove X animation' }).click();
    await expect(timelineDiamonds(page)).toHaveCount(0);
    await expect(diamondX(page)).toHaveAttribute('data-state', 'off');
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(timelineDiamonds(page)).toHaveCount(2);
  });

  test('keyframes survive a reload', async ({ page }) => {
    await selectRedClip(page, 'Keyframes reload');
    await diamondX(page).click();
    await goToFrame(page, 25);
    await xField(page).fill('40');
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload();
    await page
      .getByRole('alertdialog', { name: 'Restore unsaved changes?' })
      .getByRole('button', { name: 'Restore changes' })
      .click();
    await page
      .getByRole('group', { name: 'Video 1' })
      .getByRole('button', { name: /^red\.mp4/ })
      .click();
    await expect(timelineDiamonds(page)).toHaveCount(2);
  });

  test('a sound clip can animate its volume', async ({ page }) => {
    await selectRedClip(page, 'Keyframes volume');
    // The picture and the sound of red.mp4 are linked clips; the sound is on Audio 1.
    await page
      .getByRole('group', { name: 'Audio 1' })
      .getByRole('button', { name: /^red\.mp4/ })
      .click();
    const volume = page.getByTestId('keyframe-volume');
    await expect(volume).toHaveAttribute('data-state', 'off');
    await volume.click();
    await goToFrame(page, 25);
    await page.getByRole('slider', { name: 'Volume', exact: true }).fill('0');
    await expect(volume).toHaveAttribute('data-state', 'on');
    await expect(timelineDiamonds(page)).toHaveCount(2);
  });
});

test.describe('moving keyframes on the timeline (F4)', () => {
  test('a diamond moves with Alt+arrows by a frame and with Shift by a second, and one undo puts it back', async ({
    page,
  }) => {
    await selectRedClip(page, 'Diamond keys');
    await goToFrame(page, 25); // 1 s into the 2 s clip
    await diamondX(page).click();
    await expect(timelineDiamonds(page)).toHaveCount(1);
    const diamond = timelineDiamonds(page).first();
    await expect(diamond).toHaveAccessibleName(/Keyframe at 00:00:01:00/);
    await diamond.focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(timelineDiamonds(page).first()).toHaveAccessibleName(/Keyframe at 00:00:01:01/);
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+ArrowLeft');
    await page.keyboard.press('Alt+ArrowLeft');
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(timelineDiamonds(page).first()).toHaveAccessibleName(/Keyframe at 00:00:00:24/);
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await expect(timelineDiamonds(page).first()).toHaveAccessibleName(/Keyframe at 00:00:01:24/);
    // It stops at the end of the clip (2 s) instead of leaving it.
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await expect(timelineDiamonds(page).first()).toHaveAccessibleName(/Keyframe at 00:00:02:00/);
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await expect(timelineDiamonds(page).first()).toHaveAccessibleName(/Keyframe at 00:00:02:00/);
    // All those moves were one undo step.
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(timelineDiamonds(page).first()).toHaveAccessibleName(/Keyframe at 00:00:01:00/);
  });

  test('dragging a diamond with the pointer moves it, and a plain press still moves the playhead', async ({
    page,
  }) => {
    await selectRedClip(page, 'Diamond drag');
    await goToFrame(page, 10);
    await diamondX(page).click();
    const diamond = timelineDiamonds(page).first();
    const box = await diamond.boundingBox();
    if (!box) throw new Error('no diamond');
    const y = box.y + box.height / 2;
    const startX = box.x + box.width / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 30, y, { steps: 6 });
    await page.mouse.up();
    // It moved later than frame 10, and the playhead did not follow the drag.
    const name = (await timelineDiamonds(page).first().getAttribute('aria-label')) ?? '';
    expect(name).not.toContain('00:00:00:10');
    await goToFrame(page, 0);
    await timelineDiamonds(page).first().click();
    await expect(page.getByTestId('clock')).not.toHaveText('00:00:00:00');
  });
});
