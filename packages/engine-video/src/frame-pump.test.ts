import { describe, expect, it } from 'vitest';
import { FramePump, type FrameStreamSource, type TimedFrame } from './frame-pump';

interface Picture {
  id: number;
  closes: number;
  close(): void;
}

/** A fake decoder: one picture every 40 ms of source time, produced on demand, with call tracking. */
function fakeSource(options: { total?: number; failAt?: number } = {}) {
  const pictures: Picture[] = [];
  let starts: number[] = [];
  let returned = 0;
  const source: FrameStreamSource<Picture> = {
    async *frames(startUs: number): AsyncGenerator<TimedFrame<Picture>, void, undefined> {
      starts.push(startUs);
      try {
        const first = Math.floor(startUs / 40_000);
        for (let index = first; index < (options.total ?? 1000); index += 1) {
          await Promise.resolve();
          if (index === options.failAt) throw new Error('decode failed');
          const picture: Picture = {
            id: pictures.length,
            closes: 0,
            close() {
              this.closes += 1;
            },
          };
          pictures.push(picture);
          yield { frame: picture, timestamp: index * 40_000 };
        }
      } finally {
        returned += 1;
      }
    },
  };
  return {
    source,
    pictures,
    starts: () => starts,
    returned: () => returned,
    reset: () => (starts = []),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('FramePump', () => {
  it('reads ahead only as far as the lookahead and hands out the picture for a time', async () => {
    const fake = fakeSource();
    const pump = new FramePump(fake.source, 4);
    pump.start(0);
    await pump.ready();
    await settle();
    expect(pump.queued).toBe(4);
    expect(fake.pictures).toHaveLength(4);
    expect(pump.frameFor(0)?.timestamp).toBe(0);
    expect(pump.frameFor(90_000)?.timestamp).toBe(80_000);
    // The pictures in the past were closed; the pump then reads on to refill.
    await settle();
    expect(pump.queued).toBe(4);
    expect(fake.pictures[0]?.closes).toBe(1);
    expect(fake.pictures[1]?.closes).toBe(1);
    pump.stop();
    await settle();
    expect(pump.alive).toBe(0);
    expect(fake.pictures.every((picture) => picture.closes === 1)).toBe(true);
  });

  it('restarting abandons the old stream, closes its pictures and starts where asked', async () => {
    const fake = fakeSource();
    const pump = new FramePump(fake.source, 3);
    pump.start(0);
    await pump.ready();
    await settle();
    pump.start(2_000_000);
    await pump.ready();
    await settle();
    expect(fake.starts()).toEqual([0, 2_000_000]);
    expect(fake.returned()).toBeGreaterThanOrEqual(1);
    expect(pump.frameFor(2_000_000)?.timestamp).toBe(2_000_000);
    pump.stop();
    await settle();
    expect(pump.alive).toBe(0);
    expect(fake.pictures.every((picture) => picture.closes === 1)).toBe(true);
  });

  it('many quick restarts never leak a picture', async () => {
    const fake = fakeSource();
    const pump = new FramePump(fake.source, 3);
    for (let i = 0; i < 25; i += 1) {
      pump.start(i * 500_000);
      if (i % 3 === 0) await pump.ready();
      else await Promise.resolve();
    }
    pump.stop();
    await settle();
    expect(pump.alive).toBe(0);
    expect(fake.pictures.every((picture) => picture.closes === 1)).toBe(true);
  });

  it('reports the end of the file and keeps the last picture', async () => {
    const fake = fakeSource({ total: 3 });
    const pump = new FramePump(fake.source, 6);
    pump.start(0);
    await pump.ready();
    await settle();
    expect(pump.finished).toBe(true);
    expect(pump.frameFor(10_000_000)?.timestamp).toBe(80_000);
    pump.stop();
    expect(pump.alive).toBe(0);
  });

  it('reports a decoding failure without throwing, and recovers on restart', async () => {
    const fake = fakeSource({ failAt: 2 });
    const pump = new FramePump(fake.source, 6);
    pump.start(0);
    await settle();
    expect(pump.error).toBeInstanceOf(Error);
    expect(pump.queued).toBe(2);
    pump.start(120_000);
    await pump.ready();
    expect(pump.error).toBeNull();
    pump.stop();
    await settle();
    expect(pump.alive).toBe(0);
  });
});
