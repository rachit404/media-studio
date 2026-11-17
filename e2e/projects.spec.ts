import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ colorScheme: 'dark' });

// A valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function createImageProject(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  const create = page.getByRole('button', { name: 'New image project' });
  await expect(create).toBeEnabled(); // enabled once the startup write check has passed
  await create.click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue(name);
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
}

async function importPng(page: Page, name = 'sample.png'): Promise<void> {
  await page
    .getByTestId('import-input')
    .setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('list', { name: 'Project assets' }).getByText(name)).toBeVisible();
}

test.describe('projects (PROJ-1, PROJ-6, ASSET-1)', () => {
  test('creates a project, imports an image and supports undo and redo', async ({ page }) => {
    await createImageProject(page, 'Holiday');
    await importPng(page);
    const assets = page.getByRole('list', { name: 'Project assets' });
    await expect(assets).toContainText('1 × 1');
    await expect(page.getByText('Imported 1 image.')).toBeVisible();

    await page.getByRole('heading', { name: 'Assets' }).click(); // move focus out of any field
    await page.keyboard.press('Control+z');
    await expect(page.getByText('Drop images here')).toBeVisible();
    await page.keyboard.press('Control+Shift+z');
    await expect(assets.getByText('sample.png')).toBeVisible();
    await page.keyboard.press('Control+z');
    await page.getByRole('button', { name: /^Redo/ }).click();
    await expect(assets.getByText('sample.png')).toBeVisible();
  });

  test('rejects unsupported and spoofed files with a clear message while keeping good ones', async ({
    page,
  }) => {
    await createImageProject(page, 'Mixed');
    await page.getByTestId('import-input').setInputFiles([
      {
        name: 'notes.png',
        mimeType: 'image/png',
        buffer: Buffer.from('this is text, not an image'),
      },
      { name: 'good.png', mimeType: 'image/png', buffer: PNG },
    ]);
    const problems = page.getByRole('list', { name: 'Import problems' });
    await expect(problems).toContainText('notes.png');
    await expect(problems).toContainText('not supported');
    await expect(
      page.getByRole('list', { name: 'Project assets' }).getByText('good.png'),
    ).toBeVisible();
  });

  test('a normal close saves everything: reopening shows no recovery prompt (REL-1)', async ({
    page,
  }) => {
    await createImageProject(page, 'Original');
    await importPng(page);
    await page.getByRole('textbox', { name: 'Project name' }).fill('Renamed');
    await page.getByRole('link', { name: 'Media Studio' }).click(); // leaves the project: saves a checkpoint

    const item = page.getByRole('list', { name: 'Recent projects' }).getByRole('listitem').first();
    await expect(item.getByRole('link', { name: 'Renamed' })).toBeVisible();
    await expect(item).toContainText('1 asset');
    await item.getByRole('link', { name: 'Renamed' }).click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Renamed');
    await expect(
      page.getByRole('list', { name: 'Project assets' }).getByText('sample.png'),
    ).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('offers to restore unsaved changes after the tab is killed mid-edit, and can discard them', async ({
    page,
  }) => {
    await createImageProject(page, 'Crash test');
    await page.getByRole('textbox', { name: 'Project name' }).fill('After crash');
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible(); // journal written
    await page.reload(); // no checkpoint was written: same as a crash

    const prompt = page.getByRole('alertdialog', { name: 'Restore unsaved changes?' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Restore changes' }).click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('After crash');

    // Second round: discard instead.
    await page.getByRole('textbox', { name: 'Project name' }).fill('Thrown away');
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('After crash');
  });

  test('exports a project archive and imports it back as a second project (PROJ-4)', async ({
    page,
  }, testInfo) => {
    await createImageProject(page, 'Portable');
    await importPng(page);
    await page.getByRole('link', { name: 'Media Studio' }).click();

    const exportButton = page.getByRole('button', { name: 'Export Portable' });
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Portable.msproj');
    const archivePath = testInfo.outputPath('Portable.msproj');
    await download.saveAs(archivePath);
    expect((await readFile(archivePath)).subarray(0, 2).toString()).toBe('PK'); // a ZIP file

    await page.getByTestId('archive-input').setInputFiles(archivePath);
    const items = page.getByRole('list', { name: 'Recent projects' }).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await items.first().getByRole('link').click();
    await expect(
      page.getByRole('list', { name: 'Project assets' }).getByText('sample.png'),
    ).toBeVisible();
  });

  test('rejects a file that is not a project archive', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'New image project' })).toBeEnabled();
    await page.getByTestId('archive-input').setInputFiles({
      name: 'fake.msproj',
      mimeType: 'application/zip',
      buffer: Buffer.from('definitely not a zip'),
    });
    await expect(
      page.getByRole('status').filter({ hasText: 'not a valid project archive' }),
    ).toBeVisible();
    await expect(page.getByText('No projects yet.')).toBeVisible();
  });

  test('deletes a project after confirmation', async ({ page }) => {
    await createImageProject(page, 'Temporary');
    await page.getByRole('link', { name: 'Media Studio' }).click();
    await page.getByRole('button', { name: 'Delete Temporary' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete project' }).click();
    await expect(page.getByText('No projects yet.')).toBeVisible();
  });

  test('shows a clear error for a project that does not exist', async ({ page }) => {
    await page.goto('/#/project/does-not-exist');
    await expect(page.getByRole('heading', { name: "This project can't be opened" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
  });
});

test.describe('storage settings (PLAT-7, REL-5)', () => {
  test('shows the write check and clears all local data after confirmation', async ({ page }) => {
    await createImageProject(page, 'Clear me');
    await page.getByRole('link', { name: 'Media Studio' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'Storage' }).click();
    await expect(dialog).toContainText('Write check: passed');
    await expect(dialog).toContainText('Total');

    await dialog.getByRole('button', { name: 'Clear all local data' }).click();
    await page
      .getByRole('alertdialog', { name: 'Clear all local data?' })
      .getByRole('button', { name: 'Delete everything' })
      .click();
    await expect(dialog.getByRole('status')).toContainText(
      'All local projects and files were deleted.',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByText('No projects yet.')).toBeVisible();
  });
});
