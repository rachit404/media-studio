import { expect, test } from '@playwright/test';

// Unlike the other tests, these start with nothing marked as seen.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('first-run walkthrough (F6)', () => {
  test('shows three steps on the start screen, once, and can be skipped or finished', async ({
    page,
  }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Start with a project' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Step 1 of 3')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Back' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('dialog', { name: 'Your files stay with you' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('dialog', { name: 'Start with a project' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('dialog', { name: 'Find any command' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // It stays away after a reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('each editor has its own, Escape counts as seen, and Settings can bring them back', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: 'Start with a project' })).toBeVisible();
    await page.keyboard.press('Escape'); // the start screen's one counts as seen
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'New video project' }).click();
    await page.getByLabel('Project name').fill('Walkthrough');
    await page.getByRole('button', { name: 'Create project' }).click();
    const video = page.getByRole('dialog', { name: 'Bring in media' });
    await expect(video).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: /^Settings/ }).click();
    await page.getByRole('button', { name: 'Show the tips again' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+h');
    await expect(page.getByRole('dialog', { name: 'Start with a project' })).toBeVisible();
  });
});
