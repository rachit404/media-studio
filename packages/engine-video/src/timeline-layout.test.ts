import { describe, expect, it } from 'vitest';
import {
  COLLAPSED_ROW_HEIGHT,
  MAX_PX_PER_SECOND,
  TRACK_HEIGHTS,
  fitRange,
  rowIndexAt,
  timeToX,
  trackLayout,
} from './timeline-view';

const S = 1_000_000;
const tracks = [{ id: 'V1' }, { id: 'V2' }, { id: 'A1' }];

describe('fitRange', () => {
  it('fills the width with the range and starts a little before it', () => {
    const scale = fitRange(10 * S, 4 * S, 1000);
    const startX = timeToX(scale, 10 * S);
    const endX = timeToX(scale, 14 * S);
    expect(startX).toBeGreaterThan(0);
    expect(endX).toBeLessThanOrEqual(1000);
    expect(endX - startX).toBeGreaterThan(850);
  });

  it('never scrolls before the start, and clamps a very short range to the largest zoom', () => {
    expect(fitRange(0, 4 * S, 1000).originUs).toBe(0);
    expect(fitRange(S, 1, 100_000).pxPerSecond).toBe(MAX_PX_PER_SECOND);
  });
});

describe('trackLayout', () => {
  it('stacks rows of the chosen height', () => {
    const layout = trackLayout(tracks, TRACK_HEIGHTS.normal, new Set());
    expect(layout.tops).toEqual([0, 56, 112]);
    expect(layout.heights).toEqual([56, 56, 56]);
    expect(layout.total).toBe(168);
  });

  it('gives a collapsed track a thin strip and moves the rows below it up', () => {
    const layout = trackLayout(tracks, TRACK_HEIGHTS.tall, new Set(['V2']));
    expect(layout.heights).toEqual([88, COLLAPSED_ROW_HEIGHT, 88]);
    expect(layout.tops).toEqual([0, 88, 88 + COLLAPSED_ROW_HEIGHT]);
    expect(layout.total).toBe(88 + COLLAPSED_ROW_HEIGHT + 88);
  });

  it('has nothing for no tracks', () => {
    expect(trackLayout([], 56, new Set())).toEqual({ tops: [], heights: [], total: 0 });
  });
});

describe('rowIndexAt', () => {
  const layout = trackLayout(tracks, 56, new Set(['V2']));

  it('finds the row under a position, including the thin one', () => {
    expect(rowIndexAt(layout, 0)).toBe(0);
    expect(rowIndexAt(layout, 55)).toBe(0);
    expect(rowIndexAt(layout, 56)).toBe(1);
    expect(rowIndexAt(layout, 56 + COLLAPSED_ROW_HEIGHT - 1)).toBe(1);
    expect(rowIndexAt(layout, 56 + COLLAPSED_ROW_HEIGHT)).toBe(2);
  });

  it('gives -1 above, below and with no rows', () => {
    expect(rowIndexAt(layout, -1)).toBe(-1);
    expect(rowIndexAt(layout, layout.total)).toBe(-1);
    expect(rowIndexAt(trackLayout([], 56, new Set()), 0)).toBe(-1);
  });
});
