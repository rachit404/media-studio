import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export interface Decoded {
  width: number;
  height: number;
  data: number[];
}

export const pixelAt = (image: Decoded, x: number, y: number): [number, number, number, number] => {
  const i = (y * image.width + x) * 4;
  return [
    image.data[i] ?? NaN,
    image.data[i + 1] ?? NaN,
    image.data[i + 2] ?? NaN,
    image.data[i + 3] ?? NaN,
  ];
};

/** Decode an image in the browser (same decoders the app uses) and return RGBA bytes. */
export async function decodeImage(page: Page, bytes: Buffer): Promise<Decoded> {
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const array = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([array]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data),
    };
  }, bytes.toString('base64'));
}

export function expectNear(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
  label = '',
): void {
  expected.forEach((value, index) => {
    const diff = Math.abs((actual[index] ?? NaN) - value);
    expect(
      diff,
      `${label} channel ${String(index)}: got ${String(actual[index])}, expected ${String(Math.round(value))}`,
    ).toBeLessThanOrEqual(tolerance);
  });
}

export async function createImageProject(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  const create = page.getByRole('button', { name: 'New image project' });
  await expect(create).toBeEnabled();
  await create.click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue(name);
}

/** Import PNGs and add each one as a layer, bottom to top. Returns once the last layer is in the stack. */
export async function addLayers(
  page: Page,
  images: { name: string; bytes: Buffer }[],
): Promise<void> {
  await page
    .getByTestId('import-input')
    .setInputFiles(
      images.map((image) => ({ name: image.name, mimeType: 'image/png', buffer: image.bytes })),
    );
  const assets = page.getByRole('list', { name: 'Project assets' });
  for (const image of images)
    await expect(assets.getByText(image.name, { exact: true })).toBeVisible();
  for (const image of images) {
    await page.getByRole('button', { name: `Add as layer: ${image.name}` }).click();
    await expect(
      page
        .getByRole('region', { name: 'Layers' })
        .getByRole('button', { name: image.name, exact: true }),
    ).toBeVisible();
  }
}

/** Set a range input (React listens for `input`). */
export async function setRange(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    // Use the native setter so React sees a real change (it tracks the value property).
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      String(next),
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

export interface ExportChoices {
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  scale?: number;
}

/** Export through the dialog and return the downloaded file. */
export async function exportAs(page: Page, choices: ExportChoices = {}): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  await expect(dialog).toBeVisible();
  if (choices.format) await dialog.getByLabel('Format').selectOption(choices.format);
  if (choices.quality !== undefined)
    await setRange(dialog.getByRole('slider', { name: 'Quality' }), choices.quality);
  if (choices.scale !== undefined) await dialog.getByLabel('Scale (%)').fill(String(choices.scale));
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const bytes = await readFile(path);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return bytes;
}
