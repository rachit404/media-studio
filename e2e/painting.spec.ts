import { expect, test, type Page } from '@playwright/test';
import {
  addLayers,
  createImageProject,
  decodeImage,
  expectNear,
  exportAs,
  pixelAt,
  setRange,
} from './helpers';
import { solidPng } from './png';

test.use({ colorScheme: 'dark' });

const CANVAS = { width: 200, height: 100 };
const WHITE = [255, 255, 255, 255];
const BRUSH_RED = [225, 29, 72, 255]; // the default brush colour

/** Screen position of a document point (the fitted view is centred on the canvas). */
async function docToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const area = page.getByRole('application', { name: /Image canvas/ });
  const box = await area.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const zoomText = await page.getByRole('status', { name: 'Zoom level' }).innerText();
  const zoom = Number(zoomText.replace('%', '')) / 100;
  return {
    x: box.x + box.width / 2 + (x - CANVAS.width / 2) * zoom,
    y: box.y + box.height / 2 + (y - CANVAS.height / 2) * zoom,
  };
}

/** Drag the mouse over the canvas from one document point to another. */
async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  modifiers: ('Shift' | 'Alt')[] = [],
): Promise<void> {
  const a = await docToScreen(page, ...from);
  const b = await docToScreen(page, ...to);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

const tool = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Tools' }).getByRole('button', { name, exact: true });

async function setup(page: Page, name: string): Promise<void> {
  await createImageProject(page, name);
  await addLayers(page, [
    { name: 'base.png', bytes: solidPng(CANVAS.width, CANVAS.height, [255, 255, 255, 255]) },
  ]);
}

async function addPaintLayer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Paint layer', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Layers' })
      .getByRole('button', { name: /^Paint layer\(paint\)/ }),
  ).toBeVisible();
}

const exported = async (page: Page) => decodeImage(page, await exportAs(page));

test.describe('painting', () => {
  test('a brush stroke paints in the chosen colour on a paint layer and undo restores the exact pixels', async ({
    page,
  }) => {
    await setup(page, 'Paint');
    await addPaintLayer(page);
    const before = await exported(page);
    expect(pixelAt(before, 100, 50)).toEqual(WHITE);

    await tool(page, 'Brush').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 30);
    await drag(page, [60, 50], [140, 50]);

    const after = await exported(page);
    expectNear(pixelAt(after, 100, 50), BRUSH_RED, 1, 'centre of the stroke');
    expectNear(pixelAt(after, 100, 90), WHITE, 0, 'away from the stroke');
    expectNear(pixelAt(after, 20, 50), WHITE, 0, 'before the stroke');

    await page.getByRole('button', { name: /^Undo/ }).click();
    const undone = await exported(page);
    expect(undone.data).toEqual(before.data); // exactly the same pixels
    await page.getByRole('button', { name: /^Redo/ }).click();
    const redone = await exported(page);
    expect(redone.data).toEqual(after.data);
  });

  test('the brush colour, size and opacity change the result', async ({ page }) => {
    await setup(page, 'Options');
    await addPaintLayer(page);
    await tool(page, 'Brush').click();
    await page.getByLabel('Brush colour').fill('#0000ff');
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 20);
    await setRange(page.getByRole('slider', { name: 'Brush opacity' }), 50);
    await drag(page, [50, 30], [150, 30]);
    const image = await exported(page);
    // Half-opaque blue over white.
    expectNear(pixelAt(image, 100, 30), [128, 128, 255, 255], 3, 'half opacity');
    expectNear(pixelAt(image, 100, 60), WHITE, 0, 'outside the brush');
  });

  test('the eraser removes paint but never touches the layer below', async ({ page }) => {
    await setup(page, 'Erase');
    await addPaintLayer(page);
    await tool(page, 'Brush').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 60);
    await drag(page, [60, 50], [140, 50]);
    expectNear(pixelAt(await exported(page), 100, 50), BRUSH_RED, 1);

    await tool(page, 'Eraser').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 20);
    await drag(page, [90, 50], [110, 50]);
    const image = await exported(page);
    expectNear(pixelAt(image, 100, 50), WHITE, 0, 'erased to the white layer below');
    expectNear(pixelAt(image, 70, 50), BRUSH_RED, 1, 'paint further along is still there');
  });

  test('brushing on a layer that cannot be painted explains what to do and changes nothing', async ({
    page,
  }) => {
    await setup(page, 'Hint');
    await tool(page, 'Brush').click();
    await expect(page.getByText('Select a paint layer to paint on it')).toBeVisible();
    const before = await exported(page);
    await drag(page, [60, 50], [140, 50]);
    expect((await exported(page)).data).toEqual(before.data);
  });

  test('painted pixels survive a crash and come back with the recovered project', async ({
    page,
  }) => {
    await setup(page, 'Durable');
    await addPaintLayer(page);
    await tool(page, 'Brush').click();
    await drag(page, [60, 50], [140, 50]);
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload(); // no checkpoint: the same as a crash

    await page
      .getByRole('alertdialog', { name: 'Restore unsaved changes?' })
      .getByRole('button', { name: 'Restore changes' })
      .click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Durable');
    expectNear(pixelAt(await exported(page), 100, 50), BRUSH_RED, 1);
  });

  test('painted pixels are part of an exported project archive', async ({ page }, testInfo) => {
    await setup(page, 'Archived');
    await addPaintLayer(page);
    await tool(page, 'Brush').click();
    await drag(page, [60, 50], [140, 50]);
    await page.getByRole('link', { name: 'Media Studio' }).click(); // closing saves a checkpoint

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Archived' }).click();
    const archivePath = testInfo.outputPath('Archived.msproj');
    await (await downloadPromise).saveAs(archivePath);

    await page.getByTestId('archive-input').setInputFiles(archivePath);
    const items = page.getByRole('list', { name: 'Recent projects' }).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await items.first().getByRole('link').click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toBeVisible();
    expectNear(pixelAt(await exported(page), 100, 50), BRUSH_RED, 1);
  });

  test('B and E switch between the brush and the eraser', async ({ page }) => {
    await setup(page, 'Keys');
    await page.keyboard.press('b');
    await expect(tool(page, 'Brush')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('e');
    await expect(tool(page, 'Eraser')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('v');
    await expect(tool(page, 'Move')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('selections', () => {
  test('painting stays inside a rectangular selection', async ({ page }) => {
    await setup(page, 'Select');
    await addPaintLayer(page);
    await tool(page, 'Rectangle select').click();
    await drag(page, [50, 20], [120, 80]);
    await expect(page.getByRole('group', { name: 'Selection', exact: true })).toContainText(
      '(active)',
    );

    await tool(page, 'Brush').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 200);
    await drag(page, [10, 50], [190, 50]);
    const image = await exported(page);
    expectNear(pixelAt(image, 80, 50), BRUSH_RED, 1, 'inside the selection');
    expectNear(pixelAt(image, 30, 50), WHITE, 0, 'left of the selection');
    expectNear(pixelAt(image, 160, 50), WHITE, 0, 'right of the selection');
    expectNear(pixelAt(image, 80, 90), WHITE, 0, 'below the selection');
  });

  test('invert selection paints the outside instead', async ({ page }) => {
    await setup(page, 'Invert');
    await addPaintLayer(page);
    await tool(page, 'Rectangle select').click();
    await drag(page, [50, 20], [120, 80]);
    await page.getByRole('button', { name: 'Invert selection' }).click();
    await tool(page, 'Brush').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 200);
    await drag(page, [10, 50], [190, 50]);
    const image = await exported(page);
    expectNear(pixelAt(image, 80, 50), WHITE, 0, 'inside the original rectangle');
    expectNear(pixelAt(image, 30, 50), BRUSH_RED, 1, 'outside the rectangle');
  });

  test('add and subtract modes combine selections; Deselect clears them', async ({ page }) => {
    await setup(page, 'Combine');
    await addPaintLayer(page);
    await tool(page, 'Rectangle select').click();
    await drag(page, [10, 10], [60, 90]);
    await drag(page, [140, 10], [190, 90], ['Shift']); // add a second box
    await drag(page, [40, 30], [160, 70], ['Alt']); // cut out the middle band
    await tool(page, 'Brush').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 200);
    await drag(page, [10, 50], [190, 50]);
    await drag(page, [10, 15], [190, 15]);
    const image = await exported(page);
    expectNear(pixelAt(image, 25, 15), BRUSH_RED, 1, 'first box');
    expectNear(pixelAt(image, 170, 15), BRUSH_RED, 1, 'second box');
    expectNear(pixelAt(image, 100, 15), WHITE, 0, 'gap between the boxes');
    expectNear(pixelAt(image, 50, 50), WHITE, 0, 'subtracted middle');

    await page.getByRole('button', { name: 'Deselect' }).click();
    await expect(page.getByRole('group', { name: 'Selection', exact: true })).toContainText(
      '(none)',
    );
  });

  test('ellipse and lasso selections limit painting to their shape', async ({ page }) => {
    await setup(page, 'Shapes');
    await addPaintLayer(page);
    await tool(page, 'Ellipse select').click();
    await drag(page, [40, 10], [160, 90]);
    await tool(page, 'Brush').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 200);
    await drag(page, [0, 50], [200, 50]);
    await drag(page, [0, 12], [200, 12]);
    const image = await exported(page);
    expectNear(pixelAt(image, 100, 50), BRUSH_RED, 1, 'ellipse centre');
    expectNear(pixelAt(image, 45, 14), WHITE, 0, 'box corner outside the ellipse');
    expectNear(pixelAt(image, 10, 50), WHITE, 0, 'outside the ellipse');
  });

  test('a selection becomes a layer mask that hides everything outside it', async ({ page }) => {
    await setup(page, 'ToMask');
    await tool(page, 'Rectangle select').click();
    await drag(page, [50, 20], [120, 80]);
    await page
      .getByRole('region', { name: 'Layers' })
      .getByRole('button', { name: 'base.png', exact: true })
      .click();
    await page.getByRole('button', { name: 'Selection to layer mask' }).click();

    const masked = await exported(page);
    expectNear(pixelAt(masked, 80, 50), WHITE, 0, 'inside the selection stays');
    expect(pixelAt(masked, 20, 50)[3]).toBe(0); // outside is hidden
    expect(pixelAt(masked, 150, 50)[3]).toBe(0);

    await page.getByRole('button', { name: 'Disable mask' }).click();
    expectNear(pixelAt(await exported(page), 20, 50), WHITE, 0, 'mask off shows everything');
    await page.getByRole('button', { name: 'Enable mask' }).click();
    expect(pixelAt(await exported(page), 20, 50)[3]).toBe(0);
    await page.getByRole('button', { name: 'Delete mask' }).click();
    expectNear(pixelAt(await exported(page), 20, 50), WHITE, 0, 'mask deleted');
  });
});

test.describe('layer masks and clipping', () => {
  test('painting on a mask hides and reveals parts of the layer; undo restores them', async ({
    page,
  }) => {
    await setup(page, 'Mask');
    await page.getByRole('button', { name: 'Add layer mask' }).click();
    await expect(page.getByRole('button', { name: 'Edit mask' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await tool(page, 'Eraser').click(); // on a mask the eraser hides
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 40);
    await drag(page, [60, 50], [140, 50]);
    const hidden = await exported(page);
    expect(pixelAt(hidden, 100, 50)[3]).toBe(0);
    expectNear(pixelAt(hidden, 100, 90), WHITE, 0, 'unpainted mask area still shows');

    await tool(page, 'Brush').click(); // the brush reveals again
    await drag(page, [95, 50], [105, 50]);
    const revealed = await exported(page);
    expectNear(pixelAt(revealed, 100, 50), WHITE, 1, 'revealed where the brush went');
    expect(pixelAt(revealed, 70, 50)[3]).toBe(0);

    await page.getByRole('button', { name: /^Undo/ }).click();
    expect((await exported(page)).data).toEqual(hidden.data);
  });

  test('with mask editing off, the brush paints the layer instead', async ({ page }) => {
    await setup(page, 'MaskOff');
    await addPaintLayer(page);
    await page.getByRole('button', { name: 'Add layer mask' }).click();
    await page.getByRole('button', { name: 'Edit mask' }).click(); // turn mask editing off
    await expect(page.getByRole('button', { name: 'Edit mask' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await tool(page, 'Brush').click();
    await drag(page, [60, 50], [140, 50]);
    expectNear(pixelAt(await exported(page), 100, 50), BRUSH_RED, 1);
  });

  test('a clipped layer only shows where the layer below has content', async ({ page }) => {
    await setup(page, 'Clip');
    // A small shape on top of the white base, then a paint layer clipped to it.
    await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
    await page.getByLabel('Width (px)', { exact: true }).fill('60');
    await page.getByLabel('Height (px)', { exact: true }).fill('60');
    await page.getByLabel('Fill colour').fill('#00ff00');
    await addPaintLayer(page);
    await page.getByRole('checkbox', { name: 'Clip to layer below' }).check();
    await tool(page, 'Brush').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 200);
    await drag(page, [0, 50], [200, 50]);
    const clipped = await exported(page);
    expectNear(pixelAt(clipped, 100, 50), BRUSH_RED, 1, 'inside the circle');
    expectNear(pixelAt(clipped, 20, 50), WHITE, 0, 'outside the circle: only the base');

    await page.getByRole('checkbox', { name: 'Clip to layer below' }).uncheck();
    expectNear(
      pixelAt(await exported(page), 20, 50),
      BRUSH_RED,
      1,
      'released: paint shows everywhere',
    );
  });

  test('moving a paint layer moves its pixels', async ({ page }) => {
    await setup(page, 'Moved');
    await addPaintLayer(page);
    await tool(page, 'Brush').click();
    await setRange(page.getByRole('slider', { name: 'Brush size' }), 20);
    await drag(page, [60, 50], [80, 50]);
    await page.getByLabel('X (px)', { exact: true }).fill('150'); // was 100: shift 50 right
    const image = await exported(page);
    expectNear(pixelAt(image, 120, 50), BRUSH_RED, 1, 'painted pixels followed the layer');
    expectNear(pixelAt(image, 70, 50), WHITE, 0, 'old position is clear');
  });
});
