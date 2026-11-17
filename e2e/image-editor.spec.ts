import { BLEND_MODES, applyAdjustment, compositeOver, type Rgba } from '../packages/core/src/index';
import { expect, test } from '@playwright/test';
import {
  addLayers,
  createImageProject,
  decodeImage,
  expectNear,
  exportAs,
  pixelAt,
  setRange,
} from './helpers';
import { encodePng, solidPng, textChunk } from './png';

test.use({ colorScheme: 'dark' });

const rgba = (r: number, g: number, b: number, a = 1): Rgba => [r / 255, g / 255, b / 255, a];
const to255 = (c: readonly number[]) => c.slice(0, 3).map((v) => v * 255);

test.describe('image editor: layers and export (IMG-1, IMG-3, IMG-4, IMG-13)', () => {
  test('exports a single layer at the image size with exact colours', async ({ page }) => {
    await createImageProject(page, 'Single');
    await addLayers(page, [{ name: 'base.png', bytes: solidPng(8, 4, [200, 100, 50, 255]) }]);
    await expect(page.getByText('8 × 4 px').first()).toBeVisible();

    const image = await decodeImage(page, await exportAs(page));
    expect([image.width, image.height]).toEqual([8, 4]);
    for (const [x, y] of [
      [0, 0],
      [7, 3],
      [3, 2],
    ] as const)
      expectNear(pixelAt(image, x, y), [200, 100, 50, 255], 1);
  });

  test('blend modes and opacity match the W3C reference within 2/255', async ({ page }) => {
    test.setTimeout(300_000);
    const base = [200, 100, 50] as const;
    const top = [50, 150, 250] as const;
    await createImageProject(page, 'Blend');
    await addLayers(page, [
      { name: 'base.png', bytes: solidPng(8, 8, [...base, 255]) },
      { name: 'top.png', bytes: solidPng(8, 8, [...top, 255]) },
    ]);

    for (const mode of BLEND_MODES) {
      for (const opacity of [100, 50]) {
        await page.getByRole('combobox', { name: 'Blend mode' }).selectOption(mode);
        await setRange(page.getByRole('slider', { name: 'Opacity' }), opacity);
        const image = await decodeImage(page, await exportAs(page));
        const expected = compositeOver(rgba(...base), rgba(...top), mode, opacity / 100);
        expectNear(
          pixelAt(image, 4, 4),
          [...to255(expected), 255],
          2,
          `${mode} at ${String(opacity)}%`,
        );
      }
    }
  });

  test('transparency: a half-transparent layer composites over the layer below and keeps alpha on its own', async ({
    page,
  }) => {
    await createImageProject(page, 'Alpha');
    await addLayers(page, [{ name: 'glass.png', bytes: solidPng(8, 8, [255, 0, 0, 128]) }]);
    const alone = await decodeImage(page, await exportAs(page));
    const [r, , , a] = pixelAt(alone, 4, 4);
    expect(a).toBeGreaterThanOrEqual(126);
    expect(a).toBeLessThanOrEqual(130);
    expect(r).toBeGreaterThanOrEqual(252); // straight (not premultiplied) colour survives

    await addLayers(page, [{ name: 'blue.png', bytes: solidPng(8, 8, [0, 0, 255, 255]) }]);
    // Move the blue layer below the glass: it is the top layer, so move it down once.
    await page.getByRole('button', { name: 'Move blue.png down' }).click();
    const over = await decodeImage(page, await exportAs(page));
    const expected = compositeOver(rgba(0, 0, 255), rgba(255, 0, 0, 128 / 255), 'normal', 1);
    expectNear(pixelAt(over, 4, 4), [...to255(expected), 255], 2);
  });

  test('adjustment layers apply in order to everything below them', async ({ page }) => {
    await createImageProject(page, 'Adjust');
    await addLayers(page, [{ name: 'base.png', bytes: solidPng(8, 8, [180, 120, 60, 255]) }]);

    await page.getByRole('button', { name: 'Brightness/Contrast', exact: true }).click();
    await setRange(page.getByRole('slider', { name: 'Brightness' }), 20);
    await setRange(page.getByRole('slider', { name: 'Contrast' }), 30);
    await page.getByRole('button', { name: 'Exposure', exact: true }).click();
    await setRange(page.getByRole('slider', { name: 'Exposure (stops)' }), 1);
    await page.getByRole('button', { name: 'Saturation', exact: true }).click();
    await setRange(page.getByRole('slider', { name: 'Saturation', exact: true }), -60);

    let expected = rgba(180, 120, 60);
    expected = applyAdjustment(expected, {
      kind: 'brightness-contrast',
      brightness: 0.2,
      contrast: 0.3,
    });
    expected = applyAdjustment(expected, { kind: 'exposure', exposure: 1 });
    expected = applyAdjustment(expected, { kind: 'saturation', saturation: -0.6 });

    const image = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(image, 4, 4), [...to255(expected), 255], 2);

    // Hiding the adjustment layers brings back the original colour.
    for (const name of ['Brightness/Contrast', 'Exposure', 'Saturation']) {
      await page.getByRole('button', { name: `Hide ${name}`, exact: true }).click();
    }
    const plain = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(plain, 4, 4), [180, 120, 60, 255], 1);
  });

  test('levels and black & white match the reference within 2/255', async ({ page }) => {
    await createImageProject(page, 'Levels');
    await addLayers(page, [{ name: 'base.png', bytes: solidPng(8, 8, [180, 120, 60, 255]) }]);

    await page.getByRole('button', { name: 'Levels', exact: true }).click();
    await setRange(page.getByRole('slider', { name: 'Input black' }), 30);
    await setRange(page.getByRole('slider', { name: 'Input white' }), 230);
    await setRange(page.getByRole('slider', { name: 'Gamma' }), 1.6);
    await setRange(page.getByRole('slider', { name: 'Output black' }), 10);
    await setRange(page.getByRole('slider', { name: 'Output white' }), 245);
    const levels = {
      kind: 'levels',
      inBlack: 30 / 255,
      inWhite: 230 / 255,
      gamma: 1.6,
      outBlack: 10 / 255,
      outWhite: 245 / 255,
    } as const;
    const afterLevels = applyAdjustment(rgba(180, 120, 60), levels);
    const first = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(first, 4, 4), [...to255(afterLevels), 255], 2, 'levels');

    await page.getByRole('button', { name: 'Black & White', exact: true }).click();
    await setRange(page.getByRole('slider', { name: 'Amount' }), 60);
    const afterBw = applyAdjustment(afterLevels, { kind: 'black-white', amount: 0.6 });
    const second = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(second, 4, 4), [...to255(afterBw), 255], 2, 'black & white');
  });

  test('blur softens an edge, keeps flat areas and stays inside the canvas', async ({ page }) => {
    await createImageProject(page, 'Blur');
    await addLayers(page, [
      {
        name: 'edge.png',
        bytes: encodePng(64, 32, (x) => (x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
      },
    ]);
    const sharp = await decodeImage(page, await exportAs(page));
    expect(pixelAt(sharp, 31, 16)[0]).toBe(0);
    expect(pixelAt(sharp, 32, 16)[0]).toBe(255);

    await page.getByRole('button', { name: 'Blur', exact: true }).click();
    await setRange(page.getByRole('slider', { name: 'Radius' }), 8);
    const soft = await decodeImage(page, await exportAs(page));
    const left = pixelAt(soft, 31, 16);
    const right = pixelAt(soft, 32, 16);
    expect(left[0]).toBeGreaterThan(40);
    expect(left[0]).toBeLessThan(128);
    expect(right[0]).toBeGreaterThan(128);
    expect(right[0]).toBeLessThan(215);
    expect(left[0] + right[0]).toBeGreaterThanOrEqual(250); // symmetric around the edge
    expect(left[0] + right[0]).toBeLessThanOrEqual(260);
    expectNear(pixelAt(soft, 2, 16), [0, 0, 0, 255], 1, 'far from the edge');
    expectNear(pixelAt(soft, 61, 16), [255, 255, 255, 255], 1, 'far from the edge');
    // Nothing transparent bleeds in from outside the canvas, so the corners stay opaque.
    expect(pixelAt(soft, 0, 0)[3]).toBe(255);
    expect(pixelAt(soft, 63, 31)[3]).toBe(255);
  });

  test('sharpen adds contrast at an edge and leaves flat areas alone', async ({ page }) => {
    await createImageProject(page, 'Sharpen');
    await addLayers(page, [
      {
        name: 'soft.png',
        bytes: encodePng(64, 32, (x) => (x < 32 ? [100, 100, 100, 255] : [150, 150, 150, 255])),
      },
    ]);
    await page.getByRole('button', { name: 'Sharpen', exact: true }).click();
    await setRange(page.getByRole('slider', { name: 'Amount' }), 2);
    await setRange(page.getByRole('slider', { name: 'Radius' }), 4);
    const image = await decodeImage(page, await exportAs(page));
    expect(pixelAt(image, 31, 16)[0]).toBeLessThan(95);
    expect(pixelAt(image, 32, 16)[0]).toBeGreaterThan(155);
    expectNear(pixelAt(image, 3, 16), [100, 100, 100, 255], 1, 'flat left');
    expectNear(pixelAt(image, 60, 16), [150, 150, 150, 255], 1, 'flat right');
  });

  test('a filter preset adds editable adjustment layers in one undo step', async ({ page }) => {
    await createImageProject(page, 'Presets');
    await addLayers(page, [{ name: 'base.png', bytes: solidPng(8, 8, [180, 120, 60, 255]) }]);
    await page.getByRole('button', { name: 'Mono', exact: true }).click();

    let expected = applyAdjustment(rgba(180, 120, 60), { kind: 'black-white', amount: 1 });
    expected = applyAdjustment(expected, {
      kind: 'brightness-contrast',
      brightness: 0,
      contrast: 0.1,
    });
    const image = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(image, 4, 4), [...to255(expected), 255], 2, 'mono');
    const layers = page.getByRole('region', { name: 'Layers' });
    await expect(layers.getByRole('button', { name: /^Mono\(adjustment\)/ })).toBeVisible();
    await expect(layers.getByRole('button', { name: /^Mono contrast/ })).toBeVisible();

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(layers.getByRole('button', { name: /^Mono contrast/ })).toHaveCount(0);
    const plain = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(plain, 4, 4), [180, 120, 60, 255], 1, 'after undo');
  });

  test('layers can be hidden, reordered, deleted and restored with undo', async ({ page }) => {
    await createImageProject(page, 'Stack');
    await addLayers(page, [
      { name: 'one.png', bytes: solidPng(4, 4, [255, 0, 0, 255]) },
      { name: 'two.png', bytes: solidPng(4, 4, [0, 255, 0, 255]) },
    ]);
    const layers = page.getByRole('region', { name: 'Layers' });
    await layers.getByRole('button', { name: 'Hide two.png' }).click();
    const hidden = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(hidden, 1, 1), [255, 0, 0, 255], 1);

    await layers.getByRole('button', { name: 'Show two.png' }).click();
    await layers.getByRole('button', { name: 'Move two.png down' }).click();
    const reordered = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(reordered, 1, 1), [255, 0, 0, 255], 1); // one.png is on top now

    await layers.getByRole('button', { name: 'Delete one.png' }).click();
    const deleted = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(deleted, 1, 1), [0, 255, 0, 255], 1);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(layers.getByRole('button', { name: 'one.png', exact: true })).toBeVisible();
  });
});

test.describe('image editor: canvas operations (IMG-2)', () => {
  const twoTone = () => encodePng(8, 4, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  const RED = [255, 0, 0, 255];
  const BLUE = [0, 0, 255, 255];

  test('rotate, flip, crop and resize change the output as expected and undo cleanly', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createImageProject(page, 'Canvas');
    await addLayers(page, [{ name: 'two.png', bytes: twoTone() }]);
    const undo = () => page.getByRole('button', { name: /^Undo/ }).click();

    // Rotate right: the red left half ends up on top.
    await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
    let image = await decodeImage(page, await exportAs(page));
    expect([image.width, image.height]).toEqual([4, 8]);
    expectNear(pixelAt(image, 1, 1), RED, 1);
    expectNear(pixelAt(image, 2, 6), BLUE, 1);
    await undo();

    // Flip horizontally swaps the halves.
    await page.getByRole('button', { name: 'Flip horizontally', exact: true }).click();
    image = await decodeImage(page, await exportAs(page));
    expect([image.width, image.height]).toEqual([8, 4]);
    expectNear(pixelAt(image, 1, 1), BLUE, 1);
    expectNear(pixelAt(image, 6, 1), RED, 1);
    await undo();

    // Crop to columns 2..5.
    await page.getByRole('button', { name: 'Crop…' }).click();
    const crop = page.getByRole('dialog', { name: 'Crop canvas' });
    await crop.getByLabel('Left (px)').fill('2');
    await crop.getByLabel('Width (px)').fill('4');
    await crop.getByRole('button', { name: 'Apply crop' }).click();
    image = await decodeImage(page, await exportAs(page));
    expect([image.width, image.height]).toEqual([4, 4]);
    expectNear(pixelAt(image, 0, 2), RED, 1);
    expectNear(pixelAt(image, 3, 2), BLUE, 1);
    await undo();

    // Resize to half width.
    await page.getByRole('button', { name: 'Resize…' }).click();
    const resize = page.getByRole('dialog', { name: 'Resize image' });
    await resize.getByLabel('Width (px)').fill('4');
    await expect(resize).toContainText('4 × 2 px');
    await resize.getByRole('button', { name: 'Apply resize' }).click();
    image = await decodeImage(page, await exportAs(page));
    expect([image.width, image.height]).toEqual([4, 2]);
    expectNear(pixelAt(image, 0, 0), RED, 2);
    expectNear(pixelAt(image, 3, 1), BLUE, 2);
  });

  test('the layer cannot show outside the canvas after a crop (non-destructive crop)', async ({
    page,
  }) => {
    await createImageProject(page, 'Clip');
    await addLayers(page, [{ name: 'two.png', bytes: twoTone() }]);
    await page.getByRole('button', { name: 'Crop…' }).click();
    const crop = page.getByRole('dialog', { name: 'Crop canvas' });
    await crop.getByLabel('Width (px)').fill('4');
    await crop.getByRole('button', { name: 'Apply crop' }).click();
    const image = await decodeImage(page, await exportAs(page));
    // Only the red half remains; nothing blue leaks in from outside the canvas.
    for (let x = 0; x < 4; x += 1) expectNear(pixelAt(image, x, 2), RED, 1);
  });

  test('invalid crops are refused with a message and change nothing', async ({ page }) => {
    await createImageProject(page, 'Bad crop');
    await addLayers(page, [{ name: 'two.png', bytes: twoTone() }]);
    await page.getByRole('button', { name: 'Crop…' }).click();
    const crop = page.getByRole('dialog', { name: 'Crop canvas' });
    await crop.getByLabel('Width (px)').fill('9999');
    await crop.getByRole('button', { name: 'Apply crop' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'inside the image' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('8 × 4 px').first()).toBeVisible();
  });
});

test.describe('image export options (IMG-13)', () => {
  test('writes real PNG, JPEG and WebP files and scales the output', async ({ page }) => {
    await createImageProject(page, 'Formats');
    await addLayers(page, [{ name: 'base.png', bytes: solidPng(10, 6, [10, 200, 90, 255]) }]);

    const png = await exportAs(page, { format: 'png' });
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const jpeg = await exportAs(page, { format: 'jpeg', quality: 90 });
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const webp = await exportAs(page, { format: 'webp', quality: 90 });
    expect(webp.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(webp.subarray(8, 12).toString('ascii')).toBe('WEBP');

    const doubled = await decodeImage(page, await exportAs(page, { format: 'png', scale: 200 }));
    expect([doubled.width, doubled.height]).toEqual([20, 12]);
    expectNear(pixelAt(doubled, 10, 6), [10, 200, 90, 255], 1);
  });

  test('lower JPEG quality gives a smaller file', async ({ page }) => {
    await createImageProject(page, 'Quality');
    let seed = 7;
    const noise = encodePng(96, 96, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return [seed & 255, (seed >> 8) & 255, (seed >> 16) & 255, 255];
    });
    await addLayers(page, [{ name: 'noise.png', bytes: noise }]);
    const low = await exportAs(page, { format: 'jpeg', quality: 10 });
    const high = await exportAs(page, { format: 'jpeg', quality: 95 });
    expect(low.length).toBeLessThan(high.length);
  });

  test('JPEG fills transparent areas with the chosen colour', async ({ page }) => {
    await createImageProject(page, 'Flatten');
    await addLayers(page, [{ name: 'empty.png', bytes: solidPng(8, 8, [0, 0, 0, 0]) }]);
    const jpeg = await decodeImage(page, await exportAs(page, { format: 'jpeg', quality: 100 }));
    expectNear(pixelAt(jpeg, 4, 4), [255, 255, 255, 255], 3); // default fill colour is white
  });

  test('exports never contain metadata from the originals (SEC-4)', async ({ page }) => {
    await createImageProject(page, 'Private');
    const tagged = solidPng(
      8,
      8,
      [1, 2, 3, 255],
      [textChunk('GPSLatitude', '48.8584'), textChunk('Software', 'SecretCamera')],
    );
    expect(tagged.includes('48.8584')).toBe(true); // sanity: the input really has the tag
    await addLayers(page, [{ name: 'gps.png', bytes: tagged }]);
    const out = await exportAs(page);
    expect(out.includes('GPSLatitude')).toBe(false);
    expect(out.includes('48.8584')).toBe(false);
    expect(out.includes('SecretCamera')).toBe(false);
  });

  test('refuses to export an empty document with a clear message', async ({ page }) => {
    await createImageProject(page, 'Empty');
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export image' });
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('nothing to export');
  });
});

test.describe('interactive canvas', () => {
  test('draws the document, zooms and keeps the layer inside the canvas rectangle', async ({
    page,
  }) => {
    await createImageProject(page, 'Live');
    await addLayers(page, [{ name: 'big.png', bytes: solidPng(200, 100, [200, 100, 50, 255]) }]);
    const canvas = page.getByTestId('image-canvas');
    await expect
      .poll(
        async () => {
          const shot = await decodeImage(page, await canvas.screenshot());
          return pixelAt(shot, Math.floor(shot.width / 2), Math.floor(shot.height / 2)).join(',');
        },
        { timeout: 10_000 },
      )
      .toBe('200,100,50,255');

    const zoom = page.getByRole('status', { name: 'Zoom level' });
    const before = await zoom.innerText();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(zoom).not.toHaveText(before);
    await page.getByRole('button', { name: 'Fit' }).click();
    await expect(zoom).toHaveText(before);
  });

  test('moves the selected layer with the keyboard and the inspector, with undo', async ({
    page,
  }) => {
    await createImageProject(page, 'Move');
    await addLayers(page, [{ name: 'a.png', bytes: solidPng(40, 40, [255, 0, 0, 255]) }]);
    const x = page.getByLabel('X (px)');
    await expect(x).toHaveValue('20');
    await page.getByRole('application', { name: /Image canvas/ }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(x).toHaveValue('31');
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(x).toHaveValue('20'); // arrow presses coalesced into one undo step
  });
});

test.describe('performance baseline (PERF-1)', () => {
  test.skip(
    Boolean(process.env['CI']),
    'Frame timing needs a real GPU; measured on the reference machine.',
  );

  test('pans and zooms a 4096² canvas with ten layers smoothly', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await createImageProject(page, 'Perf');
    const colors: [number, number, number, number][] = Array.from({ length: 10 }, (_, i) => [
      (i * 25) % 256,
      (i * 60) % 256,
      (i * 90) % 256,
      255,
    ]);
    const images = colors.map((color, i) => ({
      name: `layer${String(i)}.png`,
      bytes: i === 0 ? solidPng(4096, 4096, color) : solidPng(2048, 2048, color),
    }));
    await addLayers(page, images);
    for (let i = 1; i < 10; i += 1) {
      await page
        .getByRole('region', { name: 'Layers' })
        .getByRole('button', { name: `layer${String(i)}.png`, exact: true })
        .click();
      await page
        .getByRole('combobox', { name: 'Blend mode' })
        .selectOption(i % 2 ? 'multiply' : 'overlay');
    }
    await page.getByRole('button', { name: 'Fit' }).click();

    const result = await page.evaluate(async () => {
      const container = document.querySelector('[role="application"]');
      if (!container) throw new Error('canvas container not found');
      const box = container.getBoundingClientRect();
      const stamps: number[] = [];
      await new Promise<void>((resolve) => {
        let frame = 0;
        const step = (time: number) => {
          stamps.push(time);
          container.dispatchEvent(
            new WheelEvent('wheel', {
              deltaY: frame % 40 < 20 ? -40 : 40,
              clientX: box.left + box.width / 2,
              clientY: box.top + box.height / 2,
              bubbles: true,
              cancelable: true,
            }),
          );
          frame += 1;
          if (frame < 240) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      return stamps.slice(1).map((t, i) => t - (stamps[i] ?? t));
    });
    const sorted = [...result].sort((a, b) => a - b);
    const pick = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;
    const summary = {
      frames: result.length,
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      max: sorted.at(-1),
    };
    testInfo.annotations.push({ type: 'perf', description: JSON.stringify(summary) });
    console.log('PERF-1 frame intervals (ms):', JSON.stringify(summary));
    expect(summary.p95).toBeLessThan(40);
  });
});

test.describe('graphics failure', () => {
  test('shows a clear message instead of a blank canvas when the canvas cannot get WebGL2', async ({
    page,
  }) => {
    // The startup probe uses an OffscreenCanvas and passes; the visible canvas then fails to get a context.
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await createImageProject(page, 'NoGL');
    await expect(page.getByRole('alert').filter({ hasText: 'WebGL 2' })).toBeVisible();
  });
});

test.describe('text and shape layers (IMG-7, IMG-8)', () => {
  const base = () => solidPng(200, 100, [255, 255, 255, 255]);

  async function addGenerated(page: Parameters<typeof createImageProject>[0], button: string) {
    await page
      .getByRole('region', { name: 'Layers' })
      .getByRole('button', { name: button, exact: true })
      .click();
  }

  test('a filled rectangle is drawn at its size and position, and follows its settings', async ({
    page,
  }) => {
    await createImageProject(page, 'Shapes');
    await addLayers(page, [{ name: 'paper.png', bytes: base() }]);
    await addGenerated(page, 'Rectangle');
    await page.getByLabel('Width (px)', { exact: true }).fill('40');
    await page.getByLabel('Height (px)', { exact: true }).fill('20');
    await page.getByLabel('Fill colour').fill('#ff0000');

    let image = await decodeImage(page, await exportAs(page));
    expect([image.width, image.height]).toEqual([200, 100]);
    expectNear(pixelAt(image, 100, 50), [255, 0, 0, 255], 2); // centre of the rectangle
    expectNear(pixelAt(image, 85, 45), [255, 0, 0, 255], 2); // inside near the left edge
    expectNear(pixelAt(image, 70, 50), [255, 255, 255, 255], 2); // outside, 30 px from the centre
    expectNear(pixelAt(image, 100, 70), [255, 255, 255, 255], 2); // outside below (half height is 10)

    // Turn the fill off and add a stroke instead: the centre becomes the paper colour again.
    await page.getByRole('checkbox', { name: 'Fill' }).uncheck();
    await page.getByRole('checkbox', { name: 'Stroke' }).check();
    await page.getByLabel('Stroke width (px)').fill('6');
    image = await decodeImage(page, await exportAs(page));
    expectNear(pixelAt(image, 100, 50), [255, 255, 255, 255], 2);
    expectNear(pixelAt(image, 100, 40), [0, 0, 0, 255], 40); // on the top edge of the outline (strokes are anti-aliased)
  });

  test('ellipse and polygon cover their centre but not the corners of their box', async ({
    page,
  }) => {
    await createImageProject(page, 'Round');
    await addLayers(page, [{ name: 'paper.png', bytes: base() }]);
    for (const shape of ['Ellipse', 'Polygon']) {
      await addGenerated(page, shape);
      await page.getByLabel('Width (px)', { exact: true }).fill('60');
      await page.getByLabel('Height (px)', { exact: true }).fill('60');
    }
    const image = await decodeImage(page, await exportAs(page));
    const [r, g, b] = pixelAt(image, 100, 50);
    expect([r, g, b]).not.toEqual([255, 255, 255]); // painted
    expectNear(pixelAt(image, 72, 22), [255, 255, 255, 255], 2); // the corner of the 60x60 box is empty for both shapes
  });

  test('text is drawn in its colour, changes with its settings, and can be undone', async ({
    page,
  }) => {
    await createImageProject(page, 'Words');
    await addLayers(page, [{ name: 'paper.png', bytes: base() }]);
    await addGenerated(page, 'Text');
    await page.getByLabel('Content').fill('MMMM');
    await page.getByLabel('Size (px)').fill('90');
    await page.getByLabel('Weight').selectOption('700');
    await page.getByLabel('Text colour').fill('#ff0000');

    const redPixels = (image: Awaited<ReturnType<typeof decodeImage>>) => {
      let count = 0;
      for (let i = 0; i < image.data.length; i += 4) {
        if (
          (image.data[i] ?? 0) > 200 &&
          (image.data[i + 1] ?? 255) < 60 &&
          (image.data[i + 2] ?? 255) < 60
        )
          count += 1;
      }
      return count;
    };
    const large = await decodeImage(page, await exportAs(page));
    expect(redPixels(large)).toBeGreaterThan(200);

    await page.getByLabel('Size (px)').fill('20');
    const small = await decodeImage(page, await exportAs(page));
    expect(redPixels(small)).toBeGreaterThan(0);
    expect(redPixels(small)).toBeLessThan(redPixels(large));

    await page.getByRole('button', { name: /^Undo/ }).click(); // back to the 90 px text (typing coalesces)
    const undone = await decodeImage(page, await exportAs(page));
    expect(redPixels(undone)).toBe(redPixels(large));
  });

  test('generated layers support blend modes and opacity like any other layer', async ({
    page,
  }) => {
    await createImageProject(page, 'Blendy');
    await addLayers(page, [{ name: 'paper.png', bytes: solidPng(200, 100, [200, 100, 50, 255]) }]);
    await addGenerated(page, 'Rectangle');
    await page.getByLabel('Width (px)', { exact: true }).fill('400');
    await page.getByLabel('Height (px)', { exact: true }).fill('400');
    await page.getByLabel('Fill colour').fill('#3296fa');
    await page.getByRole('combobox', { name: 'Blend mode' }).selectOption('multiply');
    await setRange(page.getByRole('slider', { name: 'Opacity' }), 50);
    const image = await decodeImage(page, await exportAs(page));
    const expected = compositeOver(rgba(200, 100, 50), rgba(50, 150, 250), 'multiply', 0.5);
    expectNear(pixelAt(image, 100, 50), [...to255(expected), 255], 2);
  });
});
