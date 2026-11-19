import { FPS_30 } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_PRESETS,
  estimateExport,
  exportSize,
  matchingPreset,
  resolveSettings,
  type ExportChoices,
} from './export-settings';

const SEQUENCE = { width: 1920, height: 1080, fps: FPS_30, sampleRate: 44_100 };
const preset = (id: string): ExportChoices => {
  const found = EXPORT_PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return found.choices;
};

describe('export sizes', () => {
  it('scales to the long side, never enlarges, and keeps sizes even', () => {
    expect(exportSize({ width: 1920, height: 1080 }, 1280)).toEqual({ width: 1280, height: 720 });
    expect(exportSize({ width: 320, height: 240 }, 1920)).toEqual({ width: 320, height: 240 });
    expect(exportSize({ width: 1080, height: 1920 }, 1280)).toEqual({ width: 720, height: 1280 });
    expect(exportSize({ width: 1001, height: 563 }, null)).toEqual({ width: 1000, height: 562 });
  });
});

describe('turning choices into encoder settings', () => {
  it('web: keeps the size and rate, MP4, sound at the sequence rate', () => {
    expect(resolveSettings(SEQUENCE, preset('web'))).toMatchObject({
      format: 'mp4',
      width: 1920,
      height: 1080,
      fps: FPS_30,
      sampleRate: 44_100,
      audioBitrate: 192_000,
      hardware: 'no-preference',
    });
  });

  it('small is smaller in size and in bits; best is bigger in bits', () => {
    const web = resolveSettings(SEQUENCE, preset('web'));
    const small = resolveSettings(SEQUENCE, preset('small'));
    const best = resolveSettings(SEQUENCE, preset('best'));
    expect(small).toMatchObject({ width: 1280, height: 720 });
    expect(small.videoBitrate).toBeLessThan(web.videoBitrate);
    expect(best.videoBitrate).toBeGreaterThan(web.videoBitrate);
    expect(best.audioBitrate).toBe(256_000);
  });

  it('WebM uses fewer bits for the same picture and mixes sound at 48 kHz', () => {
    const mp4 = resolveSettings(SEQUENCE, preset('web'));
    const webm = resolveSettings(SEQUENCE, preset('webm'));
    expect(webm.format).toBe('webm');
    expect(webm.sampleRate).toBe(48_000);
    expect(webm.videoBitrate / mp4.videoBitrate).toBeCloseTo(0.7, 1);
    // A sequence that is already at 48 kHz stays there.
    expect(resolveSettings({ ...SEQUENCE, sampleRate: 48_000 }, preset('web')).sampleRate).toBe(
      48_000,
    );
  });

  it('a chosen frame rate replaces the sequence rate', () => {
    expect(resolveSettings(SEQUENCE, { ...preset('web'), fpsId: '60' }).fps).toEqual({
      num: 60,
      den: 1,
    });
    expect(resolveSettings(SEQUENCE, { ...preset('web'), fpsId: 'sequence' }).fps).toEqual(FPS_30);
  });

  it('keeps the bitrate between sensible limits', () => {
    const tiny = resolveSettings({ ...SEQUENCE, width: 64, height: 64 }, preset('small'));
    expect(tiny.videoBitrate).toBeGreaterThanOrEqual(500_000);
    const huge = resolveSettings(
      { ...SEQUENCE, width: 8192, height: 8192, fps: { num: 60, den: 1 } },
      preset('best'),
    );
    expect(huge.videoBitrate).toBeLessThanOrEqual(100_000_000);
  });
});

describe('presets', () => {
  it('each preset is itself, and a changed choice makes it custom', () => {
    for (const entry of EXPORT_PRESETS) expect(matchingPreset(entry.choices)?.id).toBe(entry.id);
    expect(matchingPreset({ ...preset('web'), quality: 'high' })).toBeNull();
    expect(new Set(EXPORT_PRESETS.map((entry) => entry.id)).size).toBe(EXPORT_PRESETS.length);
  });
});

describe('estimate', () => {
  it('counts frames at the export rate and sizes the file from the bitrates', () => {
    const settings = resolveSettings(SEQUENCE, preset('web'));
    const estimate = estimateExport(settings, 2_000_000, true);
    expect(estimate.frames).toBe(60);
    expect(estimate.bytes).toBe(Math.round(((settings.videoBitrate + 192_000) / 8) * 2));
    expect(estimateExport(settings, 2_000_000, false).bytes).toBeLessThan(estimate.bytes);
    expect(estimateExport(settings, 0, true)).toEqual({ frames: 0, bytes: 0 });
    // 60 fps export of a 25 fps sequence: twice as many frames as a 30 fps one.
    const sixty = resolveSettings(SEQUENCE, { ...preset('web'), fpsId: '60' });
    expect(estimateExport(sixty, 2_000_000, true).frames).toBe(120);
  });
});
