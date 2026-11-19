import { describe, expect, it } from 'vitest';
import { decoderLimit } from './device-budget';

describe('how many clips are decoded at once', () => {
  it('uses the default when nothing is known', () => {
    expect(decoderLimit({})).toBe(4);
    expect(decoderLimit({ deviceMemoryGb: Number.NaN, cores: Number.NaN })).toBe(4);
  });

  it('gives small computers fewer, and large ones more, within limits', () => {
    expect(decoderLimit({ deviceMemoryGb: 1 })).toBe(2);
    expect(decoderLimit({ deviceMemoryGb: 2 })).toBe(2);
    expect(decoderLimit({ deviceMemoryGb: 4 })).toBe(3);
    expect(decoderLimit({ deviceMemoryGb: 8 })).toBe(6);
    expect(decoderLimit({ deviceMemoryGb: 64 })).toBe(6);
  });

  it('is held down by few cores, but never below two', () => {
    expect(decoderLimit({ deviceMemoryGb: 8, cores: 8 })).toBe(4);
    expect(decoderLimit({ deviceMemoryGb: 8, cores: 4 })).toBe(2);
    expect(decoderLimit({ deviceMemoryGb: 8, cores: 1 })).toBe(2);
    expect(decoderLimit({ cores: 16 })).toBe(4);
  });
});
