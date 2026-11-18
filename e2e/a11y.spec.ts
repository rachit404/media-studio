import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addLayers, createImageProject, createVideoProject } from './helpers';
import { mediaFixtures } from './media-fixtures';
import { solidPng } from './png';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`accessibility (${colorScheme} theme)`, () => {
    test.use({ colorScheme });

    test('home screen has no WCAG A/AA violations (A11Y-1)', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('workspace layout has no violations', async ({ page }) => {
      await page.goto('/#/video');
      await expect(page.getByRole('heading', { name: 'Video workspace' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('every settings tab has no violations (A11Y-2)', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Settings' }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      for (const tab of ['Appearance', 'Shortcuts', 'Storage', 'Diagnostics']) {
        await dialog.getByRole('tab', { name: tab }).click();
        await expect(dialog.getByRole('tab', { name: tab, selected: true })).toBeVisible();
        await expectNoViolations(page);
      }
    });
  });
}

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`accessibility of the image editor (${colorScheme} theme)`, () => {
    test.use({ colorScheme });

    test('workspace with layers, properties and dialogs has no violations', async ({ page }) => {
      await createImageProject(page, 'A11y');
      await addLayers(page, [
        { name: 'one.png', bytes: solidPng(16, 16, [200, 100, 50, 255]) },
        { name: 'two.png', bytes: solidPng(16, 16, [50, 100, 200, 255]) },
      ]);
      await page.getByRole('button', { name: 'Exposure', exact: true }).click();
      await expect(page.getByRole('slider', { name: 'Exposure (stops)' })).toBeVisible();
      await expectNoViolations(page);

      await page.getByRole('button', { name: 'Export…' }).click();
      await expect(page.getByRole('dialog', { name: 'Export image' })).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

      await page.getByRole('button', { name: 'Crop…' }).click();
      await expect(page.getByRole('dialog', { name: 'Crop canvas' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('painting tools, selection and mask controls have no violations', async ({ page }) => {
      await createImageProject(page, 'A11yPaint');
      await addLayers(page, [{ name: 'one.png', bytes: solidPng(16, 16, [200, 100, 50, 255]) }]);
      await page.getByRole('button', { name: 'Paint layer', exact: true }).click();
      await page
        .getByRole('group', { name: 'Tools' })
        .getByRole('button', { name: 'Brush', exact: true })
        .click();
      await expect(page.getByRole('slider', { name: 'Brush size' })).toBeVisible();
      await expectNoViolations(page);

      await page
        .getByRole('group', { name: 'Tools' })
        .getByRole('button', { name: 'Rectangle select', exact: true })
        .click();
      await expect(page.getByRole('group', { name: 'Selection mode' })).toBeVisible();
      await page.getByRole('button', { name: 'Select all' }).click();
      await expectNoViolations(page);

      await page.getByRole('button', { name: 'Add layer mask' }).click();
      await expect(page.getByRole('button', { name: 'Edit mask' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('video workspace with clips on the timeline has no violations', async ({ page }) => {
      const media = mediaFixtures();
      test.skip(media === null, 'ffmpeg is not installed, so the test videos cannot be made');
      if (!media) return;
      await createVideoProject(page, 'A11yVideo');
      await page.getByTestId('import-media-input').setInputFiles([media.red, media.tone]);
      const list = page.getByRole('list', { name: 'Project media' });
      await expect(list.getByText('tone.wav', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(list.getByText('red.mp4', { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Add to timeline: red.mp4' }).click();
      await page.getByRole('button', { name: 'Add to timeline: tone.wav' }).click();
      const clip = page
        .getByRole('group', { name: 'Video 1' })
        .getByRole('button', { name: /^red.mp4/ });
      await clip.click();
      await expect(page.getByRole('textbox', { name: 'Length' })).toBeVisible();
      await expectNoViolations(page);

      // A title with its box on: the text and box controls.
      await page.getByRole('button', { name: 'Add text' }).click();
      await page.getByRole('checkbox', { name: 'Box behind the text' }).check();
      await expect(page.getByRole('slider', { name: 'Box opacity' })).toBeVisible();
      await expectNoViolations(page);
    });
  });
}
