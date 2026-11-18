import { describe, expect, it } from 'vitest';
import { placeBuffer } from './audio-player';

const S = 1_000_000;

describe('placing a decoded buffer on the timeline and the audio clock', () => {
  // The clip starts at 2 s on the timeline and plays the file from 10 s; playback began at timeline 0, heard at clock 1 s.
  const slice = { start: 2 * S, sourceStart: 10 * S };

  it('at normal speed: the file moves as fast as the clock', () => {
    const placed = placeBuffer(slice, 10.5 * S, 0.1, 0, 1, 0);
    expect(placed).toEqual({
      timeline: 2.5 * S,
      when: 3.5,
      offset: 0,
      late: 0,
      heardSeconds: 0.1,
    });
  });

  it('at double speed: a buffer of file sound is heard in half the time, and sits half as far along', () => {
    const placed = placeBuffer({ ...slice, speed: 2 }, 11 * S, 0.2, 0, 1, 0);
    // One file second after the start is half a timeline second after it.
    expect(placed).toMatchObject({ timeline: 2.5 * S, when: 3.5, offset: 0 });
    expect(placed?.heardSeconds).toBeCloseTo(0.1);
  });

  it('at half speed: a buffer takes twice as long to play', () => {
    const placed = placeBuffer({ ...slice, speed: 0.5 }, 11 * S, 0.2, 0, 1, 0);
    expect(placed).toMatchObject({ timeline: 4 * S, when: 5 });
    expect(placed?.heardSeconds).toBeCloseTo(0.4);
  });

  it('when late, starts in the middle: the offset is in file seconds, the lateness in clock seconds', () => {
    // The buffer should have started at clock 3.5 s but it is 3.6 s now: 0.1 clock seconds late.
    const normal = placeBuffer(slice, 10.5 * S, 0.5, 0, 1, 3.6);
    expect(normal?.late).toBeCloseTo(0.1);
    expect(normal?.offset).toBeCloseTo(0.1);
    expect(normal?.when).toBe(3.6);
    expect(normal?.heardSeconds).toBeCloseTo(0.4);

    // At 2x the same lateness skips twice as much of the file, and the rest is heard in half the time.
    const fast = placeBuffer({ ...slice, speed: 2 }, 10.5 * S, 0.5, 0, 1, 3.6);
    // At 2x the buffer at file 10.5 s sits at timeline 2.25 s, clock 3.25 s: 0.35 s late, 0.7 file seconds in: over.
    expect(fast).toBeNull();
    const fastLater = placeBuffer({ ...slice, speed: 2 }, 11.9 * S, 1, 0, 1, 3.4);
    // File 11.9 s = timeline 2.95 s = clock 3.95 s: not late at all.
    expect(fastLater).toMatchObject({ late: 0, offset: 0, when: 3.95 });
    const partly = placeBuffer({ ...slice, speed: 2 }, 11 * S, 1, 0, 1, 3.6);
    // File 11 s = timeline 2.5 s = clock 3.5 s: 0.1 late = 0.2 file seconds in; 0.8 file seconds heard in 0.4 s.
    expect(partly?.offset).toBeCloseTo(0.2);
    expect(partly?.heardSeconds).toBeCloseTo(0.4);
  });

  it('gives up on a buffer that is already over', () => {
    expect(placeBuffer(slice, 10 * S, 0.1, 0, 1, 5)).toBeNull();
  });
});
