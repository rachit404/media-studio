export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface SizeBounds {
  min: number;
  max: number;
}

/**
 * Keyboard resizing for a vertical splitter. Returns the new size, or null when the key is not handled.
 * `side` is the side the controlled panel is on: a panel on the right grows when the splitter moves left.
 */
export function sizeForKey(
  current: number,
  key: string,
  bounds: SizeBounds,
  side: 'left' | 'right',
  step = 16,
): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clamp(current + (side === 'left' ? -step : step), bounds.min, bounds.max);
    case 'ArrowRight':
      return clamp(current + (side === 'left' ? step : -step), bounds.min, bounds.max);
    case 'Home':
      return bounds.min;
    case 'End':
      return bounds.max;
    default:
      return null;
  }
}

/** New panel size while dragging, given the pointer travel since the drag started. */
export function sizeForDrag(
  startSize: number,
  deltaX: number,
  bounds: SizeBounds,
  side: 'left' | 'right',
): number {
  return clamp(startSize + (side === 'left' ? deltaX : -deltaX), bounds.min, bounds.max);
}
