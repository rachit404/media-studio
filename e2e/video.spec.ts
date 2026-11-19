import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createVideoProject } from './helpers';
import { mediaFixtures, type MediaFixture } from './media-fixtures';

const fixtures = mediaFixtures();
test.skip(fixtures === null, 'ffmpeg is not installed, so the test videos cannot be made');
const media = fixtures as NonNullable<typeof fixtures>;

test.setTimeout(90_000);

async function importMedia(page: Page, files: MediaFixture[]): Promise<void> {
  await page.getByTestId('import-media-input').setInputFiles(files);
  const list = page.getByRole('list', { name: 'Project media' });
  for (const file of files)
    await expect(list.getByText(file.name, { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function addToTimeline(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Add to timeline: ${name}` }).click();
}

/** The colour in the middle of the preview, read from a screenshot of the canvas. */
const isRed = ([r, g, b]: [number, number, number]) => r > 200 && g < 60 && b < 60;
const isBlue = ([r, g, b]: [number, number, number]) => b > 200 && r < 60 && g < 60;

async function previewColour(page: Page): Promise<[number, number, number]> {
  const png = await page.getByTestId('preview-canvas').screenshot();
  // Only the middle pixel crosses back from the page (sending a whole screenshot as numbers is slow).
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const [r = 0, g = 0, b = 0] = context.getImageData(
      bitmap.width >> 1,
      bitmap.height >> 1,
      1,
      1,
    ).data;
    return [r, g, b] as [number, number, number];
  }, png.toString('base64'));
}

const clip = (page: Page, name: string, track: string) =>
  page.getByRole('group', { name: track }).getByRole('button', { name: new RegExp(`^${name}`) });

test.describe('video import and timeline', () => {
  test('imports a video, shows its facts, and puts it on the timeline with its sound', async ({
    page,
  }) => {
    await createVideoProject(page, 'Import test');
    await importMedia(page, [media.red]);
    const library = page.getByRole('list', { name: 'Project media' });
    await expect(library.getByText(/320 × 240/)).toBeVisible();
    await addToTimeline(page, 'red.mp4');
    await expect(clip(page, 'red.mp4', 'Video 1')).toBeVisible();
    await expect(clip(page, 'red.mp4', 'Audio 1')).toBeVisible();
    // The first video sets the sequence picture size.
    await expect(page.getByRole('spinbutton', { name: /^Width/ })).toHaveValue('320');
    await expect(page.getByRole('spinbutton', { name: /^Height/ })).toHaveValue('240');
  });

  test('shows the picture at the playhead', async ({ page }) => {
    await createVideoProject(page, 'Preview test');
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4');
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);
    await addToTimeline(page, 'blue.mp4'); // goes after the red clip (2 s)
    await page.getByRole('button', { name: 'Go to end' }).click();
    await page.getByRole('button', { name: 'Back one frame' }).click();
    await expect
      .poll(async () => isBlue(await previewColour(page)), { timeout: 20_000 })
      .toBe(true);
    await page.getByRole('button', { name: 'Go to start' }).click();
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);
  });

  test('plays, advances the clock and stops at the end', async ({ page }) => {
    await createVideoProject(page, 'Playback test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect
      .poll(async () => page.getByTestId('clock').textContent(), { timeout: 10_000 })
      .not.toBe('00:00:00:00');
    // The 2 second clip ends by itself.
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('clock')).toHaveText('00:00:02:00');
  });

  test('reports unsupported files clearly and still imports the good ones', async ({ page }) => {
    await createVideoProject(page, 'Errors test');
    await page.getByTestId('import-media-input').setInputFiles([media.broken, media.tone]);
    const list = page.getByRole('list', { name: 'Project media' });
    await expect(list.getByText('tone.wav', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('list', { name: 'Import problems' })).toContainText('broken.mp4');
  });
});

test.describe('editing on the timeline', () => {
  test('split, delete, undo and redo', async ({ page }) => {
    await createVideoProject(page, 'Edit test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(1);
    // Put the playhead at 1 s and split.
    await page.getByRole('button', { name: 'Forward one frame' }).click({ clickCount: 1 });
    for (let i = 0; i < 24; i += 1)
      await page.getByRole('button', { name: 'Forward one frame' }).click();
    await expect(page.getByTestId('clock')).toHaveText('00:00:01:00');
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(2);
    await expect(clip(page, 'red.mp4', 'Audio 1')).toHaveCount(2);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(1);
    await page.getByRole('button', { name: /^Redo/ }).click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(2);

    // Delete the second half (and its linked sound); the first half stays.
    await clip(page, 'red.mp4', 'Video 1').nth(1).click();
    await page.getByRole('button', { name: 'Delete clip' }).click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(1);
    await expect(clip(page, 'red.mp4', 'Audio 1')).toHaveCount(1);
  });

  test('numeric trim changes the clip length and keeps the sound linked', async ({ page }) => {
    await createVideoProject(page, 'Trim test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await clip(page, 'red.mp4', 'Video 1').click();
    const length = page.getByRole('textbox', { name: 'Length' });
    await expect(length).toHaveValue('00:00:02:00');
    await length.fill('00:00:01:00');
    await length.press('Enter');
    await expect(length).toHaveValue('00:00:01:00');
    await expect(clip(page, 'red.mp4', 'Audio 1')).toHaveAccessibleName(/length 00:00:01:00/);
    // Longer than the file is refused with a message.
    await length.fill('00:00:05:00');
    await length.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: /cannot be trimmed/ })).toBeVisible();
  });

  test('dragging a clip moves it and refuses to overlap', async ({ page }) => {
    await createVideoProject(page, 'Drag test');
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4');
    await addToTimeline(page, 'blue.mp4');
    const blue = clip(page, 'blue.mp4', 'Video 1');
    await blue.scrollIntoViewIfNeeded();
    const before = await blue.boundingBox();
    if (!before) throw new Error('no box');
    // Drag the blue clip to the right by 100 px (about 1.7 s at 60 px per second).
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 100, before.y + before.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
    const after = await blue.boundingBox();
    expect(after?.x ?? 0).toBeGreaterThan(before.x + 50);
    // Undo puts it back.
    await page.getByRole('button', { name: /^Undo/ }).click();
    const back = await blue.boundingBox();
    expect(Math.abs((back?.x ?? 0) - before.x)).toBeLessThan(2);
    // Dragging it left over the red clip stops at the red clip's end.
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x - 200, before.y + before.height / 2, { steps: 5 });
    await page.mouse.up();
    const clamped = await blue.boundingBox();
    expect(Math.abs((clamped?.x ?? 0) - before.x)).toBeLessThan(3);
  });

  test('a project with video clips survives a reload', async ({ page }) => {
    await createVideoProject(page, 'Persist test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await expect(clip(page, 'red.mp4', 'Video 1')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload(); // no checkpoint was written: the same as a crash
    await page
      .getByRole('alertdialog', { name: 'Restore unsaved changes?' })
      .getByRole('button', { name: 'Restore changes' })
      .click();
    await expect(clip(page, 'red.mp4', 'Video 1')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);
  });
});

test.describe('sound and keyboard', () => {
  test('schedules the sound of a clip against the audio clock while playing', async ({ page }) => {
    // Record every sound buffer the app schedules: when it starts on the audio clock, and how long it is.
    await page.addInitScript(() => {
      const log: { when: number; offset: number; duration: number; now: number }[] = [];
      (window as unknown as { __sound: typeof log }).__sound = log;
      // The original is called back with the right `this` below, so taking it unbound is intended.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const original = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when?: number, offset?: number) {
        log.push({
          when: when ?? 0,
          offset: offset ?? 0,
          duration: this.buffer?.duration ?? 0,
          now: this.context.currentTime,
        });
        return original.call(this, when, offset);
      };
    });
    await createVideoProject(page, 'Sound test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const log = await page.evaluate(
      () =>
        (
          window as unknown as {
            __sound: { when: number; offset: number; duration: number; now: number }[];
          }
        ).__sound,
    );
    expect(log.length).toBeGreaterThan(0);
    // All 2 seconds of sound were scheduled, none of it in the past, and the first buffer starts right away.
    const total = log.reduce((sum, entry) => sum + entry.duration - entry.offset, 0);
    expect(total).toBeGreaterThan(1.9);
    expect(total).toBeLessThan(2.3);
    expect(log[0]?.when ?? 99).toBeGreaterThanOrEqual((log[0]?.now ?? 0) - 0.001);
    expect((log[0]?.when ?? 99) - (log[0]?.now ?? 0)).toBeLessThan(0.5);
  });

  test('keyboard: space plays and pauses, arrows step frames, S splits, Delete removes', async ({
    page,
  }) => {
    await createVideoProject(page, 'Keys test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('clock')).toHaveText('00:00:00:00');
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('clock')).toHaveText('00:00:00:05');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('clock')).toHaveText('00:00:00:04');
    await page.keyboard.press('s');
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(2);
    await clip(page, 'red.mp4', 'Video 1').first().click();
    await page.keyboard.press('Delete');
    await expect(clip(page, 'red.mp4', 'Video 1')).toHaveCount(1);
    await page.keyboard.press('End');
    await expect(page.getByTestId('clock')).toHaveText('00:00:02:00');
  });
});

function ffprobeAvailable(): boolean {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Facts about an exported file, read by ffprobe (an independent tool, so the check does not trust our own code). */
function probe(path: string) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path],
    { encoding: 'utf8' },
  );
  const json = JSON.parse(out) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      nb_read_frames?: string;
      duration?: string;
    }[];
    format: { duration: string };
  };
  return {
    video: json.streams.find((stream) => stream.codec_type === 'video'),
    audio: json.streams.find((stream) => stream.codec_type === 'audio'),
    duration: Number(json.format.duration),
  };
}

/** Middle pixel of the frame at `seconds`, and the average loudness (dB) of a stretch of sound. */
function pixelAtSecond(path: string, seconds: number): [number, number, number] {
  const raw = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(seconds),
      '-i',
      path,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 10_000_000 },
  );
  const middle = (240 / 2) * 320 * 3 + (320 / 2) * 3;
  return [raw[middle] ?? 0, raw[middle + 1] ?? 0, raw[middle + 2] ?? 0];
}

function meanVolume(path: string, from: number, length: number): number {
  const result = spawnSync(
    'ffmpeg',
    [
      '-ss',
      String(from),
      '-t',
      String(length),
      '-i',
      path,
      '-af',
      'volumedetect',
      '-vn',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  const match = /mean_volume: (-?[\d.]+|-inf) dB/.exec(result.stderr);
  return match?.[1] === '-inf' ? -200 : Number(match?.[1] ?? NaN);
}

test.describe('export', () => {
  test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

  test('exports the timeline to an MP4 that is verified by ffprobe: size, frames, duration, picture and sound', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await createVideoProject(page, 'Export test');
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4'); // 0 s .. 2 s, with sound
    await addToTimeline(page, 'blue.mp4'); // 2 s .. 5 s, silent
    await expect(clip(page, 'blue.mp4', 'Video 1')).toBeVisible();

    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await expect(dialog).toContainText('320 × 240');
    await expect(dialog).toContainText('125'); // 5 s at 25 fps
    await dialog.getByRole('button', { name: 'Start export' }).click();
    const link = dialog.getByRole('link', { name: /^Download/ });
    await expect(link).toBeVisible({ timeout: 90_000 });

    const downloading = page.waitForEvent('download');
    await link.click();
    const file = testInfo.outputPath('exported.mp4');
    await (await downloading).saveAs(file);

    const facts = probe(file);
    expect(facts.video).toMatchObject({ codec_name: 'h264', width: 320, height: 240 });
    expect(Number(facts.video?.nb_read_frames)).toBe(125);
    expect(facts.audio?.codec_name).toBe('aac');
    expect(facts.duration).toBeGreaterThan(4.9);
    expect(facts.duration).toBeLessThan(5.2);
    // The picture is red for the first clip and blue for the second (limited-range colours, so a tolerance).
    const red = pixelAtSecond(file, 0.5);
    expect(red[0]).toBeGreaterThan(200);
    expect(red[2]).toBeLessThan(60);
    const blue = pixelAtSecond(file, 3.5);
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(60);
    // The tone is audible while the red clip plays and silent afterwards.
    expect(meanVolume(file, 0.2, 1.5)).toBeGreaterThan(-35);
    expect(meanVolume(file, 2.5, 2)).toBeLessThan(-60);
  });

  test('exporting an empty timeline is refused before anything starts', async ({ page }) => {
    await createVideoProject(page, 'Empty export');
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await expect(dialog).toContainText('There is nothing to export yet');
    await expect(dialog.getByRole('button', { name: 'Start export' })).toBeDisabled();
  });
});

test.describe('drag and drop from the library', () => {
  test('dropping a video on the timeline places it at the drop time on the lane under it', async ({
    page,
  }) => {
    await createVideoProject(page, 'Drop test');
    await importMedia(page, [media.blue]);
    const item = page.getByRole('list', { name: 'Project media' }).getByRole('listitem').first();
    const lane = page.getByRole('group', { name: 'Video 1' });
    await lane.scrollIntoViewIfNeeded();
    // 300 px from the left edge of the lane at 60 px per second is 5 seconds.
    await item.dragTo(lane, { targetPosition: { x: 300, y: 28 } });
    const placed = clip(page, 'blue.mp4', 'Video 1');
    await expect(placed).toBeVisible();
    await expect(placed).toHaveAccessibleName(/starts 00:00:05:00/);
  });

  test('dropping where there is no room says so and changes nothing', async ({ page }) => {
    await createVideoProject(page, 'Drop test 2');
    await importMedia(page, [media.blue]);
    await addToTimeline(page, 'blue.mp4'); // 0 s .. 3 s
    const item = page.getByRole('list', { name: 'Project media' }).getByRole('listitem').first();
    const lane = page.getByRole('group', { name: 'Video 1' });
    await lane.scrollIntoViewIfNeeded();
    await item.dragTo(lane, { targetPosition: { x: 60, y: 28 } }); // 1 s: inside the existing clip
    await expect(page.getByRole('status').filter({ hasText: /no room/i })).toBeVisible();
    await expect(clip(page, 'blue.mp4', 'Video 1')).toHaveCount(1);
  });
});

/** The pitch of the sound of an exported file between `from` and `from + length` seconds, by counting zero crossings. */
function toneFrequency(path: string, from: number, length: number): number {
  const raw = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(from),
      '-t',
      String(length),
      '-i',
      path,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-f',
      's16le',
      '-',
    ],
    { maxBuffer: 50_000_000 },
  );
  let crossings = 0;
  let previous = raw.readInt16LE(0);
  for (let i = 2; i + 1 < raw.length; i += 2) {
    const sample = raw.readInt16LE(i);
    if (previous < 0 !== sample < 0) crossings += 1;
    previous = sample;
  }
  return crossings / 2 / length;
}

test.describe('speed', () => {
  const speedField = (page: Page) => page.getByRole('spinbutton', { name: /^Speed/ });
  const length = (page: Page) => page.getByRole('textbox', { name: 'Length' });

  test('a clip plays faster and gets shorter, picture and sound together, and undo restores it', async ({
    page,
  }) => {
    await createVideoProject(page, 'Speed test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4'); // 2 s with sound
    await clip(page, 'red.mp4', 'Video 1').click();
    await expect(length(page)).toHaveValue('00:00:02:00');
    await speedField(page).fill('2');
    await expect(length(page)).toHaveValue('00:00:01:00');
    await expect(clip(page, 'red.mp4', 'Video 1').getByTestId('speed-badge')).toHaveText('2×');
    await expect(clip(page, 'red.mp4', 'Audio 1')).toHaveAccessibleName(/speed 2 times/);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(length(page)).toHaveValue('00:00:02:00');
    await expect(page.getByTestId('speed-badge')).toHaveCount(0);
  });

  test('a speed outside 0.25 to 4 is not applied', async ({ page }) => {
    await createVideoProject(page, 'Speed limits');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await clip(page, 'red.mp4', 'Video 1').click();
    await speedField(page).fill('9');
    await expect(length(page)).toHaveValue('00:00:02:00');
    await expect(page.getByTestId('speed-badge')).toHaveCount(0);
  });

  test.describe('in the exported file', () => {
    test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

    test('double speed halves the length and doubles the pitch of the sound', async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await createVideoProject(page, 'Speed export');
      await importMedia(page, [media.red]);
      await addToTimeline(page, 'red.mp4'); // 2 s of a 440 Hz tone
      await clip(page, 'red.mp4', 'Video 1').click();
      await speedField(page).fill('2');
      await expect(length(page)).toHaveValue('00:00:01:00');

      await page.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export video' });
      await dialog.getByRole('button', { name: 'Start export' }).click();
      const link = dialog.getByRole('link', { name: /^Download/ });
      await expect(link).toBeVisible({ timeout: 90_000 });
      const downloading = page.waitForEvent('download');
      await link.click();
      const file = testInfo.outputPath('fast.mp4');
      await (await downloading).saveAs(file);

      const facts = probe(file);
      expect(Number(facts.video?.nb_read_frames)).toBe(25);
      expect(facts.duration).toBeGreaterThan(0.95);
      expect(facts.duration).toBeLessThan(1.2);
      expect(pixelAtSecond(file, 0.5)[0]).toBeGreaterThan(200);
      // 440 Hz played twice as fast is 880 Hz.
      const pitch = toneFrequency(file, 0.1, 0.8);
      expect(pitch).toBeGreaterThan(840);
      expect(pitch).toBeLessThan(920);
    });
  });
});

test.describe('transitions', () => {
  /** red (0 to 2 s, 25 fps) then blue (2 to 5 s), with a 1 s dip to black into blue. */
  async function dipProject(page: Page, name: string): Promise<void> {
    await createVideoProject(page, name);
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4');
    await addToTimeline(page, 'blue.mp4');
    await clip(page, 'blue.mp4', 'Video 1').click();
    await page.getByLabel('Transition in', { exact: true }).selectOption('dip-black');
    await page.getByRole('spinbutton', { name: /^Duration/ }).fill('1');
    await expect(page.getByRole('spinbutton', { name: /^Duration/ })).toHaveValue('1');
  }

  test('a dip to black goes dark between the two clips and undo takes it away', async ({
    page,
  }) => {
    await dipProject(page, 'Dip preview');
    await expect(clip(page, 'blue.mp4', 'Video 1')).toHaveAccessibleName(/dip-black transition in/);
    await expect(page.getByTestId('transition-marker')).toBeVisible();

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Home');
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);
    // Frame 62 at 25 fps is 2.48 s: just before the middle of the dip, so the red is nearly black.
    for (let i = 0; i < 62; i += 1) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('clock')).toHaveText('00:00:02:12');
    await expect
      .poll(async () => (await previewColour(page)).every((value) => value < 60), {
        timeout: 20_000,
      })
      .toBe(true);
    // After the dip the blue is back.
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(async () => isBlue(await previewColour(page)), { timeout: 20_000 })
      .toBe(true);

    await clip(page, 'blue.mp4', 'Video 1').click();
    await page.getByLabel('Transition in', { exact: true }).selectOption('');
    await expect(page.getByTestId('transition-marker')).toHaveCount(0);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByTestId('transition-marker')).toBeVisible();
  });

  test('the first clip on a track has no clip to come from, and says so', async ({ page }) => {
    await createVideoProject(page, 'Transition first');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await clip(page, 'red.mp4', 'Video 1').click();
    await expect(page.getByLabel('Transition in', { exact: true })).toBeDisabled();
    await expect(page.getByText(/place this clip directly after another clip/i)).toBeVisible();
  });

  test.describe('in the exported file', () => {
    test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

    test('the exported picture dips to black between the clips and returns to blue', async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await dipProject(page, 'Dip export');
      await page.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export video' });
      await dialog.getByRole('button', { name: 'Start export' }).click();
      const link = dialog.getByRole('link', { name: /^Download/ });
      await expect(link).toBeVisible({ timeout: 90_000 });
      const downloading = page.waitForEvent('download');
      await link.click();
      const file = testInfo.outputPath('dip.mp4');
      await (await downloading).saveAs(file);

      expect(pixelAtSecond(file, 1.5)[0]).toBeGreaterThan(200); // red before the dip
      const dark = pixelAtSecond(file, 2.5); // the middle of the dip
      expect(Math.max(...dark)).toBeLessThan(60);
      expect(pixelAtSecond(file, 4)[2]).toBeGreaterThan(200); // blue after it
    });
  });
});

/** How many pixels of the preview are (nearly) white: the text of titles and subtitles in these tests. */
async function whitePixels(page: Page): Promise<number> {
  const png = await page.getByTestId('preview-canvas').screenshot();
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 200 && (data[i + 1] ?? 0) > 200 && (data[i + 2] ?? 0) > 200) count += 1;
    }
    return count;
  }, png.toString('base64'));
}

const SUBTITLES = [
  '1',
  '00:00:00,200 --> 00:00:01,000',
  'Hello <i>there</i>',
  '',
  '2',
  '00:00:01,400 --> 00:00:01,900',
  'Second line',
  '',
].join('\n');
const subtitleFile = (text: string) => ({
  name: 'captions.srt',
  mimeType: 'application/x-subrip',
  buffer: Buffer.from(text),
});

async function stepFrames(page: Page, frames: number): Promise<void> {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Home');
  for (let i = 0; i < frames; i += 1) await page.keyboard.press('ArrowRight');
}

test.describe('text and subtitles', () => {
  test('adds a title over the picture, edits its words, and deleting it takes it away', async ({
    page,
  }) => {
    await createVideoProject(page, 'Title test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);
    expect(await whitePixels(page)).toBeLessThan(20);

    await page.getByRole('button', { name: 'Add text' }).click();
    await expect(clip(page, 'Text: Your text', 'Video 2')).toBeVisible();
    await expect.poll(() => whitePixels(page), { timeout: 20_000 }).toBeGreaterThan(50);

    await page.getByRole('textbox', { name: 'Words' }).fill('Hi');
    await expect(clip(page, 'Text: Hi', 'Video 2')).toBeVisible();
    await expect.poll(() => whitePixels(page), { timeout: 20_000 }).toBeGreaterThan(20);

    await page.getByRole('button', { name: 'Delete clip', exact: true }).click();
    await expect(clip(page, 'Text: Hi', 'Video 2')).toHaveCount(0);
    await expect.poll(() => whitePixels(page), { timeout: 20_000 }).toBeLessThan(20);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(() => whitePixels(page), { timeout: 20_000 }).toBeGreaterThan(20);
  });

  test('imports subtitles as a track, shows them at their times, and undo removes them', async ({
    page,
  }) => {
    await createVideoProject(page, 'Subtitle test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await page.getByTestId('import-subtitles-input').setInputFiles(subtitleFile(SUBTITLES));
    const track = page.getByRole('group', { name: 'Subtitles' });
    await expect(track.getByRole('button', { name: /^Text: Hello there/ })).toBeVisible();
    await expect(track.getByRole('button', { name: /^Text: Second line/ })).toBeVisible();

    await stepFrames(page, 15); // 0.6 s: the first subtitle
    await expect.poll(() => whitePixels(page), { timeout: 20_000 }).toBeGreaterThan(20);
    await stepFrames(page, 28); // 1.12 s: between the two
    await expect.poll(() => whitePixels(page), { timeout: 20_000 }).toBeLessThan(5);
    await stepFrames(page, 40); // 1.6 s: the second
    await expect.poll(() => whitePixels(page), { timeout: 20_000 }).toBeGreaterThan(20);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByRole('group', { name: 'Subtitles' })).toHaveCount(0);
  });

  test('a file with no subtitles in it is refused with a message', async ({ page }) => {
    await createVideoProject(page, 'Bad subtitles');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await page.getByTestId('import-subtitles-input').setInputFiles(subtitleFile('not subtitles'));
    await expect(page.getByText('No subtitles were found in that file.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Subtitles' })).toHaveCount(0);
  });

  test('a subtitle track survives a reload', async ({ page }) => {
    await createVideoProject(page, 'Subtitle reload');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await page.getByTestId('import-subtitles-input').setInputFiles(subtitleFile(SUBTITLES));
    await expect(page.getByRole('button', { name: /^Text: Second line/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload();
    await page
      .getByRole('alertdialog', { name: 'Restore unsaved changes?' })
      .getByRole('button', { name: 'Restore changes' })
      .click();
    await expect(page.getByRole('button', { name: /^Text: Second line/ })).toBeVisible();
  });

  test.describe('in the exported file', () => {
    test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

    test('subtitles are burned into the picture at their times', async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await createVideoProject(page, 'Subtitle export');
      await importMedia(page, [media.red]);
      await addToTimeline(page, 'red.mp4');
      await page.getByTestId('import-subtitles-input').setInputFiles(subtitleFile(SUBTITLES));
      await expect(page.getByRole('button', { name: /^Text: Second line/ })).toBeVisible();

      await page.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export video' });
      await dialog.getByRole('button', { name: 'Start export' }).click();
      const link = dialog.getByRole('link', { name: /^Download/ });
      await expect(link).toBeVisible({ timeout: 90_000 });
      const downloading = page.waitForEvent('download');
      await link.click();
      const file = testInfo.outputPath('subtitled.mp4');
      await (await downloading).saveAs(file);

      expect(whitePixelsAt(file, 0.6)).toBeGreaterThan(20); // while the first one shows
      expect(whitePixelsAt(file, 1.12)).toBeLessThan(5); // between the two
      expect(whitePixelsAt(file, 1.6)).toBeGreaterThan(20); // while the second one shows
    });
  });
});

/** How many pixels of the frame at `seconds` of an exported file are (nearly) white (the file is 320 by 240). */
function whitePixelsAt(path: string, seconds: number): number {
  const raw = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(seconds),
      '-i',
      path,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 10_000_000 },
  );
  let count = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) {
    if ((raw[i] ?? 0) > 200 && (raw[i + 1] ?? 0) > 200 && (raw[i + 2] ?? 0) > 200) count += 1;
  }
  return count;
}

test.describe('clip look (picture and sound properties)', () => {
  test('cropping and opacity change the preview, and undo restores it', async ({ page }) => {
    await createVideoProject(page, 'Look test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 20_000 }).toBe(true);

    await clip(page, 'red.mp4', 'Video 1').click();
    // Cropping away the left 60% takes the middle of the picture out of view: black shows through.
    await page.getByRole('spinbutton', { name: /^Crop left/ }).fill('60');
    await expect
      .poll(async () => (await previewColour(page)).every((value) => value < 30), {
        timeout: 10_000,
      })
      .toBe(true);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 10_000 }).toBe(true);

    // Half opacity over black halves the red.
    await page.getByRole('slider', { name: 'Opacity' }).fill('50');
    await expect
      .poll(
        async () => {
          const [r, g, b] = await previewColour(page);
          return r > 90 && r < 170 && g < 40 && b < 40;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Reset position, opacity and colour' }).click();
    await expect.poll(async () => isRed(await previewColour(page)), { timeout: 10_000 }).toBe(true);
  });

  test('the look survives a reload', async ({ page }) => {
    await createVideoProject(page, 'Look reload');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await clip(page, 'red.mp4', 'Video 1').click();
    await page.getByRole('spinbutton', { name: /^Rotation/ }).fill('15');
    await expect(page.getByRole('spinbutton', { name: /^Rotation/ })).toHaveValue('15');
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload(); // no checkpoint was written: the same as a crash
    await page
      .getByRole('alertdialog', { name: 'Restore unsaved changes?' })
      .getByRole('button', { name: 'Restore changes' })
      .click();
    await clip(page, 'red.mp4', 'Video 1').click();
    await expect(page.getByRole('spinbutton', { name: /^Rotation/ })).toHaveValue('15');
  });

  test('solo on a track is shown as pressed and can be undone', async ({ page }) => {
    await createVideoProject(page, 'Solo test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    const solo = page.getByRole('button', { name: 'Solo Audio 1' });
    await expect(solo).toHaveAttribute('aria-pressed', 'false');
    await solo.click();
    await expect(solo).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(solo).toHaveAttribute('aria-pressed', 'false');
  });

  test.describe('in the exported file', () => {
    test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

    test('a clip volume of 0 makes the exported sound silent', async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await createVideoProject(page, 'Look export');
      await importMedia(page, [media.red]);
      await addToTimeline(page, 'red.mp4'); // 2 s with a tone
      await clip(page, 'red.mp4', 'Audio 1').click();
      await page.getByRole('slider', { name: 'Volume', exact: true }).fill('0');

      await page.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export video' });
      await dialog.getByRole('button', { name: 'Start export' }).click();
      const link = dialog.getByRole('link', { name: /^Download/ });
      await expect(link).toBeVisible({ timeout: 90_000 });
      const downloading = page.waitForEvent('download');
      await link.click();
      const file = testInfo.outputPath('silent.mp4');
      await (await downloading).saveAs(file);

      expect(meanVolume(file, 0.2, 1.5)).toBeLessThan(-60);
    });
  });
});

test.describe('markers and in/out points', () => {
  async function focusPage(page: Page): Promise<void> {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
  }
  async function stepTo(page: Page, frames: number): Promise<void> {
    await focusPage(page);
    await page.keyboard.press('Home');
    for (let i = 0; i < frames; i += 1) await page.keyboard.press('ArrowRight');
  }
  const clock = (page: Page) => page.getByTestId('clock');

  test('adds, names, finds and removes a marker, with undo', async ({ page }) => {
    await createVideoProject(page, 'Marker test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await stepTo(page, 25); // 1 s at 25 fps
    await expect(clock(page)).toHaveText('00:00:01:00');
    await page.keyboard.press('m');
    const marker = page.getByRole('button', { name: 'Marker without a name, at 00:00:01:00' });
    await expect(marker).toBeVisible();

    await page.getByRole('textbox', { name: 'Marker name' }).fill('Intro');
    await expect(page.getByRole('button', { name: 'Marker Intro, at 00:00:01:00' })).toBeVisible();

    // Ctrl+Left and Ctrl+Right jump between markers.
    await focusPage(page);
    await page.keyboard.press('Home');
    await page.keyboard.press('Control+ArrowRight');
    await expect(clock(page)).toHaveText('00:00:01:00');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+ArrowLeft');
    await expect(clock(page)).toHaveText('00:00:01:00');

    // Two markers cannot share a time.
    await page.getByRole('button', { name: 'Add marker' }).click();
    await expect(page.getByText('There is already a marker there.')).toBeVisible();

    await page.getByRole('button', { name: 'Remove marker' }).click();
    await expect(page.locator('[data-marker-id]')).toHaveCount(0);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.locator('[data-marker-id]')).toHaveCount(1);
  });

  test('sets and clears the in and out points', async ({ page }) => {
    await createVideoProject(page, 'In out test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await expect(page.getByTestId('range-band')).toHaveCount(0);
    await stepTo(page, 10);
    await page.keyboard.press('i');
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('o');
    await expect(page.getByTestId('range-band')).toBeVisible();
    await expect(page.getByTestId('range-readout')).toHaveText('In 00:00:00:10 · Out 00:00:01:10');

    await page.keyboard.press('Alt+x');
    await expect(page.getByTestId('range-band')).toHaveCount(0);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByTestId('range-readout')).toBeVisible();
  });

  test('markers and the range survive a reload', async ({ page }) => {
    await createVideoProject(page, 'Marker reload');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await stepTo(page, 5);
    await page.keyboard.press('m');
    await page.keyboard.press('i');
    await expect(page.getByTestId('range-readout')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload();
    await page
      .getByRole('alertdialog', { name: 'Restore unsaved changes?' })
      .getByRole('button', { name: 'Restore changes' })
      .click();
    await expect(page.locator('[data-marker-id]')).toHaveCount(1);
    await expect(page.getByTestId('range-readout')).toHaveText('In 00:00:00:05 · Out end');
  });

  test.describe('in the exported file', () => {
    test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

    test('export can be limited to the part between the in and out points', async ({
      page,
    }, testInfo) => {
      test.setTimeout(150_000);
      await createVideoProject(page, 'Range export');
      await importMedia(page, [media.red, media.blue]);
      await addToTimeline(page, 'red.mp4'); // 0 s .. 2 s
      await addToTimeline(page, 'blue.mp4'); // 2 s .. 5 s
      await stepTo(page, 50); // 2 s
      await page.keyboard.press('i');
      for (let i = 0; i < 50; i += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('o'); // 4 s

      await page.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export video' });
      const limit = dialog.getByRole('checkbox', { name: /^Only the part between the in and out/ });
      await expect(limit).toBeChecked();
      await expect(dialog).toContainText('50'); // 2 s at 25 fps
      await dialog.getByRole('button', { name: 'Start export' }).click();
      const link = dialog.getByRole('link', { name: /^Download/ });
      await expect(link).toBeVisible({ timeout: 90_000 });
      const downloading = page.waitForEvent('download');
      await link.click();
      const file = testInfo.outputPath('range.mp4');
      await (await downloading).saveAs(file);

      const facts = probe(file);
      expect(Number(facts.video?.nb_read_frames)).toBe(50);
      expect(facts.duration).toBeGreaterThan(1.9);
      expect(facts.duration).toBeLessThan(2.2);
      // Blue from the start: the red part was left out.
      const first = pixelAtSecond(file, 0.2);
      expect(first[2]).toBeGreaterThan(200);
      expect(first[0]).toBeLessThan(60);
    });
  });
});

test.describe('J, K and L shuttle and the master meter', () => {
  const clock = (page: Page) => page.getByTestId('clock');
  async function focusPage(page: Page): Promise<void> {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
  }

  test('L plays and goes faster, K stops, J runs backwards', async ({ page }) => {
    await createVideoProject(page, 'Shuttle test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4'); // 2 s
    await focusPage(page);
    await page.keyboard.press('Home');

    await page.keyboard.press('l');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(page.getByTestId('shuttle-rate')).toHaveCount(0); // normal speed
    await page.keyboard.press('l');
    await expect(page.getByTestId('shuttle-rate')).toHaveText('Shuttle 2×');
    await page.keyboard.press('k');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    await page.keyboard.press('End');
    await expect(clock(page)).toHaveText('00:00:02:00');
    await page.keyboard.press('j');
    await expect(page.getByTestId('shuttle-rate')).toHaveText('Shuttle −1×');
    await expect
      .poll(async () => clock(page).textContent(), { timeout: 10_000 })
      .not.toBe('00:00:02:00');
    await page.keyboard.press('k');
    const stopped = await clock(page).textContent();
    await page.waitForTimeout(400);
    await expect(clock(page)).toHaveText(stopped ?? '');
  });

  test('forwards at 4x reaches the end in a quarter of the time and stops there', async ({
    page,
  }) => {
    await createVideoProject(page, 'Fast forward');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await focusPage(page);
    await page.keyboard.press('Home');
    await page.keyboard.press('l');
    await page.keyboard.press('l');
    await page.keyboard.press('l'); // 4x
    await expect(clock(page)).toHaveText('00:00:02:00', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  });

  test('the master meter shows the level while playing, and the lamp stays on after clipping', async ({
    page,
  }) => {
    await createVideoProject(page, 'Meter test');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4'); // 2 s of a 440 Hz tone
    const left = page.getByTestId('meter-left');
    await expect(left).toHaveAttribute('aria-valuetext', 'silent');
    await expect(page.getByTestId('clip-lamp')).toBeDisabled();

    // Make it much too loud: clip and track volume at 400%.
    await clip(page, 'red.mp4', 'Audio 1').click();
    await page.getByRole('slider', { name: 'Volume', exact: true }).fill('400');
    await page.getByRole('slider', { name: 'Track volume' }).fill('400');

    await focusPage(page);
    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    await expect
      .poll(async () => Number(await left.getAttribute('aria-valuenow')), { timeout: 10_000 })
      .toBeGreaterThan(-30);
    await expect(page.getByTestId('clip-lamp')).toBeEnabled({ timeout: 10_000 });
    // It stays lit after playback has ended, until it is pressed.
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('clip-lamp')).toBeEnabled();
    await page.getByTestId('clip-lamp').click();
    await expect(page.getByTestId('clip-lamp')).toBeDisabled();
    await expect(left).toHaveAttribute('aria-valuetext', 'silent');
  });
});

test.describe('export settings', () => {
  test('presets and details change what the dialog says, and unavailable choices are explained', async ({
    page,
  }) => {
    await createVideoProject(page, 'Export settings');
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4'); // 2 s at 25 fps
    await addToTimeline(page, 'blue.mp4'); // 3 s
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await expect(dialog.getByLabel('Preset')).toHaveValue('web');
    await expect(dialog).toContainText('125'); // 5 s at 25 fps
    await expect(dialog).toContainText('MP4 (H.264 and AAC)');

    // A smaller preset never enlarges the 320 x 240 sequence.
    await dialog.getByLabel('Preset').selectOption('small');
    await expect(dialog).toContainText('320 × 240');

    // Details: another frame rate changes the number of frames, and the preset becomes custom.
    await dialog.getByText('More settings').click();
    await dialog.getByLabel('Frame rate').selectOption('60');
    await expect(dialog).toContainText('300'); // 5 s at 60 fps
    await expect(dialog.getByLabel('Preset')).toHaveValue('custom');
    await dialog.getByLabel('Preset').selectOption('web');
    await expect(dialog).toContainText('125');

    await dialog.getByLabel('Format').selectOption('webm');
    await expect(dialog).toContainText('WebM (VP9 and Opus)');
    await expect(dialog.getByLabel('Preset')).toHaveValue('custom');
  });

  test.describe('in the exported file', () => {
    test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

    test('a WebM export is VP9 and Opus with the right picture, frames and length', async ({
      page,
    }, testInfo) => {
      test.setTimeout(150_000);
      await createVideoProject(page, 'WebM export');
      await importMedia(page, [media.red]);
      await addToTimeline(page, 'red.mp4'); // 2 s of red with a tone

      await page.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export video' });
      await dialog.getByLabel('Preset').selectOption('webm');
      await dialog.getByRole('button', { name: 'Start export' }).click();
      const link = dialog.getByRole('link', { name: /^Download .*\.webm$/ });
      await expect(link).toBeVisible({ timeout: 90_000 });
      const downloading = page.waitForEvent('download');
      await link.click();
      const file = testInfo.outputPath('export.webm');
      await (await downloading).saveAs(file);

      const facts = probe(file);
      expect(facts.video).toMatchObject({ codec_name: 'vp9', width: 320, height: 240 });
      expect(facts.audio?.codec_name).toBe('opus');
      expect(Number(facts.video?.nb_read_frames)).toBe(50);
      expect(facts.duration).toBeGreaterThan(1.9);
      expect(facts.duration).toBeLessThan(2.3);
      expect(pixelAtSecond(file, 0.5)[0]).toBeGreaterThan(200);
      expect(meanVolume(file, 0.2, 1.5)).toBeGreaterThan(-35);
    });

    test('a 60 fps export of a 25 fps sequence has twice and a half the frames', async ({
      page,
    }, testInfo) => {
      test.setTimeout(150_000);
      await createVideoProject(page, 'Frame rate export');
      await importMedia(page, [media.red]);
      await addToTimeline(page, 'red.mp4'); // 2 s
      await page.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export video' });
      await dialog.getByText('More settings').click();
      await dialog.getByLabel('Frame rate').selectOption('60');
      await dialog.getByRole('button', { name: 'Start export' }).click();
      const link = dialog.getByRole('link', { name: /^Download/ });
      await expect(link).toBeVisible({ timeout: 90_000 });
      const downloading = page.waitForEvent('download');
      await link.click();
      const file = testInfo.outputPath('sixty.mp4');
      await (await downloading).saveAs(file);
      expect(Number(probe(file).video?.nb_read_frames)).toBe(120);
    });
  });
});

test.describe('saving straight to a file on disk', () => {
  test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

  /** The "save as" window cannot be driven, so stand in for it with a file in the browser's private storage. */
  async function fakeSavePicker(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const target = window as unknown as {
        showSaveFilePicker: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
      };
      target.showSaveFilePicker = async (options) => {
        const root = await navigator.storage.getDirectory();
        return root.getFileHandle(`picked-${options.suggestedName}`, { create: true });
      };
    });
  }

  async function readPicked(page: Page, name: string): Promise<Buffer> {
    const bytes = await page.evaluate(async (fileName) => {
      const root = await navigator.storage.getDirectory();
      const file = await (await root.getFileHandle(fileName)).getFile();
      return Array.from(new Uint8Array(await file.arrayBuffer()));
    }, name);
    return Buffer.from(bytes);
  }

  test('an MP4 written to the chosen file is complete and passes the check', async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await fakeSavePicker(page);
    await createVideoProject(page, 'Disk export');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4'); // 2 s with a tone

    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await dialog.getByRole('checkbox', { name: /^Save straight to a file on disk/ }).check();
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await expect(dialog.getByRole('status')).toContainText('Saved as picked-Disk export.mp4', {
      timeout: 90_000,
    });
    // No download link: the file was written where the user chose.
    await expect(dialog.getByRole('link', { name: /^Download/ })).toHaveCount(0);

    const file = testInfo.outputPath('disk.mp4');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, await readPicked(page, 'picked-Disk export.mp4'));
    const facts = probe(file);
    expect(facts.video).toMatchObject({ codec_name: 'h264', width: 320, height: 240 });
    expect(Number(facts.video?.nb_read_frames)).toBe(50);
    expect(facts.audio?.codec_name).toBe('aac');
    expect(pixelAtSecond(file, 0.5)[0]).toBeGreaterThan(200);
    expect(meanVolume(file, 0.2, 1.5)).toBeGreaterThan(-35);
  });

  test('choosing no file leaves the dialog as it was', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { showSaveFilePicker: () => Promise<never> }).showSaveFilePicker = () =>
        Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    });
    await createVideoProject(page, 'Disk cancel');
    await importMedia(page, [media.red]);
    await addToTimeline(page, 'red.mp4');
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await dialog.getByRole('checkbox', { name: /^Save straight to a file on disk/ }).check();
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await expect(dialog.getByRole('button', { name: 'Start export' })).toBeVisible();
    await expect(dialog.getByRole('alert').filter({ hasText: /./ })).toHaveCount(0);
  });
});

test.describe('exporting in parts', () => {
  test.skip(!ffprobeAvailable(), 'ffprobe is not installed, so exported files cannot be checked');

  /** One second per part, so a few seconds of video make several parts. */
  async function shortParts(page: Page): Promise<void> {
    await page.addInitScript(() => {
      localStorage.setItem('ms-export-part-seconds', '1');
    });
  }

  async function leftovers(page: Page): Promise<number> {
    return page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      try {
        const exports = await root.getDirectoryHandle('media-studio-export');
        let count = 0;
        for await (const entry of exports.values()) count += entry.kind === 'directory' ? 1 : 0;
        return count;
      } catch {
        return 0;
      }
    });
  }

  test('a five second export in five parts joins into one correct file, and leaves nothing behind', async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await shortParts(page);
    await createVideoProject(page, 'Parts export');
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4'); // 0 s .. 2 s, with a tone
    await addToTimeline(page, 'blue.mp4'); // 2 s .. 5 s, silent

    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await dialog.getByRole('checkbox', { name: /^Make it in parts/ }).check();
    await dialog.getByRole('button', { name: 'Start export' }).click();
    const link = dialog.getByRole('link', { name: /^Download/ });
    await expect(link).toBeVisible({ timeout: 120_000 });
    const downloading = page.waitForEvent('download');
    await link.click();
    const file = testInfo.outputPath('parts.mp4');
    await (await downloading).saveAs(file);

    const facts = probe(file);
    expect(facts.video).toMatchObject({ codec_name: 'h264', width: 320, height: 240 });
    expect(Number(facts.video?.nb_read_frames)).toBe(125);
    expect(facts.audio?.codec_name).toBe('aac');
    expect(facts.duration).toBeGreaterThan(4.9);
    expect(facts.duration).toBeLessThan(5.3);
    // Red, then blue, with the seams between parts (every second) invisible in the colours.
    expect(pixelAtSecond(file, 0.5)[0]).toBeGreaterThan(200);
    expect(pixelAtSecond(file, 1.5)[0]).toBeGreaterThan(200);
    expect(pixelAtSecond(file, 2.5)[2]).toBeGreaterThan(200);
    expect(pixelAtSecond(file, 4.5)[2]).toBeGreaterThan(200);
    // The tone plays through the first part boundary without a gap, and the rest is silent.
    expect(meanVolume(file, 0.2, 1.5)).toBeGreaterThan(-35);
    expect(meanVolume(file, 2.5, 2)).toBeLessThan(-60);
    expect(await leftovers(page)).toBe(0);
  });

  test('cancelling an export in parts removes its parts', async ({ page }) => {
    test.setTimeout(150_000);
    await shortParts(page);
    await createVideoProject(page, 'Parts cancel');
    await importMedia(page, [media.red, media.blue]);
    await addToTimeline(page, 'red.mp4');
    await addToTimeline(page, 'blue.mp4');
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await dialog.getByRole('checkbox', { name: /^Make it in parts/ }).check();
    await dialog.getByRole('button', { name: 'Start export' }).click();
    await expect(dialog.getByRole('button', { name: 'Cancel export' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel export' }).click();
    await expect(dialog.getByRole('button', { name: 'Start export' })).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => leftovers(page), { timeout: 10_000 }).toBe(0);
  });
});
