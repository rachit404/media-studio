import { FPS_30 } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_KBPS,
  EXPORT_PRESETS,
  describeSize,
  describeTime,
  estimateExportSeconds,
  exportSummary,
  testRange,
  nearestAudioKbps,
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
    expect(best.audioBitrate).toBe(192_000);
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

describe('sound bitrates', () => {
  it('every preset uses a bitrate its own format offers', () => {
    for (const entry of EXPORT_PRESETS) {
      expect(AUDIO_KBPS[entry.choices.format]).toContain(entry.choices.audioKbps);
    }
  });

  it('moves to the nearest offered bitrate when the format changes', () => {
    expect(nearestAudioKbps('mp4', 256)).toBe(192);
    expect(nearestAudioKbps('webm', 170)).toBe(192);
    expect(nearestAudioKbps('webm', 160)).toBe(128); // halfway: the lower one
    expect(nearestAudioKbps('mp4', 128)).toBe(128);
    expect(nearestAudioKbps('webm', 64)).toBe(64);
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

describe('the summary line', () => {
  const MINUTE = 60 * 1_000_000;

  it('says format, size, frame rate, file size and time, from the resolved settings', () => {
    const settings = resolveSettings(SEQUENCE, preset('web'));
    expect(exportSummary(settings, 3 * MINUTE, true)).toBe(
      'MP4, 1920 x 1080, 30 fps, about 140 MB, about 3 minutes',
    );
  });

  it('follows the choices: WebM, a smaller size and another frame rate', () => {
    const webm = resolveSettings(SEQUENCE, { ...preset('webm'), sizeId: '720', fpsId: '60' });
    expect(exportSummary(webm, MINUTE, true)).toMatch(
      /^WebM, 1280 x 720, 60 fps, about \d+ MB, about /,
    );
    const ntsc = resolveSettings({ ...SEQUENCE, fps: { num: 30000, den: 1001 } }, preset('web'));
    expect(exportSummary(ntsc, MINUTE, false)).toContain('29.97 fps');
  });

  it('has nothing to say when there is nothing to export', () => {
    expect(exportSummary(resolveSettings(SEQUENCE, preset('web')), 0, true)).toBeNull();
  });

  it('describes sizes the way people say them', () => {
    expect(describeSize(300_000)).toBe('under 1 MB');
    expect(describeSize(4.4 * 1024 * 1024)).toBe('about 4 MB');
    expect(describeSize(47 * 1024 * 1024)).toBe('about 45 MB');
    expect(describeSize(123 * 1024 * 1024)).toBe('about 120 MB');
    expect(describeSize(1.5 * 1024 * 1024 * 1024)).toBe('about 1.5 GB');
  });

  it('describes times the way people say them', () => {
    expect(describeTime(3)).toBe('a few seconds');
    expect(describeTime(42)).toBe('about 40 seconds');
    expect(describeTime(180)).toBe('about 3 minutes');
    expect(describeTime(90 * 60)).toBe('about 1.5 hours');
  });

  it('takes longer for bigger pictures, more frames and longer videos', () => {
    const hd = resolveSettings(SEQUENCE, preset('web'));
    const small = resolveSettings(SEQUENCE, preset('small'));
    expect(estimateExportSeconds(hd, 60 * 1_000_000)).toBeCloseTo(60, 0); // 1080p30 runs at real time
    expect(estimateExportSeconds(small, 60 * 1_000_000)).toBeLessThan(
      estimateExportSeconds(hd, 60 * 1_000_000),
    );
    expect(estimateExportSeconds(hd, 120 * 1_000_000)).toBeCloseTo(
      2 * estimateExportSeconds(hd, 60 * 1_000_000),
      0,
    );
  });
});

describe('the test export range', () => {
  const S = 1_000_000;

  it('is the first five seconds of the sequence', () => {
    expect(testRange(null, 90 * S)).toEqual({ start: 0, end: 5 * S });
  });

  it('is the whole sequence when that is shorter', () => {
    expect(testRange(null, 3 * S)).toEqual({ start: 0, end: 3 * S });
  });

  it('uses the in and out points when they are shorter, or their first five seconds when longer', () => {
    expect(testRange({ start: 10 * S, end: 12 * S }, 90 * S)).toEqual({
      start: 10 * S,
      end: 12 * S,
    });
    expect(testRange({ start: 10 * S, end: 60 * S }, 90 * S)).toEqual({
      start: 10 * S,
      end: 15 * S,
    });
  });

  it('never goes past the end of the sequence, and is null when there is nothing', () => {
    expect(testRange({ start: 8 * S, end: 20 * S }, 10 * S)).toEqual({ start: 8 * S, end: 10 * S });
    expect(testRange(null, 0)).toBeNull();
    expect(testRange({ start: 10 * S, end: 10 * S }, 20 * S)).toBeNull();
  });
});
