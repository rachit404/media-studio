import { expect, test } from '@playwright/test';

test.use({ colorScheme: 'dark' });

test.describe('capability gate (PLAT-2, PLAT-3)', () => {
  test('explains why an unsupported browser cannot run the app instead of showing a blank page', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'OffscreenCanvas', { value: undefined, configurable: true });
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: "This browser can't run Media Studio" }),
    ).toBeVisible();
    await expect(
      page.getByText('Hardware-accelerated graphics (WebGL 2) is not available.'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start a project' })).toHaveCount(0);
  });

  test('shows a dismissible limitations notice in a degraded browser', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    });
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Browser limitations' });
    await expect(banner).toContainText('Files are copied into browser storage');
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toHaveCount(0);
  });
});

test.describe('shortcuts (UX-1)', () => {
  test('opens settings from the default shortcut', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
    await page.keyboard.press('Control+,');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('rebinds a shortcut, detects conflicts and persists across reloads', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
    await page.keyboard.press('Control+/');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.getByRole('tab', { name: 'Shortcuts', selected: true })).toBeVisible();

    // Conflict: Ctrl+Shift+L belongs to the theme command.
    await dialog.getByRole('button', { name: 'Change shortcut for Open settings' }).click();
    await page.keyboard.press('Control+Shift+L');
    await expect(dialog.getByRole('status')).toContainText(
      'already used by "Toggle light and dark theme"',
    );

    // Rebind the theme command.
    await dialog
      .getByRole('button', { name: 'Change shortcut for Toggle light and dark theme' })
      .click();
    await page.keyboard.press('Control+Shift+K');
    await expect(dialog.getByRole('status')).toContainText('Shortcut set to Ctrl+Shift+K.');
    await page.keyboard.press('Escape');

    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Control+Shift+L');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Control+Shift+K');
    await expect(html).toHaveAttribute('data-theme', 'light');

    await page.reload();
    // Shortcuts are active once the capability probe has finished and the shell is mounted.
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
    await page.keyboard.press('Control+Shift+K');
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('workspace layout', () => {
  test('resizes panels with the keyboard, collapses them, and remembers sizes', async ({
    page,
  }) => {
    await page.goto('/#/image');
    const splitter = page.getByRole('separator', { name: 'Resize layers and assets panel' });
    await expect(splitter).toHaveAttribute('aria-valuenow', '240');

    await splitter.focus();
    await page.keyboard.press('ArrowRight');
    await expect(splitter).toHaveAttribute('aria-valuenow', '256');
    await page.keyboard.press('End');
    await expect(splitter).toHaveAttribute('aria-valuenow', '420');

    await page.reload();
    await expect(
      page.getByRole('separator', { name: 'Resize layers and assets panel' }),
    ).toHaveAttribute('aria-valuenow', '420');

    await page.getByRole('button', { name: 'Hide inspector' }).click();
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show inspector' }).click();
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  });
});

test.describe('offline (PLAT-4)', () => {
  test('reloads and runs without a network after the first visit', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Media Studio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  });
});
