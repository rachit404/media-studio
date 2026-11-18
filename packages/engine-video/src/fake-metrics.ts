import type { RasterMetrics } from '@media-studio/render';

/**
 * Text measuring for tests, where there is no canvas: a character is half the font size wide, a line is
 * `fontSize * lineHeight` tall (same shape as the real measure, without the 2 px padding), shapes are their size.
 */
export const fakeMetrics: RasterMetrics = {
  measure(spec) {
    if (spec.kind === 'shape') return { width: spec.width, height: spec.height };
    const lines = spec.text.split('\n');
    const widest = Math.max(...lines.map((line) => line.length));
    return {
      width: Math.max(1, widest * spec.fontSize * 0.5),
      height: Math.max(1, lines.length * spec.fontSize * spec.lineHeight),
    };
  },
};
