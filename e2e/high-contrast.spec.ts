import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createVideoProject } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

test.describe('high-contrast theme (F8)', () => {
  test('is chosen in Settings, persists across a reload and has no violations on home', async ({
    page,
  }) => {
    await page.goto('/');
    const html = page.locator('html');
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dark = await background();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'High contrast', exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'high-contrast');
    expect(await background()).not.toBe(dark);

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'high-contrast');
    expect(await page.evaluate(() => window.localStorage.getItem('ms-theme'))).toBe(
      'high-contrast',
    );
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
    await expectNoViolations(page);
  });

  test('has no violations in a video project, and the toggle command leaves it for dark', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('ms-theme', 'high-contrast'));
    await createVideoProject(page, 'Contrast');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
    // A title clip needs no media files; the empty timeline scroller is not keyboard focusable in any theme.
    await page.getByRole('button', { name: 'Add text' }).click();
    await expect(page.getByRole('textbox', { name: 'Length' })).toBeVisible();
    await expectNoViolations(page);

    await page.keyboard.press('Control+Shift+L');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
