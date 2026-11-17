import { describe, expect, it } from 'vitest';
import { clamp, sizeForDrag, sizeForKey } from './splitter-math';

const bounds = { min: 160, max: 480 };

describe('splitter math', () => {
  it('clamps', () => {
    expect(clamp(10, 0, 5)).toBe(5);
    expect(clamp(-1, 0, 5)).toBe(0);
    expect(clamp(3, 0, 5)).toBe(3);
  });

  it('resizes a left panel with the arrow keys and keeps within bounds', () => {
    expect(sizeForKey(240, 'ArrowRight', bounds, 'left')).toBe(256);
    expect(sizeForKey(240, 'ArrowLeft', bounds, 'left')).toBe(224);
    expect(sizeForKey(165, 'ArrowLeft', bounds, 'left')).toBe(160);
  });

  it('inverts the direction for a right panel', () => {
    expect(sizeForKey(240, 'ArrowLeft', bounds, 'right')).toBe(256);
    expect(sizeForKey(240, 'ArrowRight', bounds, 'right')).toBe(224);
  });

  it('jumps to bounds with Home and End and ignores other keys', () => {
    expect(sizeForKey(240, 'Home', bounds, 'left')).toBe(160);
    expect(sizeForKey(240, 'End', bounds, 'left')).toBe(480);
    expect(sizeForKey(240, 'a', bounds, 'left')).toBeNull();
  });

  it('resizes by dragging in the right direction for each side', () => {
    expect(sizeForDrag(240, 50, bounds, 'left')).toBe(290);
    expect(sizeForDrag(240, 50, bounds, 'right')).toBe(190);
    expect(sizeForDrag(240, 1000, bounds, 'left')).toBe(480);
  });
});
