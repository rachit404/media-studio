import { expect, test, type Page } from '@playwright/test';
import { createVideoProject } from './helpers';

test.setTimeout(90_000);

/** Stop a worker of the page the way a crash would: it just ends, and nothing tells the page. */
async function killWorker(page: Page, nameFragment: string): Promise<boolean> {
  const worker = page.workers().find((candidate) => candidate.url().includes(nameFragment));
  if (!worker) return false;
  // close() ends the worker's scope at once without an error event, like the browser killing it would.
  await worker.evaluate(() => {
    self.close();
  });
  return true;
}

test.describe('worker crash recovery (REL-4)', () => {
  test('the app keeps working after its storage worker is killed', async ({ page }) => {
    await createVideoProject(page, 'Survivor');
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    // Back to the home screen without reloading the page, so the same worker is still the one in use.
    await page.getByRole('link', { name: 'Media Studio' }).click();
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
    // Give the page time to arm its watch on the worker (it does so after the first answer).
    await page.waitForTimeout(500);

    expect(await killWorker(page, 'storage.worker')).toBe(true);
    await page.waitForTimeout(1000); // the page notices through the released lock

    // The next action starts a new worker and works: the old project is still there, and a new one can be made.
    const create = page.getByRole('button', { name: 'New video project' });
    await expect(create).toBeEnabled();
    await create.click();
    await page.getByLabel('Project name').fill('After the crash');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue(
      'After the crash',
    );
    await page.getByRole('link', { name: 'Media Studio' }).click();
    await expect(page.getByText('Survivor')).toBeVisible();
    await expect(page.getByText('After the crash')).toBeVisible();
  });
});
