import { describe, expect, it } from 'vitest';
import {
  FPS_24,
  FPS_30,
  frameDuration,
  frameRateFromNumber,
  frameToTime,
  formatTimecode,
  parseTimecode,
  samplesToTime,
  secondsToTime,
  snapToFrame,
  timeToFrame,
  timeToSamples,
  type FrameRate,
} from './time';

const NTSC: FrameRate = { num: 30000, den: 1001 };
const RATES: FrameRate[] = [
  FPS_24,
  FPS_30,
  NTSC,
  { num: 24000, den: 1001 },
  { num: 60000, den: 1001 },
];

describe('frames and time', () => {
  it('maps a frame to its start time with rounding that does not drift', () => {
    expect(frameToTime(30, FPS_30)).toBe(1_000_000);
    expect(frameToTime(30000, NTSC)).toBe(1_001_000_000);
    expect(frameToTime(1, NTSC)).toBe(33_367);
  });

  it('timeToFrame inverts frameToTime for every frame (29.97, 23.976 and whole rates)', () => {
    for (const fps of RATES) {
      for (let frame = 0; frame < 5000; frame += 1) {
        expect(timeToFrame(frameToTime(frame, fps), fps)).toBe(frame);
      }
    }
  });

  it('is monotonic and a time just before a frame is still the previous frame', () => {
    for (const fps of RATES) {
      let previous = -1;
      for (let frame = 1; frame < 2000; frame += 1) {
        const start = frameToTime(frame, fps);
        expect(timeToFrame(start - 1, fps)).toBe(frame - 1);
        const found = timeToFrame(start + 5, fps);
        expect(found).toBeGreaterThanOrEqual(previous);
        previous = found;
      }
    }
  });

  it('keeps the error under one microsecond per frame boundary over an hour of 29.97 fps', () => {
    const frames = 107_892; // one hour
    const exact = (frames * 1_000_000 * 1001) / 30000;
    expect(Math.abs(frameToTime(frames, NTSC) - exact)).toBeLessThanOrEqual(0.5);
  });

  it('snaps to the nearest frame start', () => {
    expect(snapToFrame(16_000, FPS_30)).toBe(0);
    expect(snapToFrame(17_000, FPS_30)).toBe(33_333);
    expect(snapToFrame(-5, FPS_30)).toBe(0);
    expect(frameDuration(FPS_30)).toBeCloseTo(33_333.33, 1);
  });
});

describe('audio samples', () => {
  it('converts both ways within half a sample', () => {
    expect(timeToSamples(1_000_000, 48_000)).toBe(48_000);
    expect(samplesToTime(48_000, 48_000)).toBe(1_000_000);
    for (const samples of [1, 7, 1023, 47_999, 123_457]) {
      expect(timeToSamples(samplesToTime(samples, 44_100), 44_100)).toBe(samples);
    }
  });
});

describe('frame rates', () => {
  it('snaps measured rates to the usual fractions', () => {
    expect(frameRateFromNumber(29.97)).toEqual(NTSC);
    expect(frameRateFromNumber(29.970029970029973)).toEqual(NTSC);
    expect(frameRateFromNumber(23.976)).toEqual({ num: 24000, den: 1001 });
    expect(frameRateFromNumber(30)).toEqual(FPS_30);
    expect(frameRateFromNumber(15)).toEqual({ num: 15, den: 1 });
    expect(frameRateFromNumber(12.5)).toEqual({ num: 12500, den: 1000 });
    expect(frameRateFromNumber(Number.NaN)).toEqual(FPS_30);
  });
});

describe('timecode', () => {
  it('formats and parses HH:MM:SS:FF', () => {
    const time = frameToTime(30 * 3661 + 12, FPS_30);
    expect(formatTimecode(time, FPS_30)).toBe('01:01:01:12');
    expect(parseTimecode('01:01:01:12', FPS_30)).toBe(time);
    expect(parseTimecode('1:02', FPS_30)).toBe(frameToTime(32, FPS_30));
    expect(parseTimecode('2.5', FPS_30)).toBe(secondsToTime(2.5));
  });

  it('rejects things that are not times', () => {
    expect(parseTimecode('', FPS_30)).toBeNull();
    expect(parseTimecode('abc', FPS_30)).toBeNull();
    expect(parseTimecode('00:00:00:45', FPS_30)).toBeNull();
  });

  it('round-trips every frame of a minute', () => {
    for (let frame = 0; frame < 30 * 60; frame += 1) {
      const text = formatTimecode(frameToTime(frame, FPS_30), FPS_30);
      expect(parseTimecode(text, FPS_30)).toBe(frameToTime(frame, FPS_30));
    }
  });
});
