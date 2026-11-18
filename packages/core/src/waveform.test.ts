import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { PeakBuilder, decodePeaks, encodePeaks, peaksForRange } from './waveform';

describe('peak builder', () => {
  it('takes the loudest sample of every slice, whatever the chunk size', () => {
    const rate = 1000; // 100 slices per second -> 10 samples per slice
    const samples = new Float32Array(35);
    samples[3] = -0.5;
    samples[12] = 1;
    samples[34] = 0.25;
    const whole = new PeakBuilder(rate);
    whole.add(samples);
    const pieces = new PeakBuilder(rate);
    for (let i = 0; i < samples.length; i += 7) pieces.add(samples.subarray(i, i + 7));
    const a = whole.finish().data;
    expect([...a]).toEqual([128, 255, 0, 64]);
    expect(pieces.finish().data).toEqual(a);
  });

  it('handles rates that do not divide evenly without drifting', () => {
    const builder = new PeakBuilder(44_100);
    const seconds = 3;
    builder.add(new Float32Array(44_100 * seconds).fill(1));
    const { data } = builder.finish();
    expect(Math.abs(data.length - 100 * seconds)).toBeLessThanOrEqual(1);
    expect(data.every((value) => value === 255)).toBe(true);
  });
});

describe('peak file', () => {
  it('round-trips and rejects damaged data', () => {
    const peaks = { perSecond: 100, data: Uint8Array.from([0, 5, 255, 17]) };
    expect(decodePeaks(encodePeaks(peaks))).toEqual(peaks);
    expect(() => decodePeaks(new Uint8Array([1, 2, 3]))).toThrow(AppError);
    const bad = encodePeaks(peaks);
    bad[0] = 0;
    expect(() => decodePeaks(bad)).toThrow(AppError);
  });
});

describe('range reduction', () => {
  const peaks = { perSecond: 10, data: Uint8Array.from({ length: 100 }, (_, i) => i) };

  it('keeps the loudest value in each bin', () => {
    expect([...peaksForRange(peaks, 0, 1, 2)]).toEqual([4, 9]);
    expect([...peaksForRange(peaks, 9, 10, 1)]).toEqual([99]);
  });

  it('stays inside the data and tolerates empty ranges', () => {
    expect(peaksForRange(peaks, 20, 30, 3)).toHaveLength(3);
    expect(peaksForRange(peaks, 5, 5, 3)).toEqual(new Uint8Array(3));
    expect(peaksForRange(peaks, 0, 1, 0)).toHaveLength(0);
  });
});
