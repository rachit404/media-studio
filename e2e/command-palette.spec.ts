import { expect, test, type Page } from '@playwright/test';
import { createVideoProject } from './helpers';

const list = (page: Page) => page.getByRole('listbox', { name: 'Commands' });

test.describe('command palette (F5)', () => {
  test('Ctrl+K opens it, a search narrows the list, Enter runs the command and Escape closes it', async ({
    page,
  }) => {
    await createVideoProject(page, 'Palette');
    await page.getByTestId('preview-container').click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('Control+k');
    const search = page.getByRole('combobox', { name: 'Search commands' });
    await expect(search).toBeFocused();
    await expect(list(page).getByRole('option', { name: /Play or pause/ })).toBeVisible();
    // It lists the keys, and only what this screen can do (no paint tools in a video project).
    await expect(list(page).getByRole('option', { name: /Play or pause.*Space/ })).toBeVisible();
    await expect(list(page).getByRole('option', { name: /Brush tool/ })).toHaveCount(0);

    await search.fill('theme');
    await expect(list(page).getByRole('option')).toHaveCount(1);
    const before = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? ''))
      .not.toBe(before);

    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('zzzz');
    await expect(page.getByText('No command on this screen matches')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
  });

  test('the Commands button opens it, and the arrow keys choose before Enter', async ({ page }) => {
    await createVideoProject(page, 'Palette buttons');
    await page.getByRole('button', { name: /^Commands/ }).click();
    const search = page.getByRole('combobox', { name: 'Search commands' });
    await search.fill('go to');
    const options = list(page).getByRole('option');
    expect(await options.count()).toBeGreaterThan(1);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toHaveAttribute('aria-selected', 'false');
    // "Go to the home screen" is one of them: choose it by clicking.
    await list(page)
      .getByRole('option', { name: /Go to the home screen/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  });
});
