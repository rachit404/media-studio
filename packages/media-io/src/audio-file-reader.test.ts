import { describe, expect, it } from 'vitest';
import { resample, toStereo } from './audio-file-reader';

/** A fake decoded sample with planar channel data. */
function sample(channels: number[][]) {
  return {
    numberOfFrames: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    copyTo(destination: AllowSharedBufferSource, options: { planeIndex: number }) {
      (destination as Float32Array).set(channels[options.planeIndex] ?? []);
    },
  };
}

describe('mixing down to stereo', () => {
  it('copies mono to both sides', () => {
    const [left, right] = toStereo(sample([[0.5, -0.25]]));
    expect([...left]).toEqual([0.5, -0.25]);
    expect([...right]).toEqual([0.5, -0.25]);
  });

  it('keeps stereo as it is', () => {
    const [left, right] = toStereo(
      sample([
        [1, 0],
        [0, 1],
      ]),
    );
    expect([...left]).toEqual([1, 0]);
    expect([...right]).toEqual([0, 1]);
  });

  it('sends the extra channels of surround to alternate sides without getting louder', () => {
    // Channels 0 and 2 go left, 1 goes right; the left side is the average of its two channels.
    const [left, right] = toStereo(sample([[1], [0.5], [0.5]]));
    expect(left[0]).toBeCloseTo(0.75, 6);
    expect(right[0]).toBeCloseTo(0.5, 6);
  });
});

describe('resampling', () => {
  it('leaves the sound alone when the rates match', () => {
    const input: [Float32Array, Float32Array] = [
      Float32Array.of(1, 2, 3),
      Float32Array.of(4, 5, 6),
    ];
    expect(resample(input, 48_000, 48_000)).toBe(input);
  });

  it('changes the length in proportion and follows a ramp', () => {
    const ramp = Float32Array.from({ length: 441 }, (_, i) => i / 441);
    const [left] = resample([ramp, ramp], 44_100, 48_000);
    expect(left.length).toBe(480);
    // A straight ramp stays a straight ramp: sample i is at position i * 44100 / 48000 of the input.
    for (const i of [0, 100, 300, 470]) {
      expect(left[i]).toBeCloseTo((i * 44_100) / 48_000 / 441, 3);
    }
  });

  it('does not read past the end of a short input', () => {
    const [left] = resample([Float32Array.of(0.5), Float32Array.of(0.5)], 8_000, 48_000);
    expect(left.length).toBe(6);
    expect([...left].every((value) => value === 0.5)).toBe(true);
  });
});
