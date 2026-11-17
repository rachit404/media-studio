import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addLayers, createImageProject } from './helpers';
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
  });
}
