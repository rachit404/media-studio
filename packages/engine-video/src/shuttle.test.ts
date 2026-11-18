import { FPS_30 } from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { formatRate, shuttle } from './shuttle';
import { Transport } from './transport';

const S = 1_000_000;

describe('J, K and L', () => {
  it('L starts forwards at normal speed, then goes 2, 4 and 8 times as fast and stays there', () => {
    let state = shuttle('L', false, 1);
    expect(state).toEqual({ playing: true, rate: 1 });
    const rates: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      if (!state.playing) throw new Error('stopped');
      state = shuttle('L', true, state.rate);
      if (state.playing) rates.push(state.rate);
    }
    expect(rates).toEqual([2, 4, 8, 8]);
  });

  it('J does the same backwards', () => {
    expect(shuttle('J', false, 1)).toEqual({ playing: true, rate: -1 });
    expect(shuttle('J', true, -1)).toEqual({ playing: true, rate: -2 });
    expect(shuttle('J', true, -8)).toEqual({ playing: true, rate: -8 });
  });

  it('the other direction restarts at normal speed, and K stops', () => {
    expect(shuttle('J', true, 4)).toEqual({ playing: true, rate: -1 });
    expect(shuttle('L', true, -4)).toEqual({ playing: true, rate: 1 });
    expect(shuttle('K', true, 4)).toEqual({ playing: false });
    expect(shuttle('K', false, 1)).toEqual({ playing: false });
  });

  it('a paused transport keeps its old rate, so L after a fast shuttle starts at normal speed', () => {
    expect(shuttle('L', false, 8)).toEqual({ playing: true, rate: 1 });
  });

  it('formats rates', () => {
    expect(formatRate(2)).toBe('2×');
    expect(formatRate(-4)).toBe('−4×');
  });
});

describe('transport rate', () => {
  function make() {
    let now = 0;
    const transport = new Transport({ clock: () => now }, FPS_30);
    transport.setDuration(10 * S);
    return {
      transport,
      advance: (us: number) => {
        now += us;
      },
    };
  }

  it('keeps playing from the very start, forwards or at any rate (time 0 is not the end of a forward run)', () => {
    const { transport } = make();
    transport.play();
    expect(transport.tick()).toBe(0);
    expect(transport.playing).toBe(true);
    transport.pause();
    transport.setRate(4);
    transport.play();
    expect(transport.tick()).toBe(0);
    expect(transport.playing).toBe(true);
  });

  it('plays faster: time moves rate times as fast as the clock', () => {
    const { transport, advance } = make();
    transport.setRate(4);
    transport.play();
    advance(1 * S);
    expect(transport.tick()).toBe(4 * S);
    advance(5 * S);
    expect(transport.tick()).toBe(10 * S); // the end
    expect(transport.playing).toBe(false);
  });

  it('runs backwards and stops at the start', () => {
    const { transport, advance } = make();
    transport.seek(5 * S);
    transport.setRate(-2);
    transport.play();
    advance(1 * S);
    expect(transport.tick()).toBe(3 * S);
    advance(10 * S);
    expect(transport.tick()).toBe(0);
    expect(transport.playing).toBe(false);
  });

  it('starts backwards from the end, but does not start backwards from the very start', () => {
    const { transport } = make();
    transport.seek(10 * S);
    transport.setRate(-1);
    transport.play();
    expect(transport.playing).toBe(true);
    expect(transport.time).toBe(10 * S);
    transport.pause();
    transport.seek(0);
    transport.play();
    expect(transport.playing).toBe(false);
  });

  it('changing the rate while playing does not make the time jump', () => {
    const { transport, advance } = make();
    transport.play();
    advance(2 * S);
    transport.setRate(2);
    expect(transport.time).toBe(2 * S);
    advance(1 * S);
    expect(transport.tick()).toBe(4 * S);
    transport.setRate(-1);
    advance(1 * S);
    expect(transport.tick()).toBe(3 * S);
  });

  it('only normal speed counts frames as presented or dropped', () => {
    const { transport, advance } = make();
    transport.setRate(8);
    transport.play();
    advance(0.5 * S);
    transport.tick();
    expect(transport.stats).toEqual({ presented: 0, dropped: 0 });
    transport.pause();
    transport.setRate(1);
    transport.play();
    advance(0.1 * S);
    transport.tick();
    expect(transport.stats.presented).toBeGreaterThan(0);
  });

  it('refuses a rate of zero or one that is not a number', () => {
    const { transport } = make();
    expect(() => {
      transport.setRate(0);
    }).toThrow();
    expect(() => {
      transport.setRate(Number.NaN);
    }).toThrow();
  });
});
